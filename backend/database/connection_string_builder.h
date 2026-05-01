#pragma once

#include "connection_types.h"

#include <expected>
#include <string>

namespace velocitydb {

/// Builds connection string from parameters.
/// PostgreSQL: libpq conninfo format. SQL Server/MySQL: ODBC format.
[[nodiscard]] std::expected<std::string, std::string> buildConnectionString(const DatabaseConnectionParams& params);

}  // namespace velocitydb
