#include "global_search.h"

#include <algorithm>
#include <cctype>
#include <format>
#include <ranges>

namespace velocitydb {

std::vector<SearchResult> GlobalSearch::searchObjects(IDatabaseDriver* driver, IObjectSearchable* dialect, const std::string& pattern, const SearchOptions& options) {
    std::vector<SearchResult> results;

    if (driver == nullptr || dialect == nullptr || pattern.empty()) {
        return results;
    }

    std::string query = dialect->searchObjectsQuery(pattern, options.caseSensitive, options.maxResults, options.toCategories());
    auto queryResult = driver->execute(query);

    for (const auto& row : queryResult.rows) {
        if (results.size() >= static_cast<size_t>(options.maxResults))
            break;
        if (row.values.size() < 3)
            continue;

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

std::vector<std::string> GlobalSearch::quickSearch(IDatabaseDriver* driver, IObjectSearchable* dialect, const std::string& prefix, int limit) {
    std::vector<std::string> results;

    if (driver == nullptr || dialect == nullptr || prefix.empty()) {
        return results;
    }

    auto query = dialect->quickSearchQuery(prefix, std::clamp(limit, 1, 100));
    auto queryResult = driver->execute(query);

    results.reserve(queryResult.rows.size());
    for (const auto& row : queryResult.rows) {
        if (!row.values.empty())
            results.emplace_back(row.values[0]);
    }

    return results;
}

bool GlobalSearch::matchesPattern(const std::string& text, const std::string& pattern, bool caseSensitive) const {
    if (caseSensitive) {
        return text.find(pattern) != std::string::npos;
    }

    // Case-insensitive search
    auto lowerText = text;
    auto lowerPattern = pattern;
    std::ranges::transform(lowerText, lowerText.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    std::ranges::transform(lowerPattern, lowerPattern.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return lowerText.find(lowerPattern) != std::string::npos;
}

}  // namespace velocitydb
