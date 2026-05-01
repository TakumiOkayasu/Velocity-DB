#pragma once

#include "connection_types.h"

#include <expected>
#include <string>
#include <string_view>

namespace velocitydb {

/// Parses JSON into DatabaseConnectionParams.
[[nodiscard]] std::expected<DatabaseConnectionParams, std::string> extractConnectionParams(std::string_view jsonParams);

/// Extracts connectionId from JSON params.
[[nodiscard]] std::expected<std::string, std::string> extractConnectionId(std::string_view jsonParams);

}  // namespace velocitydb
