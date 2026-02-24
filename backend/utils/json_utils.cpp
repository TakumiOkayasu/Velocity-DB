#include "json_utils.h"

#include "database/driver_interface.h"

#include <algorithm>
#include <format>
#include <sstream>

namespace velocitydb {

std::string JsonUtils::successResponse(std::string_view data) {
    return std::format(R"({{"success":true,"data":{}}})", data);
}

std::string JsonUtils::errorResponse(std::string_view message) {
    return std::format(R"({{"success":false,"error":"{}"}})", escapeString(message));
}

std::string JsonUtils::escapeString(std::string_view str) {
    // Fast path: check if string needs escaping
    constexpr auto needsEscaping = [](char c) { return c == '"' || c == '\\' || c == '\b' || c == '\f' || c == '\n' || c == '\r' || c == '\t' || static_cast<unsigned char>(c) < 0x20; };
    if (!std::ranges::any_of(str, needsEscaping)) {
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

void JsonUtils::appendColumns(std::string& json, const std::vector<ColumnInfo>& columns) {
    json += R"("columns":[)";
    for (size_t i = 0; i < columns.size(); ++i) {
        if (i > 0)
            json += ',';
        json += R"({"name":")";
        json += escapeString(columns[i].name);
        json += R"(","type":")";
        json += columns[i].type;  // Type names don't need escaping (SQL types are safe)
        json += R"("})";
    }
    json += ']';
}

void JsonUtils::appendResultSetFields(std::string& json, const ResultSet& result) {
    appendColumns(json, result.columns);
    json += R"(,"rows":[)";

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

    json += R"(],"affectedRows":)";
    json += std::to_string(result.affectedRows);
    json += R"(,"executionTimeMs":)";
    json += std::to_string(result.executionTimeMs);
}

std::string JsonUtils::serializeResultSet(const ResultSet& result, bool cached) {
    // Buffer size estimation: base (~150) + columns (~65 each) + rows (per-cell ~2x + overhead)
    size_t estimatedSize = 150 + result.columns.size() * 65;
    for (const auto& row : result.rows) {
        estimatedSize += 10;
        for (const auto& val : row.values) {
            estimatedSize += val.size() * 2 + 5;
        }
    }

    std::string json;
    json.reserve(estimatedSize);

    json += '{';
    appendResultSetFields(json, result);
    json += R"(,"cached":)";
    json += cached ? "true" : "false";
    json += '}';

    return json;
}

}  // namespace velocitydb
