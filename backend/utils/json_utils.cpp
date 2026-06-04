#include "json_utils.h"

#include "database/driver_interface.h"

#include <algorithm>
#include <array>
#include <format>

namespace velocitydb {
namespace {

// Byte lookup: true when the byte must be escaped in JSON output.
constexpr auto kNeedsEscape = [] {
    std::array<bool, 256> tbl{};
    for (unsigned i = 0; i < 0x20; ++i)
        tbl[i] = true;
    tbl[static_cast<unsigned>('"')] = true;
    tbl[static_cast<unsigned>('\\')] = true;
    return tbl;
}();

// Fixed escape sequences for the 7 named JSON escape characters; nullptr elsewhere.
constexpr auto kEscapeSeq = [] {
    std::array<const char*, 256> tbl{};
    tbl[static_cast<unsigned>('"')] = "\\\"";
    tbl[static_cast<unsigned>('\\')] = "\\\\";
    tbl[static_cast<unsigned>('\b')] = "\\b";
    tbl[static_cast<unsigned>('\f')] = "\\f";
    tbl[static_cast<unsigned>('\n')] = "\\n";
    tbl[static_cast<unsigned>('\r')] = "\\r";
    tbl[static_cast<unsigned>('\t')] = "\\t";
    return tbl;
}();

}  // namespace

std::string JsonUtils::successResponse(std::string_view data) {
    return std::format(R"({{"success":true,"data":{}}})", data);
}

std::string JsonUtils::errorResponse(std::string_view message) {
    return std::format(R"({{"success":false,"error":"{}"}})", escapeString(message));
}

void JsonUtils::appendEscapedString(std::string& json, std::string_view str) {
    const auto* p = str.data();
    const auto* end = p + str.size();
    while (p < end && !kNeedsEscape[static_cast<unsigned char>(*p)])
        ++p;
    if (p == end) {
        json += str;  // fast path: no escapes, single memcpy
        return;
    }
    json.reserve(json.size() + str.size() + str.size() / 8);
    json.append(str.data(), p - str.data());  // safe prefix in one shot
    for (; p < end; ++p) {
        const auto uc = static_cast<unsigned char>(*p);
        if (const char* seq = kEscapeSeq[uc]) {
            json += seq;
        } else if (uc < 0x20) {
            json += std::format("\\u{:04x}", static_cast<unsigned>(uc));
        } else {
            json += *p;
        }
    }
}

void JsonUtils::appendJsonValue(std::string& json, const ResultRow& row, size_t colIndex) {
    if (row.isNull(colIndex)) {
        json += "null";
    } else {
        json += '"';
        appendEscapedString(json, row.values[colIndex]);
        json += '"';
    }
}

std::string JsonUtils::escapeString(std::string_view str) {
    std::string result;
    result.reserve(str.size());
    appendEscapedString(result, str);
    return result;
}

void JsonUtils::appendColumns(std::string& json, const std::vector<ColumnInfo>& columns) {
    json += R"("columns":[)";
    for (size_t i = 0; i < columns.size(); ++i) {
        if (i > 0)
            json += ',';
        json += R"({"name":")";
        appendEscapedString(json, columns[i].name);
        json += R"(","type":")";
        json += columns[i].type;  // Type names don't need escaping (SQL types are safe)
        json += R"("})";
    }
    json += ']';
}

void JsonUtils::appendResultSetFields(std::string& json, const ResultSet& result) {
    appendColumns(json, result.columns);
    json += R"(,"rows":[)";

    auto rowCount = std::min(result.rows.size(), QUERY_ROW_LIMIT);
    bool truncated = result.rows.size() > QUERY_ROW_LIMIT;

    for (size_t rowIndex = 0; rowIndex < rowCount; ++rowIndex) {
        if (rowIndex > 0)
            json += ',';
        json += '[';
        const auto& row = result.rows[rowIndex];
        for (size_t colIndex = 0; colIndex < row.values.size(); ++colIndex) {
            if (colIndex > 0)
                json += ',';
            appendJsonValue(json, row, colIndex);
        }
        json += ']';
    }

    json += R"(],"affectedRows":)";
    json += std::to_string(result.affectedRows);
    json += R"(,"executionTimeMs":)";
    json += std::to_string(result.executionTimeMs);
    json += R"(,"truncated":)";
    json += truncated ? "true" : "false";
}

std::string JsonUtils::serializeResultSet(const ResultSet& result, bool cached) {
    // Buffer size estimation: base (~150) + columns (~65 each) + rows (per-cell ~2x + overhead)
    auto rowLimit = std::min(result.rows.size(), QUERY_ROW_LIMIT);
    size_t estimatedSize = 150 + result.columns.size() * 65;
    for (size_t i = 0; i < rowLimit; ++i) {
        estimatedSize += 10;
        for (const auto& val : result.rows[i].values) {
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
