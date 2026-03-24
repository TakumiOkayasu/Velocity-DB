#include "connection_provider.h"

#include "../database/async_connection_executor.h"
#include "../database/connection_registry.h"
#include "../database/connection_utils.h"
#include "../database/driver_interface.h"
#include "../network/ssh_tunnel.h"
#include "../utils/json_utils.h"
#include "../utils/logger.h"
#include "simdjson.h"

#include <format>

namespace velocitydb {

namespace {

/// Map DbType (connection params) to DriverType (driver layer)
[[nodiscard]] constexpr DriverType toDriverType(DbType dbType) noexcept {
    switch (dbType) {
        case DbType::PostgreSQL:
            return DriverType::PostgreSQL;
        case DbType::MySQL:
            return DriverType::MySQL;
        default:
            return DriverType::SQLServer;
    }
}

struct PreparedConnection {
    std::string connectionString;
    std::unique_ptr<SshTunnel> tunnel;
    DriverType driverType;
    DatabaseConnectionParams effectiveParams;
};

/// SSH tunnel + connection string construction
[[nodiscard]] std::expected<PreparedConnection, std::string> prepareConnection(const DatabaseConnectionParams& params) {
    DatabaseConnectionParams effectiveParams = params;
    std::unique_ptr<SshTunnel> tunnel;

    if (params.ssh.enabled) {
        auto tunnelResult = establishSshTunnel(params);
        if (!tunnelResult)
            return std::unexpected(tunnelResult.error());
        tunnel = std::move(*tunnelResult);
        effectiveParams.server = std::format("127.0.0.1,{}", tunnel->getLocalPort());
        log<LogLevel::DEBUG>(std::format("[DB] SSH tunnel established, redirecting to: {}", effectiveParams.server));
    }

    auto connStr = buildConnectionString(effectiveParams);
    if (!connStr)
        return std::unexpected(connStr.error());
    log<LogLevel::DEBUG>(std::format("[DB] Connection target: {}", effectiveParams.server));
    log<LogLevel::DEBUG>("[DB] Attempting connection...");
    log_flush();

    return PreparedConnection{std::move(*connStr), std::move(tunnel), toDriverType(params.dbType), effectiveParams};
}

}  // namespace

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

    auto prepared = prepareConnection(*connectionParams);
    if (!prepared) {
        return JsonUtils::errorResponse(prepared.error());
    }

    PreparedConnectRequest request{
        .connectionString = std::move(prepared->connectionString),
        .tunnel = std::move(prepared->tunnel),
        .driverType = prepared->driverType,
        .effectiveParams = std::move(prepared->effectiveParams),
    };

    // Evict idle connections as side-effect
    [[maybe_unused]] auto evicted = m_registry->evictIdleConnections();

    auto requestId = m_asyncExecutor->submitConnect(std::move(request));
    return JsonUtils::successResponse(std::format(R"({{"requestId":"{}"}})", requestId));
}

std::string ConnectionProvider::getConnectResult(std::string_view params) {
    try {
        simdjson::dom::parser parser;
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
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);
        auto requestIdResult = doc["requestId"].get_string();
        if (requestIdResult.error()) {
            return JsonUtils::errorResponse("Missing requestId field");
        }

        m_asyncExecutor->cancelConnect(std::string(requestIdResult.value()));
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
