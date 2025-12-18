#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace predategrip {

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

    /// Serialize a ResultSet to JSON with pre-allocated buffer for performance.
    /// @param result The query result to serialize
    /// @param cached Whether the result was from cache
    /// @return JSON string representation
    [[nodiscard]] static std::string serializeResultSet(const ResultSet& result, bool cached);
};

}  // namespace predategrip
