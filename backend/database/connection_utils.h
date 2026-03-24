#pragma once

#include <charconv>
#include <expected>
#include <memory>
#include <string>
#include <string_view>

namespace velocitydb {

class SshTunnel;
struct SshTunnelConfig;

enum class DbType { SQLServer, PostgreSQL, MySQL };

/// Default database port for each DbType.
[[nodiscard]] constexpr int defaultDbPort(DbType type) noexcept {
    switch (type) {
        case DbType::PostgreSQL:
            return 5432;
        case DbType::MySQL:
            return 3306;
        default:
            return 1433;
    }
}

/// Result of splitting "host,port" server string.
struct HostPort {
    std::string host;
    int port;
};

/// Split "host,port" into host and port. Uses defaultPort if no comma.
[[nodiscard]] inline HostPort splitHostPort(std::string_view server, int defaultPort) {
    if (auto comma = server.find(','); comma != std::string_view::npos) {
        auto portStr = server.substr(comma + 1);
        int port = defaultPort;
        if (auto [ptr, ec] = std::from_chars(portStr.data(), portStr.data() + portStr.size(), port); ec != std::errc{} || port < 1 || port > 65535)
            port = defaultPort;
        return {std::string(server.substr(0, comma)), port};
    }
    return {std::string(server), defaultPort};
}

struct SshConnectionParams {
    bool enabled = false;
    std::string host;
    int port = 22;
    std::string username;
    std::string authType;  // "password" or "privateKey"
    std::string password;
    std::string privateKeyPath;
    std::string keyPassphrase;
};

static constexpr unsigned int kDefaultConnectionTimeoutSeconds = 30;
static constexpr unsigned int kMaxConnectionTimeoutSeconds = 300;

struct DatabaseConnectionParams {
    std::string server;
    std::string database;
    std::string username;
    std::string password;
    bool useWindowsAuth = true;
    DbType dbType = DbType::SQLServer;
    SshConnectionParams ssh;
    unsigned int connectionTimeoutSeconds = kDefaultConnectionTimeoutSeconds;
};

/// Escapes a value for SQL Server ODBC connection strings using {brace} syntax.
[[nodiscard]] std::string escapeOdbcValue(std::string_view value);

/// Escapes a value for MySQL ODBC connection strings using 'single-quote' syntax.
[[nodiscard]] std::string quoteOdbcValue(std::string_view value);

/// Escapes a value for libpq conninfo strings (backslash escaping inside single quotes).
[[nodiscard]] std::string quoteLibpqValue(std::string_view value);

/// Builds connection string from parameters.
/// PostgreSQL: libpq conninfo format. SQL Server/MySQL: ODBC format.
[[nodiscard]] std::expected<std::string, std::string> buildConnectionString(const DatabaseConnectionParams& params);

/// Parses JSON into DatabaseConnectionParams.
[[nodiscard]] std::expected<DatabaseConnectionParams, std::string> extractConnectionParams(std::string_view jsonParams);

/// Extracts connectionId from JSON params.
[[nodiscard]] std::expected<std::string, std::string> extractConnectionId(std::string_view jsonParams);

/// Builds SSH tunnel config from parameters.
[[nodiscard]] SshTunnelConfig buildSshTunnelConfig(const SshConnectionParams& ssh, const std::string& server, DbType dbType = DbType::SQLServer);

/// Establishes an SSH tunnel based on connection parameters.
[[nodiscard]] std::expected<std::unique_ptr<SshTunnel>, std::string> establishSshTunnel(const DatabaseConnectionParams& params);

}  // namespace velocitydb
