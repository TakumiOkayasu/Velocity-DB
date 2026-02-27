#include "connection_utils.h"

#include "../network/ssh_tunnel.h"
#include "odbc_driver_detector.h"
#include "simdjson.h"

#include <format>

namespace velocitydb {

std::string escapeOdbcValue(std::string_view value) {
    std::string result = "{";
    for (auto c : value) {
        if (c == '}') {
            result += "}}";
        } else {
            result += c;
        }
    }
    result += "}";
    return result;
}

std::string quoteOdbcValue(std::string_view value) {
    if (value.find_first_of("';") == std::string_view::npos) {
        return std::string(value);
    }
    std::string result = "'";
    for (auto c : value) {
        if (c == '\'') {
            result += "''";
        } else {
            result += c;
        }
    }
    result += "'";
    return result;
}

std::string quoteLibpqValue(std::string_view value) {
    std::string result = "'";
    for (auto c : value) {
        if (c == '\'') {
            result += "\\'";
        } else if (c == '\\') {
            result += "\\\\";
        } else {
            result += c;
        }
    }
    result += "'";
    return result;
}

std::expected<std::string, std::string> buildConnectionString(const DatabaseConnectionParams& params) {
    std::string connectionString;

    switch (params.dbType) {
        case DbType::PostgreSQL: {
            auto [host, port] = splitHostPort(params.server, defaultDbPort(DbType::PostgreSQL));
            connectionString = std::format("host={} port={} dbname={} user={} password={} connect_timeout=30", quoteLibpqValue(host), port, quoteLibpqValue(params.database),
                                           quoteLibpqValue(params.username), quoteLibpqValue(params.password));
            break;
        }
        case DbType::MySQL: {
            auto driver = detectBestMySqlDriver();
            if (driver.empty()) {
                return std::unexpected("MySQL ODBC driver not found. Install MySQL Connector/ODBC from https://dev.mysql.com/downloads/connector/odbc/");
            }
            auto [host, port] = splitHostPort(params.server, defaultDbPort(DbType::MySQL));
            connectionString = std::format("Driver={{{}}};Server={};Port={};Database={};", driver, quoteOdbcValue(host), port, quoteOdbcValue(params.database));
            connectionString += std::format("User={};Password={};", quoteOdbcValue(params.username), quoteOdbcValue(params.password));
            break;
        }
        case DbType::SQLServer:
        default:
            connectionString = buildDriverConnectionPrefix(params.server, params.database);
            if (params.useWindowsAuth) {
                connectionString += "Trusted_Connection=yes;";
            } else {
                connectionString += std::format("Uid={};Pwd={};", escapeOdbcValue(params.username), escapeOdbcValue(params.password));
            }
            break;
    }

    return connectionString;
}

std::expected<DatabaseConnectionParams, std::string> extractConnectionParams(std::string_view jsonParams) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(jsonParams);

        DatabaseConnectionParams result;
        auto serverResult = doc["server"].get_string();
        auto databaseResult = doc["database"].get_string();
        if (serverResult.error() || databaseResult.error()) {
            return std::unexpected("Missing required fields: server or database");
        }
        result.server = std::string(serverResult.value());
        result.database = std::string(databaseResult.value());

        if (auto username = doc["username"].get_string(); !username.error()) {
            result.username = std::string(username.value());
        }
        if (auto password = doc["password"].get_string(); !password.error()) {
            result.password = std::string(password.value());
        }
        if (auto auth = doc["useWindowsAuth"].get_bool(); !auth.error()) {
            result.useWindowsAuth = auth.value();
        }
        if (auto dbTypeStr = doc["dbType"].get_string(); !dbTypeStr.error()) {
            std::string_view typeVal = dbTypeStr.value();
            if (typeVal == "postgresql") {
                result.dbType = DbType::PostgreSQL;
            } else if (typeVal == "mysql") {
                result.dbType = DbType::MySQL;
            } else {
                result.dbType = DbType::SQLServer;
            }
        }

        // Combine port into server string ("host,port") — must be after dbType parsing.
        // When port equals the default for the dbType, skip combining: splitHostPort()
        // in buildConnectionString() already falls back to defaultDbPort().
        if (auto port = doc["port"].get_int64(); !port.error()) {
            auto portVal = static_cast<int>(port.value());
            if (portVal >= 1 && portVal <= 65535 && portVal != defaultDbPort(result.dbType)) {
                result.server = std::format("{},{}", result.server, portVal);
            }
        }

        // Extract SSH settings
        auto sshObj = doc["ssh"];
        if (!sshObj.error()) {
            if (auto enabled = sshObj["enabled"].get_bool(); !enabled.error()) {
                result.ssh.enabled = enabled.value();
            }
            if (result.ssh.enabled) {
                if (auto host = sshObj["host"].get_string(); !host.error()) {
                    result.ssh.host = std::string(host.value());
                }
                if (auto port = sshObj["port"].get_int64(); !port.error()) {
                    result.ssh.port = static_cast<int>(port.value());
                }
                if (auto username = sshObj["username"].get_string(); !username.error()) {
                    result.ssh.username = std::string(username.value());
                }
                if (auto authType = sshObj["authType"].get_string(); !authType.error()) {
                    result.ssh.authType = std::string(authType.value());
                }
                if (auto password = sshObj["password"].get_string(); !password.error()) {
                    result.ssh.password = std::string(password.value());
                }
                if (auto keyPath = sshObj["privateKeyPath"].get_string(); !keyPath.error()) {
                    result.ssh.privateKeyPath = std::string(keyPath.value());
                }
                if (auto passphrase = sshObj["keyPassphrase"].get_string(); !passphrase.error()) {
                    result.ssh.keyPassphrase = std::string(passphrase.value());
                }
            }
        }

        return result;
    } catch (const std::exception& e) {
        return std::unexpected(e.what());
    }
}

std::expected<std::string, std::string> extractConnectionId(std::string_view jsonParams) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(jsonParams);
        auto result = doc["connectionId"].get_string();
        if (result.error()) {
            return std::unexpected("Missing connectionId field");
        }
        return std::string(result.value());
    } catch (const std::exception& e) {
        return std::unexpected(e.what());
    }
}

SshTunnelConfig buildSshTunnelConfig(const SshConnectionParams& ssh, const std::string& server, DbType dbType) {
    auto [host, port] = splitHostPort(server, defaultDbPort(dbType));

    SshTunnelConfig config;
    config.host = ssh.host;
    config.port = ssh.port;
    config.username = ssh.username;
    config.authMethod = (ssh.authType == "privateKey") ? SshAuthMethod::PublicKey : SshAuthMethod::Password;
    config.password = ssh.password;
    config.privateKeyPath = ssh.privateKeyPath;
    config.keyPassphrase = ssh.keyPassphrase;
    config.remoteHost = std::move(host);
    config.remotePort = port;
    return config;
}

std::expected<std::unique_ptr<SshTunnel>, std::string> establishSshTunnel(const DatabaseConnectionParams& params) {
    auto tunnel = std::make_unique<SshTunnel>();
    auto config = buildSshTunnelConfig(params.ssh, params.server, params.dbType);
    auto result = tunnel->connect(config);
    if (!result) {
        return std::unexpected(std::format("SSH tunnel failed: {}", result.error().message));
    }
    return tunnel;
}

}  // namespace velocitydb
