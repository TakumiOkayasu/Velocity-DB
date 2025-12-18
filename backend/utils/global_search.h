#pragma once

#include "../database/sqlserver_driver.h"

#include <string>
#include <vector>

namespace predategrip {

struct SearchResult {
    std::string objectType;  // table, view, procedure, function, column, etc.
    std::string schemaName;
    std::string objectName;
    std::string parentName;  // For columns, this is the table name
    std::string matchedText;
    int matchPosition = 0;
};

struct SearchOptions {
    bool searchTables = true;
    bool searchViews = true;
    bool searchProcedures = true;
    bool searchFunctions = true;
    bool searchColumns = true;
    bool searchIndexes = false;
    bool caseSensitive = false;
    int maxResults = 100;
};

class GlobalSearch {
public:
    GlobalSearch() = default;
    ~GlobalSearch() = default;

    GlobalSearch(const GlobalSearch&) = delete;
    GlobalSearch& operator=(const GlobalSearch&) = delete;

    /// Search database objects by name pattern
    [[nodiscard]] std::vector<SearchResult> searchObjects(SQLServerDriver* driver, const std::string& pattern, const SearchOptions& options = {});

    /// Search within query history
    [[nodiscard]] std::vector<SearchResult> searchQueryHistory(const std::vector<std::string>& history, const std::string& pattern, bool caseSensitive = false);

    /// Quick search for object names (autocomplete)
    [[nodiscard]] std::vector<std::string> quickSearch(SQLServerDriver* driver, const std::string& prefix, int limit = 20);

private:
    [[nodiscard]] std::string buildSearchQuery(const std::string& pattern, const SearchOptions& options) const;
    [[nodiscard]] bool matchesPattern(const std::string& text, const std::string& pattern, bool caseSensitive) const;
};

}  // namespace predategrip
