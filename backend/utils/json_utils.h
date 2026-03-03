#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

// Forward declarations
struct ColumnInfo;
struct ResultRow;
struct ResultSet;

/// JSON utilities with optimized string building for large datasets.
class JsonUtils {
public:
    [[nodiscard]] static std::string successResponse(std::string_view data);
    [[nodiscard]] static std::string errorResponse(std::string_view message);
    [[nodiscard]] static std::string escapeString(std::string_view str);

    /// Maximum rows returned per result set (truncated beyond this).
    static constexpr size_t QUERY_ROW_LIMIT = 10'000;

    /// Serialize a ResultSet to JSON with pre-allocated buffer for performance.
    /// Rows exceeding QUERY_ROW_LIMIT are truncated with a "truncated" flag.
    /// @param result The query result to serialize
    /// @param cached Whether the result was from cache
    /// @return JSON string representation
    [[nodiscard]] static std::string serializeResultSet(const ResultSet& result, bool cached);

    /// Append column definitions as JSON array field: "columns":[...]
    static void appendColumns(std::string& json, const std::vector<ColumnInfo>& columns);

    /// Append a single row value as JSON (null literal or quoted escaped string).
    static void appendJsonValue(std::string& json, const ResultRow& row, size_t colIndex);

    /// Append ResultSet columns/rows/affectedRows/executionTimeMs/truncated as JSON fields (no outer braces).
    /// Rows exceeding QUERY_ROW_LIMIT are truncated.
    /// Use when embedding ResultSet data into a larger JSON object.
    static void appendResultSetFields(std::string& json, const ResultSet& result);

    /// 任意のコレクションから JSON 配列を構築
    template <typename Items, typename Formatter>
    [[nodiscard]] static std::string buildArray(const Items& items, Formatter&& fmt) {
        std::string json = "[";
        bool first = true;
        for (const auto& item : items) {
            if (!first)
                json += ',';
            first = false;
            fmt(json, item);
        }
        json += ']';
        return json;
    }

    /// ResultSet の行から JSON 配列を構築 (bounds check + カンマ処理を共通化)
    template <typename Formatter>
    [[nodiscard]] static std::string buildRowArray(const std::vector<ResultRow>& rows, size_t minColumns, Formatter&& fmt) {
        std::string json = "[";
        bool first = true;
        for (const auto& row : rows) {
            if (row.values.size() < minColumns)
                continue;
            if (!first)
                json += ',';
            first = false;
            fmt(json, row);
        }
        json += ']';
        return json;
    }
};

}  // namespace velocitydb
