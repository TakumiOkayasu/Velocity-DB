#pragma once

#include <charconv>
#include <string>
#include <string_view>

namespace velocitydb {

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

}  // namespace velocitydb
