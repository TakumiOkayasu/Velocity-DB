#include "json_utils.h"
#include <sstream>
#include <iomanip>

namespace predategrip {

std::string JsonUtils::successResponse(const std::string& data) {
    return "{\"success\":true,\"data\":" + data + "}";
}

std::string JsonUtils::errorResponse(const std::string& message) {
    return "{\"success\":false,\"error\":\"" + escapeString(message) + "\"}";
}

std::string JsonUtils::escapeString(const std::string& str) {
    std::ostringstream result;
    for (char c : str) {
        switch (c) {
            case '"':  result << "\\\""; break;
            case '\\': result << "\\\\"; break;
            case '\b': result << "\\b"; break;
            case '\f': result << "\\f"; break;
            case '\n': result << "\\n"; break;
            case '\r': result << "\\r"; break;
            case '\t': result << "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    result << "\\u" << std::hex << std::setfill('0') << std::setw(4) << static_cast<int>(c);
                } else {
                    result << c;
                }
                break;
        }
    }
    return result.str();
}

}  // namespace predategrip
