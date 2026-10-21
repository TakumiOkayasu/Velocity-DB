#pragma once

#include <string_view>

namespace velocitydb {

[[nodiscard]] std::string_view backendBuildIdentity() noexcept;

}  // namespace velocitydb
