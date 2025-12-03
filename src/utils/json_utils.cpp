#include "json_utils.h"

#include <format>

namespace predategrip {

std::string JsonUtils::successResponse(std::string_view data) {
    return std::format(R"({{"success":true,"data":{}}})", data);
}

std::string JsonUtils::errorResponse(std::string_view message) {
    return std::format(R"({{"success":false,"error":"{}"}})", escapeString(message));
}

std::string JsonUtils::escapeString(std::string_view str) {
    std::string result;
    result.reserve(str.size() + str.size() / 8);

    for (char c : str) {
        switch (c) {
            case '"':
                result += "\\\"";
                break;
            case '\\':
                result += "\\\\";
                break;
            case '\b':
                result += "\\b";
                break;
            case '\f':
                result += "\\f";
                break;
            case '\n':
                result += "\\n";
                break;
            case '\r':
                result += "\\r";
                break;
            case '\t':
                result += "\\t";
                break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    result += std::format("\\u{:04x}", static_cast<int>(c));
                } else {
                    result += c;
                }
                break;
        }
    }
    return result;
}

}  // namespace predategrip
