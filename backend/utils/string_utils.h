#pragma once

#include <algorithm>
#include <cctype>
#include <ranges>
#include <string>
#include <string_view>

namespace velocitydb {

/// Trim whitespace from both ends of a string view
[[nodiscard]] inline std::string_view trim(std::string_view str) {
    constexpr auto isSpace = [](unsigned char c) { return std::isspace(c) != 0; };
    auto start = std::ranges::find_if_not(str, isSpace);
    auto end = std::ranges::find_if_not(str | std::views::reverse, isSpace).base();
    if (start >= end)
        return {};
    return str.substr(start - str.begin(), end - start);
}

/// Convert string to uppercase
[[nodiscard]] inline std::string toUpper(std::string_view str) {
    std::string result(str);
    std::ranges::transform(result, result.begin(), [](unsigned char c) { return std::toupper(c); });
    return result;
}

}  // namespace velocitydb
