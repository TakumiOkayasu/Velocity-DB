#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Preserve the existing raw JSON and legacy single-string argument-array bridge forms.
[[nodiscard]] std::string normalizeWebViewRequest(std::string_view request);

}  // namespace velocitydb
