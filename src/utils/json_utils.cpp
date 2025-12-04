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
    // Estimate buffer size to minimize reallocations
    // Base: ~100 bytes for structure, ~50 bytes per column, ~20 bytes per cell
    size_t estimatedSize = 100 + result.columns.size() * 50;
    for (const auto& row : result.rows) {
        estimatedSize += 10;  // Row overhead
        for (const auto& val : row.values) {
            estimatedSize += val.size() + 5;  // Value + quotes and comma
        }
    }

    std::string json;
    json.reserve(estimatedSize);

    json += '{';

    // Columns array
    json += R"("columns":[)";
    for (size_t i = 0; i < result.columns.size(); ++i) {
        if (i > 0)
            json += ',';
        json +=
            std::format(R"({{"name":"{}","type":"{}"}})", escapeString(result.columns[i].name), result.columns[i].type);
    }
    json += "],";

    // Rows array
    json += R"("rows":[)";
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
    json += "],";

    // Metadata
    json += std::format(R"("affectedRows":{},"executionTimeMs":{},"cached":{}}})", result.affectedRows,
                        result.executionTimeMs, cached ? "true" : "false");

    return json;
}

}  // namespace predategrip
