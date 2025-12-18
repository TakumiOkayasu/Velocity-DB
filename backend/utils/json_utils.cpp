#include "json_utils.h"

#include "database/sqlserver_driver.h"

#include <format>
#include <sstream>

namespace predategrip {

std::string JsonUtils::successResponse(std::string_view data) {
    return std::format(R"({{"success":true,"data":{}}})", data);
}

std::string JsonUtils::errorResponse(std::string_view message) {
    return std::format(R"({{"success":false,"error":"{}"}})", escapeString(message));
}

std::string JsonUtils::escapeString(std::string_view str) {
    // Fast path: check if string needs escaping
    bool needsEscape = false;
    for (char c : str) {
        if (c == '"' || c == '\\' || c == '\b' || c == '\f' || c == '\n' || c == '\r' || c == '\t' || static_cast<unsigned char>(c) < 0x20) {
            needsEscape = true;
            break;
        }
    }

    // If no special characters, return as-is (avoid allocation)
    if (!needsEscape) {
        return std::string(str);
    }

    // Slow path: escape special characters
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

std::string JsonUtils::serializeResultSet(const ResultSet& result, bool cached) {
    // Improved buffer size estimation to minimize reallocations
    // Base structure: ~150 bytes
    // Per column: name (avg 20) + type (avg 15) + JSON overhead (30) = ~65 bytes
    // Per row: overhead (~10 bytes) + per cell (value + escape overhead + quotes/comma ~1.5x value size)
    size_t estimatedSize = 150 + result.columns.size() * 65;
    for (const auto& row : result.rows) {
        estimatedSize += 10;  // Row overhead (brackets, commas)
        for (const auto& val : row.values) {
            // Account for escape characters (worst case: ~2x size) + quotes and commas
            estimatedSize += val.size() * 2 + 5;
        }
    }

    std::string json;
    json.reserve(estimatedSize);

    json += R"({"columns":[)";

    // Columns array - avoid std::format in tight loop for better performance
    for (size_t i = 0; i < result.columns.size(); ++i) {
        if (i > 0)
            json += ',';
        json += R"({"name":")";
        json += escapeString(result.columns[i].name);
        json += R"(","type":")";
        json += result.columns[i].type;  // Type names don't need escaping (SQL types are safe)
        json += R"("})";
    }
    json += R"(],"rows":[)";

    // Rows array - minimize allocations and function calls
    for (size_t rowIndex = 0; rowIndex < result.rows.size(); ++rowIndex) {
        if (rowIndex > 0)
            json += ',';
        json += '[';
        const auto& row = result.rows[rowIndex];
        for (size_t colIndex = 0; colIndex < row.values.size(); ++colIndex) {
            if (colIndex > 0)
                json += ',';
            json += '"';
            json += escapeString(row.values[colIndex]);
            json += '"';
        }
        json += ']';
    }

    // Metadata - build directly instead of using std::format
    json += R"(],"affectedRows":)";
    json += std::to_string(result.affectedRows);
    json += R"(,"executionTimeMs":)";
    json += std::to_string(result.executionTimeMs);
    json += R"(,"cached":)";
    json += cached ? "true" : "false";
    json += '}';

    return json;
}

}  // namespace predategrip
