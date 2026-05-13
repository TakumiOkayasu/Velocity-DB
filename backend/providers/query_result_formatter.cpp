#include "query_result_formatter.h"

#include "../database/driver_interface.h"
#include "../search/simd_filter.h"
#include "../utils/json_utils.h"

#include <deque>
#include <format>
#include <memory>
#include <string>

namespace velocitydb {

ResultSet QueryResultFormatter::buildUseStatementResult(std::string_view dbName) {
    // affectedRows / executionTimeMs は ResultSet のデフォルトメンバ初期化 (0 / 0.0) に任せる。
    // executionTimeMs は呼び出し元 (executeQuery) が計測値で上書きする契約。
    ResultSet rs;
    rs.columns.push_back({.name = "Message", .type = "VARCHAR", .size = 255, .nullable = false, .isPrimaryKey = false});

    // Synthetic single-cell result: store the formatted message in an arena
    // so ResultRow::values (string_view) has stable backing memory.
    auto arena = std::make_shared<std::deque<std::string>>();
    arena->emplace_back(std::format("Database changed to {}", dbName));

    ResultRow row;
    row.values.emplace_back(arena->back());
    row.nullFlags.push_back(false);
    rs.rows.push_back(std::move(row));
    rs.storage = std::move(arena);
    return rs;
}

std::string QueryResultFormatter::buildMultipleResultsJson(std::span<const NamedResult> results) {
    std::string json = R"({"multipleResults":true,"results":[)";
    for (size_t i = 0; i < results.size(); ++i) {
        if (i > 0)
            json += ',';
        json += R"({"statement":")";
        json += JsonUtils::escapeString(results[i].statement);
        json += R"(","data":)";
        json += JsonUtils::serializeResultSet(results[i].result.get(), false);
        json += '}';
    }
    json += "]}";
    return json;
}

std::string QueryResultFormatter::buildFilteredResultJson(const ResultSet& result, std::span<const size_t> matchingIndices) {
    std::string json = "{";
    JsonUtils::appendColumns(json, result.columns);
    json += R"(,"rows":[)";
    for (size_t i = 0; i < matchingIndices.size(); ++i) {
        if (i > 0)
            json += ',';
        json += '[';
        const auto& row = result.rows[matchingIndices[i]];
        for (size_t colIndex = 0; colIndex < row.values.size(); ++colIndex) {
            if (colIndex > 0)
                json += ',';
            JsonUtils::appendJsonValue(json, row, colIndex);
        }
        json += ']';
    }
    json += "],";
    json += std::format(R"("totalRows":{},"filteredRows":{},"simdAvailable":{}}})", result.rows.size(), matchingIndices.size(), SIMDFilter::isAVX2Available() ? "true" : "false");
    return json;
}

}  // namespace velocitydb
