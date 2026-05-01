#include "connection_params_parser.h"

#include "simdjson.h"

#include <format>

namespace velocitydb {

std::expected<DatabaseConnectionParams, std::string> extractConnectionParams(std::string_view jsonParams) {
    try {
        thread_local static simdjson::dom::parser parser;
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

        if (auto timeout = doc["connectionTimeout"].get_int64(); !timeout.error()) {
            auto val = static_cast<unsigned int>(timeout.value());
            if (val >= 1 && val <= kMaxConnectionTimeoutSeconds) {
                result.connectionTimeoutSeconds = val;
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
        thread_local static simdjson::dom::parser parser;
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

}  // namespace velocitydb
