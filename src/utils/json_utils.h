#pragma once

#include <string>

namespace predategrip {

class JsonUtils {
public:
    static std::string successResponse(const std::string& data);
    static std::string errorResponse(const std::string& message);
    static std::string escapeString(const std::string& str);
};

}  // namespace predategrip
