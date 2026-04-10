#pragma once

#include <string_view>

namespace velocitydb {

/// Transparent hash/equal for heterogeneous lookup on unordered_map<std::string, ...>.
/// Avoids constructing temporary std::string when looking up by std::string_view.
struct TransparentStringHash {
    using is_transparent = void;
    size_t operator()(std::string_view sv) const noexcept { return std::hash<std::string_view>{}(sv); }
};

struct TransparentStringEqual {
    using is_transparent = void;
    bool operator()(std::string_view a, std::string_view b) const noexcept { return a == b; }
};

}  // namespace velocitydb
