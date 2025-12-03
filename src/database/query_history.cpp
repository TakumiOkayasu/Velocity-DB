#include "query_history.h"

#include <algorithm>
#include <format>
#include <fstream>
#include <ranges>

namespace predategrip {

void QueryHistory::add(const HistoryItem& item) {
    std::lock_guard lock(m_mutex);

    m_history.insert(m_history.begin(), item);

    while (m_history.size() > m_maxItems) {
        auto it =
            std::ranges::find_if(m_history | std::views::reverse, [](const HistoryItem& h) { return !h.isFavorite; });

        if (it != (m_history | std::views::reverse).end()) {
            m_history.erase(std::next(it).base());
        } else {
            break;
        }
    }
}

std::vector<HistoryItem> QueryHistory::getAll() const {
    std::lock_guard lock(m_mutex);
    return m_history;
}

std::vector<HistoryItem> QueryHistory::search(std::string_view keyword) const {
    std::lock_guard lock(m_mutex);

    std::string lowerKeyword(keyword);
    std::ranges::transform(lowerKeyword, lowerKeyword.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    std::vector<HistoryItem> results;
    for (const auto& item : m_history) {
        std::string lowerSql = item.sql;
        std::ranges::transform(lowerSql, lowerSql.begin(),
                               [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

        if (lowerSql.find(lowerKeyword) != std::string::npos) {
            results.push_back(item);
        }
    }

    return results;
}

std::vector<HistoryItem> QueryHistory::getByDate(std::chrono::system_clock::time_point from,
                                                 std::chrono::system_clock::time_point to) const {
    std::lock_guard lock(m_mutex);

    std::vector<HistoryItem> results;
    std::ranges::copy_if(m_history, std::back_inserter(results), [from, to](const HistoryItem& item) {
        return item.timestamp >= from && item.timestamp <= to;
    });

    return results;
}

void QueryHistory::setFavorite(std::string_view id, bool favorite) {
    std::lock_guard lock(m_mutex);

    if (auto it = std::ranges::find_if(m_history, [id](const HistoryItem& h) { return h.id == id; });
        it != m_history.end()) {
        it->isFavorite = favorite;
    }
}

std::vector<HistoryItem> QueryHistory::getFavorites() const {
    std::lock_guard lock(m_mutex);

    std::vector<HistoryItem> results;
    std::ranges::copy_if(m_history, std::back_inserter(results),
                         [](const HistoryItem& item) { return item.isFavorite; });

    return results;
}

void QueryHistory::remove(std::string_view id) {
    std::lock_guard lock(m_mutex);

    std::erase_if(m_history, [id](const HistoryItem& h) { return h.id == id; });
}

void QueryHistory::clear() {
    std::lock_guard lock(m_mutex);

    std::erase_if(m_history, [](const HistoryItem& h) { return !h.isFavorite; });
}

bool QueryHistory::save(std::string_view filepath) const {
    std::lock_guard lock(m_mutex);

    auto path = std::string(filepath);
    std::ofstream outFile;
    outFile.open(path);
    if (!outFile.is_open()) [[unlikely]] {
        return false;
    }

    outFile << "[\n";
    for (size_t i = 0; i < m_history.size(); ++i) {
        const auto& item = m_history[i];
        auto time = std::chrono::system_clock::to_time_t(item.timestamp);

        auto jsonEntry = std::format(R"(  {{
    "id": "{}",
    "sql": "{}",
    "connectionId": "{}",
    "timestamp": {},
    "executionTimeMs": {},
    "success": {},
    "errorMessage": "{}",
    "affectedRows": {},
    "isFavorite": {}
  }})",
                                     item.id, item.sql, item.connectionId, time, item.executionTimeMs,
                                     item.success ? "true" : "false", item.errorMessage, item.affectedRows,
                                     item.isFavorite ? "true" : "false");
        outFile << jsonEntry;

        if (i < m_history.size() - 1) {
            outFile << ",";
        }
        outFile << "\n";
    }
    outFile << "]\n";

    return true;
}

bool QueryHistory::load(std::string_view) {
    // TODO: Implement JSON parsing with simdjson
    return false;
}

}  // namespace predategrip
