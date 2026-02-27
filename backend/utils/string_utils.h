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

/// Case-insensitive char projection for std::ranges algorithms
inline constexpr auto toLowerChar = [](unsigned char c) -> char { return static_cast<char>(std::tolower(c)); };

/// Convert string to uppercase
[[nodiscard]] inline std::string toUpper(std::string_view str) {
    return str | std::views::transform([](unsigned char c) -> char { return static_cast<char>(std::toupper(c)); }) | std::ranges::to<std::string>();
}

/// Extract the first line as a display label (for multi-line statements like COPY blocks).
[[nodiscard]] inline std::string_view firstLine(std::string_view str) {
    auto nl = str.find('\n');
    return nl != std::string_view::npos ? str.substr(0, nl) : str;
}

}  // namespace velocitydb
