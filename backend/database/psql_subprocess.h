#pragma once

#include "connection_utils.h"
#include "driver_interface.h"

#include <expected>
#include <string>
#include <string_view>

namespace velocitydb {

struct PsqlConnectionInfo {
    std::string host;
    int port = 5432;
    std::string database;
    std::string username;
    std::string password;
};

/// Escape a value for CreateProcessW argv parsing (Windows 2n+1 backslash rule)
[[nodiscard]] std::string shellQuote(std::string_view value);

/// Execute SQL via psql subprocess (for COPY FROM stdin delegation)
[[nodiscard]] std::expected<ResultSet, std::string> executePsql(const PsqlConnectionInfo& conn, std::string_view sql);

/// Check if psql is available on the system PATH
[[nodiscard]] bool isPsqlAvailable();

/// Convert DatabaseConnectionParams to PsqlConnectionInfo
[[nodiscard]] PsqlConnectionInfo toPsqlConnectionInfo(const DatabaseConnectionParams& params);

}  // namespace velocitydb
