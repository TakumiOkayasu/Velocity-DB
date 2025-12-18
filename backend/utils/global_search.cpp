#include "global_search.h"

#include <algorithm>
#include <format>

namespace predategrip {

std::vector<SearchResult> GlobalSearch::searchObjects(SQLServerDriver* driver, const std::string& pattern, const SearchOptions& options) {
    std::vector<SearchResult> results;

    if (driver == nullptr || pattern.empty()) {
        return results;
    }

    std::string query = buildSearchQuery(pattern, options);
    ResultSet queryResult = driver->execute(query);

    for (const auto& row : queryResult.rows) {
        if (results.size() >= static_cast<size_t>(options.maxResults)) {
            break;
        }

        SearchResult result;
        result.objectType = row.values[0];
        result.schemaName = row.values[1];
        result.objectName = row.values[2];
        result.parentName = row.values.size() > 3 ? row.values[3] : "";
        result.matchedText = row.values[2];
        results.push_back(result);
    }

    return results;
}

std::vector<SearchResult> GlobalSearch::searchQueryHistory(const std::vector<std::string>& history, const std::string& pattern, bool caseSensitive) {
    std::vector<SearchResult> results;

    for (size_t i = 0; i < history.size(); ++i) {
        if (matchesPattern(history[i], pattern, caseSensitive)) {
            SearchResult result;
            result.objectType = "history";
            result.objectName = std::format("Query #{}", i + 1);
            result.matchedText = history[i];
            results.push_back(result);
        }
    }

    return results;
}

std::vector<std::string> GlobalSearch::quickSearch(SQLServerDriver* driver, const std::string& prefix, int limit) {
    std::vector<std::string> results;

    if (driver == nullptr || prefix.empty()) {
        return results;
    }

    // Quick search for table and column names
    std::string query = std::format(R"(
        SELECT TOP {} name FROM (
            SELECT TABLE_NAME as name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '{}%'
            UNION
            SELECT COLUMN_NAME as name FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '{}%'
        ) AS combined
        ORDER BY name
    )",
                                    limit, prefix, prefix);

    ResultSet queryResult = driver->execute(query);

    results.reserve(queryResult.rows.size());
    for (const auto& row : queryResult.rows) {
        results.push_back(row.values[0]);
    }

    return results;
}

std::string GlobalSearch::buildSearchQuery(const std::string& pattern, const SearchOptions& options) const {
    std::string likePattern = "%" + pattern + "%";
    std::vector<std::string> unions;

    if (options.searchTables) {
        unions.push_back(std::format(R"(
            SELECT 'TABLE' as object_type, TABLE_SCHEMA as schema_name, TABLE_NAME as object_name, '' as parent_name
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME {} LIKE '{}'
        )",
                                     options.caseSensitive ? "COLLATE Latin1_General_CS_AS" : "", likePattern));
    }

    if (options.searchViews) {
        unions.push_back(std::format(R"(
            SELECT 'VIEW' as object_type, TABLE_SCHEMA as schema_name, TABLE_NAME as object_name, '' as parent_name
            FROM INFORMATION_SCHEMA.VIEWS
            WHERE TABLE_NAME {} LIKE '{}'
        )",
                                     options.caseSensitive ? "COLLATE Latin1_General_CS_AS" : "", likePattern));
    }

    if (options.searchProcedures) {
        unions.push_back(std::format(R"(
            SELECT 'PROCEDURE' as object_type, ROUTINE_SCHEMA as schema_name, ROUTINE_NAME as object_name, '' as parent_name
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_NAME {} LIKE '{}'
        )",
                                     options.caseSensitive ? "COLLATE Latin1_General_CS_AS" : "", likePattern));
    }

    if (options.searchFunctions) {
        unions.push_back(std::format(R"(
            SELECT 'FUNCTION' as object_type, ROUTINE_SCHEMA as schema_name, ROUTINE_NAME as object_name, '' as parent_name
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_TYPE = 'FUNCTION' AND ROUTINE_NAME {} LIKE '{}'
        )",
                                     options.caseSensitive ? "COLLATE Latin1_General_CS_AS" : "", likePattern));
    }

    if (options.searchColumns) {
        unions.push_back(std::format(R"(
            SELECT 'COLUMN' as object_type, TABLE_SCHEMA as schema_name, COLUMN_NAME as object_name, TABLE_NAME as parent_name
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE COLUMN_NAME {} LIKE '{}'
        )",
                                     options.caseSensitive ? "COLLATE Latin1_General_CS_AS" : "", likePattern));
    }

    if (options.searchIndexes) {
        unions.push_back(std::format(R"(
            SELECT 'INDEX' as object_type, OBJECT_SCHEMA_NAME(object_id) as schema_name, name as object_name, OBJECT_NAME(object_id) as parent_name
            FROM sys.indexes
            WHERE name IS NOT NULL AND name {} LIKE '{}'
        )",
                                     options.caseSensitive ? "COLLATE Latin1_General_CS_AS" : "", likePattern));
    }

    if (unions.empty()) {
        return "SELECT 'NONE' as object_type, '' as schema_name, '' as object_name, '' as parent_name WHERE 1=0";
    }

    std::string query = "SELECT TOP " + std::to_string(options.maxResults) + " * FROM (\n";
    for (size_t i = 0; i < unions.size(); ++i) {
        if (i > 0) {
            query += "\n    UNION ALL\n";
        }
        query += unions[i];
    }
    query += "\n) AS search_results ORDER BY object_type, object_name";

    return query;
}

bool GlobalSearch::matchesPattern(const std::string& text, const std::string& pattern, bool caseSensitive) const {
    if (caseSensitive) {
        return text.find(pattern) != std::string::npos;
    }

    // Case-insensitive search
    std::string lowerText = text;
    std::string lowerPattern = pattern;
    std::transform(lowerText.begin(), lowerText.end(), lowerText.begin(), ::tolower);
    std::transform(lowerPattern.begin(), lowerPattern.end(), lowerPattern.begin(), ::tolower);
    return lowerText.find(lowerPattern) != std::string::npos;
}

}  // namespace predategrip
