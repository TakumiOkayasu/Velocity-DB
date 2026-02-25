#include "connection_provider.h"

#include "../database/connection_registry.h"
#include "../database/connection_utils.h"
#include "../database/driver_interface.h"
#include "../network/ssh_tunnel.h"
#include "../utils/json_utils.h"
#include "../utils/logger.h"

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

    return PreparedConnection{std::move(*connStr), std::move(tunnel), toDriverType(params.dbType)};
}

}  // namespace

ConnectionProvider::ConnectionProvider() : m_registry(std::make_unique<ConnectionRegistry>()) {}

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

std::string ConnectionProvider::handleConnect(std::string_view params) {
    auto connectionParams = extractConnectionParams(params);
    if (!connectionParams) {
        return JsonUtils::errorResponse(connectionParams.error());
    }

    auto prepared = prepareConnection(*connectionParams);
    if (!prepared) {
        return JsonUtils::errorResponse(prepared.error());
    }

    auto queryDriver = DriverFactory::createDriver(prepared->driverType);
    std::shared_ptr<IDatabaseDriver> queryDriverPtr(std::move(queryDriver));
    if (!queryDriverPtr->connect(prepared->connectionString)) {
        return JsonUtils::errorResponse(std::format("Connection failed: {}", queryDriverPtr->getLastError()));
    }

    auto metadataDriver = DriverFactory::createDriver(prepared->driverType);
    std::shared_ptr<IDatabaseDriver> metadataDriverPtr(std::move(metadataDriver));
    if (!metadataDriverPtr->connect(prepared->connectionString)) {
        queryDriverPtr->disconnect();
        return JsonUtils::errorResponse(std::format("Metadata connection failed: {}", metadataDriverPtr->getLastError()));
    }

    auto connectionId = m_registry->add(queryDriverPtr, metadataDriverPtr, prepared->driverType);
    if (prepared->tunnel) {
        m_registry->attachTunnel(connectionId, std::move(prepared->tunnel));
    }

    return JsonUtils::successResponse(std::format(R"({{"connectionId":"{}"}})", connectionId));
}

std::string ConnectionProvider::handleDisconnect(std::string_view params) {
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }

    m_registry->remove(*connectionIdResult);
    return JsonUtils::successResponse("{}");
}

std::string ConnectionProvider::handleTestConnection(std::string_view params) {
    auto connectionParams = extractConnectionParams(params);
    if (!connectionParams) {
        return JsonUtils::errorResponse(connectionParams.error());
    }

    auto prepared = prepareConnection(*connectionParams);
    if (!prepared) {
        return JsonUtils::successResponse(std::format(R"({{"success":false,"message":"{}"}})", JsonUtils::escapeString(prepared.error())));
    }

    auto driver = DriverFactory::createDriver(prepared->driverType);
    if (driver->connect(prepared->connectionString)) {
        driver->disconnect();
        return JsonUtils::successResponse(R"({"success":true,"message":"Connection successful"})");
    }

    return JsonUtils::successResponse(std::format(R"({{"success":false,"message":"{}"}})", JsonUtils::escapeString(driver->getLastError())));
}

}  // namespace velocitydb
