#include "connection_provider.h"

#include "../database/async_connection_executor.h"
#include "../database/connection_params_parser.h"
#include "../database/connection_preparer.h"
#include "../database/connection_registry.h"
#include "../database/driver_interface.h"
#include "../utils/json_utils.h"
#include "simdjson.h"

#include <chrono>
#include <format>

namespace velocitydb {

ConnectionProvider::ConnectionProvider() : m_registry(std::make_unique<ConnectionRegistry>()), m_asyncExecutor(std::make_unique<AsyncConnectionExecutor>()) {}

ConnectionProvider::~ConnectionProvider() = default;

std::shared_ptr<IDatabaseDriver> ConnectionProvider::getQueryDriver(std::string_view connectionId) {
    auto result = m_registry->getQueryDriver(connectionId);
    if (!result)
        return nullptr;
    return *result;
}

std::shared_ptr<IDatabaseDriver> ConnectionProvider::getMetadataDriver(std::string_view connectionId) {
    auto result = m_registry->getMetadataDriver(connectionId);
    if (!result)
        return nullptr;
    return *result;
}

DriverType ConnectionProvider::getDriverType(std::string_view connectionId) const {
    auto result = m_registry->getDriverType(connectionId);
    if (!result) [[unlikely]]
        throw std::runtime_error(result.error());
    return *result;
}

std::optional<DatabaseConnectionParams> ConnectionProvider::getConnectionParams(std::string_view connectionId) const {
    return m_registry->getParams(connectionId);
}

void ConnectionProvider::setDefaultQueryTimeoutSeconds(int seconds) {
    m_queryTimeoutSeconds.store(seconds, std::memory_order_relaxed);
    m_registry->forEachQueryDriver([seconds](IDatabaseDriver& driver) { driver.setQueryTimeout(std::chrono::seconds(seconds)); });
}

std::string ConnectionProvider::disconnect(std::string_view params) {
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }

    m_registry->remove(*connectionIdResult);
    return JsonUtils::successResponse("{}");
}

std::string ConnectionProvider::testConnection(std::string_view params) {
    auto connectionParams = extractConnectionParams(params);
    if (!connectionParams) {
        return JsonUtils::errorResponse(connectionParams.error());
    }

    auto prepared = prepareConnection(*connectionParams);
    if (!prepared) {
        return JsonUtils::successResponse(std::format(R"({{"success":false,"message":"{}"}})", JsonUtils::escapeString(prepared.error())));
    }

    auto driver = DriverFactory::createDriver(prepared->driverType);
    driver->setConnectionTimeout(connectionParams->connectionTimeoutSeconds);
    if (driver->connect(prepared->connectionString)) {
        driver->disconnect();
        return JsonUtils::successResponse(R"({"success":true,"message":"Connection successful"})");
    }

    return JsonUtils::successResponse(std::format(R"({{"success":false,"message":"{}"}})", JsonUtils::escapeString(driver->getLastError())));
}

std::string ConnectionProvider::connectAsync(std::string_view params) {
    auto connectionParams = extractConnectionParams(params);
    if (!connectionParams) {
        return JsonUtils::errorResponse(connectionParams.error());
    }

    // Submit raw params — SSH + DB connect happens in background thread
    auto requestId = m_asyncExecutor->submitConnect(std::move(*connectionParams));
    return JsonUtils::successResponse(std::format(R"({{"requestId":"{}"}})", requestId));
}

std::string ConnectionProvider::getConnectResult(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);
        auto requestIdResult = doc["requestId"].get_string();
        if (requestIdResult.error()) {
            return JsonUtils::errorResponse("Missing requestId field");
        }
        std::string requestId(requestIdResult.value());

        auto result = m_asyncExecutor->getResultAndConsume(requestId);

        // Connected: drivers consumed atomically
        if (result.has_value()) {
            auto& drivers = *result;
            // Apply current query timeout before registering so first execute() picks it up.
            // metadataDriver keeps the driver default (short metadata lookups don't need tuning).
            auto timeoutSec = m_queryTimeoutSeconds.load(std::memory_order_relaxed);
            drivers.queryDriver->setQueryTimeout(std::chrono::seconds(timeoutSec));
            auto connectionId = m_registry->add(drivers.queryDriver, drivers.metadataDriver, drivers.queryDriver->getType());
            m_registry->storeParams(connectionId, drivers.effectiveParams);
            if (drivers.tunnel) {
                m_registry->attachTunnel(connectionId, std::move(drivers.tunnel));
            }
            return JsonUtils::successResponse(std::format(R"({{"status":"connected","connectionId":"{}"}})", connectionId));
        }

        auto& status = result.error();
        const char* statusStr = "pending";
        switch (status.status) {
            case ConnectStatus::Failed:
                statusStr = "failed";
                break;
            case ConnectStatus::Cancelled:
                statusStr = "cancelled";
                break;
            default:
                break;
        }

        if (!status.errorMessage.empty()) {
            return JsonUtils::successResponse(std::format(R"({{"status":"{}","error":"{}"}})", statusStr, JsonUtils::escapeString(status.errorMessage)));
        }
        return JsonUtils::successResponse(std::format(R"({{"status":"{}"}})", statusStr));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string ConnectionProvider::cancelConnect(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);
        auto requestIdResult = doc["requestId"].get_string();
        if (requestIdResult.error()) {
            return JsonUtils::errorResponse("Missing requestId field");
        }

        (void)m_asyncExecutor->cancelConnect(requestIdResult.value());
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
