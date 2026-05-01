#pragma once

#include "connection_types.h"

#include <expected>
#include <memory>
#include <string>

namespace velocitydb {

class SshTunnel;
enum class DriverType;

struct PreparedConnection {
    std::string connectionString;
    std::unique_ptr<SshTunnel> tunnel;
    DriverType driverType;
    DatabaseConnectionParams effectiveParams;
};

/// Prepare a connection: establish SSH tunnel if needed, build connection string.
[[nodiscard]] std::expected<PreparedConnection, std::string> prepareConnection(const DatabaseConnectionParams& params);

}  // namespace velocitydb
