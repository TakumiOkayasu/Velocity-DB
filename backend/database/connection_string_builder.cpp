#include "connection_string_builder.h"

#include "odbc_driver_detector.h"

#include <format>
#include <string_view>

namespace velocitydb {
namespace {

/// Escapes a value for SQL Server ODBC connection strings using {brace} syntax.
[[nodiscard]] std::string escapeOdbcValue(std::string_view value) {
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

/// Escapes a value for MySQL ODBC connection strings using 'single-quote' syntax.
[[nodiscard]] std::string quoteOdbcValue(std::string_view value) {
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

/// Escapes a value for libpq conninfo strings (backslash escaping inside single quotes).
[[nodiscard]] std::string quoteLibpqValue(std::string_view value) {
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

}  // namespace

std::expected<std::string, std::string> buildConnectionString(const DatabaseConnectionParams& params) {
    std::string connectionString;

    switch (params.dbType) {
        case DbType::PostgreSQL: {
            auto [host, port] = splitHostPort(params.server, defaultDbPort(DbType::PostgreSQL));
            connectionString = std::format("host={} port={} dbname={} user={} password={} connect_timeout={}", quoteLibpqValue(host), port, quoteLibpqValue(params.database),
                                           quoteLibpqValue(params.username), quoteLibpqValue(params.password), params.connectionTimeoutSeconds);
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

}  // namespace velocitydb
