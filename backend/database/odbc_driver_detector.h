#pragma once

#include <string>

namespace predategrip {

/// Detects the best available SQL Server ODBC driver on the system.
/// Returns "ODBC Driver 18 for SQL Server" if available, falling back to
/// version 17, then "SQL Server" as last resort.
[[nodiscard]] std::string detectBestSqlServerDriver();

/// Builds a connection string with the best available driver.
/// @param server The SQL Server hostname/IP
/// @param database The database name
/// @return Connection string with driver prefix
[[nodiscard]] std::string buildDriverConnectionPrefix(std::string_view server, std::string_view database);

}  // namespace predategrip
