#pragma once

#include "../database/driver_interface.h"
#include "../interfaces/object_searchable.h"

#include <string>
#include <vector>

namespace velocitydb {

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

    /// Convert bool flags to SearchCategory bitmask
    [[nodiscard]] uint8_t toCategories() const noexcept {
        uint8_t categories = 0;
        if (searchTables)
            categories |= SearchCategory::Tables;
        if (searchViews)
            categories |= SearchCategory::Views;
        if (searchProcedures)
            categories |= SearchCategory::Procedures;
        if (searchFunctions)
            categories |= SearchCategory::Functions;
        if (searchColumns)
            categories |= SearchCategory::Columns;
        if (searchIndexes)
            categories |= SearchCategory::Indexes;
        return categories;
    }
};

class GlobalSearch {
public:
    GlobalSearch() = default;
    ~GlobalSearch() = default;

    GlobalSearch(const GlobalSearch&) = delete;
    GlobalSearch& operator=(const GlobalSearch&) = delete;

    /// Search database objects by name pattern
    [[nodiscard]] std::vector<SearchResult> searchObjects(IDatabaseDriver* driver, IObjectSearchable* dialect, const std::string& pattern, const SearchOptions& options = {});

    /// Search within query history
    [[nodiscard]] std::vector<SearchResult> searchQueryHistory(const std::vector<std::string>& history, const std::string& pattern, bool caseSensitive = false);

    /// Quick search for object names (autocomplete)
    [[nodiscard]] std::vector<std::string> quickSearch(IDatabaseDriver* driver, IObjectSearchable* dialect, const std::string& prefix, int limit = 20);

private:
    [[nodiscard]] bool matchesPattern(const std::string& text, const std::string& pattern, bool caseSensitive) const;
};

}  // namespace velocitydb
