#pragma once

#include "../network/ssh_tunnel.h"
#include "../utils/transparent_hash.h"
#include "connection_utils.h"
#include "driver_interface.h"

#include <atomic>
#include <expected>
#include <memory>
#include <optional>
#include <shared_mutex>
#include <string>
#include <string_view>
#include <unordered_map>

namespace velocitydb {

/// Manages active database connections and their associated resources
class ConnectionRegistry {
public:
    using DriverPtr = std::shared_ptr<IDatabaseDriver>;

    ConnectionRegistry() = default;
    ~ConnectionRegistry();

    ConnectionRegistry(const ConnectionRegistry&) = delete;
    ConnectionRegistry& operator=(const ConnectionRegistry&) = delete;
    ConnectionRegistry(ConnectionRegistry&&) = delete;
    ConnectionRegistry& operator=(ConnectionRegistry&&) = delete;

    /// Add a new connection pair (query + metadata) and return its unique ID
    [[nodiscard]] std::string add(DriverPtr queryDriver, DriverPtr metadataDriver, DriverType driverType);

    /// Remove a connection by ID (disconnects both query and metadata drivers)
    void remove(std::string_view id);

    /// Get the query driver by ID
    [[nodiscard]] std::expected<DriverPtr, std::string> getQueryDriver(std::string_view id);

    /// Get the metadata driver by ID
    [[nodiscard]] std::expected<DriverPtr, std::string> getMetadataDriver(std::string_view id);

    /// Get a connection by ID (alias for getQueryDriver, for backwards compatibility)
    [[nodiscard]] std::expected<DriverPtr, std::string> get(std::string_view id);

    /// Get the driver type for a connection
    [[nodiscard]] std::expected<DriverType, std::string> getDriverType(std::string_view id) const;

    /// Check if a connection exists
    [[nodiscard]] bool exists(std::string_view id) const;

    /// Get the number of active connections
    [[nodiscard]] size_t count() const;

    /// Attach an SSH tunnel to a connection
    void attachTunnel(std::string_view connectionId, std::unique_ptr<SshTunnel> tunnel);

    /// Get the SSH tunnel for a connection (may be nullptr)
    [[nodiscard]] SshTunnel* getTunnel(std::string_view connectionId) const;

    /// Store effective connection parameters for a connection (for psql delegation)
    void storeParams(std::string_view connectionId, const DatabaseConnectionParams& params);

    /// Get stored connection parameters
    [[nodiscard]] std::optional<DatabaseConnectionParams> getParams(std::string_view connectionId) const;

    /// Remove and close all connections
    void clear();

private:
    struct ConnectionEntry {
        DriverPtr queryDriver;
        DriverPtr metadataDriver;
        DriverType driverType;
        std::unique_ptr<SshTunnel> tunnel;
        DatabaseConnectionParams params;
    };

    mutable std::shared_mutex m_mutex;
    std::unordered_map<std::string, ConnectionEntry, TransparentStringHash, TransparentStringEqual> m_connections;
    std::atomic<int> m_counter{1};
};

}  // namespace velocitydb
