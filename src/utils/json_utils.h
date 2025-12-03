#pragma once

#include <string>
#include <string_view>

namespace predategrip {

class JsonUtils {
public:
    [[nodiscard]] static std::string successResponse(std::string_view data);
    [[nodiscard]] static std::string errorResponse(std::string_view message);
    [[nodiscard]] static std::string escapeString(std::string_view str);
};

}  // namespace predategrip
