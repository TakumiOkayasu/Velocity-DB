#pragma once

#include "../interfaces/providers/connection_provider.h"

#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace velocitydb {

class AsyncConnectionExecutor;
class ConnectionRegistry;
enum class DriverType;

/// Provider for database connection lifecycle and driver access
class ConnectionProvider : public IConnectionProvider {
public:
    ConnectionProvider();
    ~ConnectionProvider() override;

    ConnectionProvider(const ConnectionProvider&) = delete;
    ConnectionProvider& operator=(const ConnectionProvider&) = delete;
    ConnectionProvider(ConnectionProvider&&) = delete;
    ConnectionProvider& operator=(ConnectionProvider&&) = delete;

    [[nodiscard]] std::string connectAsync(std::string_view params) override;
    [[nodiscard]] std::string getConnectResult(std::string_view params) override;
    [[nodiscard]] std::string cancelConnect(std::string_view params) override;
    [[nodiscard]] std::string disconnect(std::string_view params) override;
    [[nodiscard]] std::string testConnection(std::string_view params) override;

    [[nodiscard]] std::shared_ptr<IDatabaseDriver> getQueryDriver(std::string_view connectionId) override;
    [[nodiscard]] std::shared_ptr<IDatabaseDriver> getMetadataDriver(std::string_view connectionId) override;

    [[nodiscard]] DriverType getDriverType(std::string_view connectionId) const override;
    [[nodiscard]] std::optional<DatabaseConnectionParams> getConnectionParams(std::string_view connectionId) const override;

private:
    std::unique_ptr<ConnectionRegistry> m_registry;
    std::unique_ptr<AsyncConnectionExecutor> m_asyncExecutor;
};

}  // namespace velocitydb
