#include "query_history.h"
#include <algorithm>
#include <fstream>
#include <sstream>
#include <iomanip>

namespace predategrip {

QueryHistory::QueryHistory(size_t maxItems)
    : m_maxItems(maxItems)
{
}

void QueryHistory::add(const HistoryItem& item) {
    std::lock_guard<std::mutex> lock(m_mutex);

    m_history.insert(m_history.begin(), item);

    // Remove oldest items if exceeding max
    while (m_history.size() > m_maxItems) {
        // Don't remove favorites
        auto it = std::find_if(m_history.rbegin(), m_history.rend(),
            [](const HistoryItem& h) { return !h.isFavorite; });
        if (it != m_history.rend()) {
            m_history.erase(std::next(it).base());
        } else {
            break;  // All items are favorites
        }
    }
}

std::vector<HistoryItem> QueryHistory::getAll() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_history;
}

std::vector<HistoryItem> QueryHistory::search(const std::string& keyword) const {
    std::lock_guard<std::mutex> lock(m_mutex);

    std::vector<HistoryItem> results;
    std::string lowerKeyword = keyword;
    std::transform(lowerKeyword.begin(), lowerKeyword.end(), lowerKeyword.begin(), ::tolower);

    for (const auto& item : m_history) {
        std::string lowerSql = item.sql;
        std::transform(lowerSql.begin(), lowerSql.end(), lowerSql.begin(), ::tolower);

        if (lowerSql.find(lowerKeyword) != std::string::npos) {
            results.push_back(item);
        }
    }

    return results;
}

std::vector<HistoryItem> QueryHistory::getByDate(
    std::chrono::system_clock::time_point from,
    std::chrono::system_clock::time_point to) const
{
    std::lock_guard<std::mutex> lock(m_mutex);

    std::vector<HistoryItem> results;
    for (const auto& item : m_history) {
        if (item.timestamp >= from && item.timestamp <= to) {
            results.push_back(item);
        }
    }

    return results;
}

void QueryHistory::setFavorite(const std::string& id, bool favorite) {
    std::lock_guard<std::mutex> lock(m_mutex);

    auto it = std::find_if(m_history.begin(), m_history.end(),
        [&id](const HistoryItem& h) { return h.id == id; });

    if (it != m_history.end()) {
        it->isFavorite = favorite;
    }
}

std::vector<HistoryItem> QueryHistory::getFavorites() const {
    std::lock_guard<std::mutex> lock(m_mutex);

    std::vector<HistoryItem> results;
    for (const auto& item : m_history) {
        if (item.isFavorite) {
            results.push_back(item);
        }
    }

    return results;
}

void QueryHistory::remove(const std::string& id) {
    std::lock_guard<std::mutex> lock(m_mutex);

    m_history.erase(
        std::remove_if(m_history.begin(), m_history.end(),
            [&id](const HistoryItem& h) { return h.id == id; }),
        m_history.end()
    );
}

void QueryHistory::clear() {
    std::lock_guard<std::mutex> lock(m_mutex);

    // Keep favorites
    m_history.erase(
        std::remove_if(m_history.begin(), m_history.end(),
            [](const HistoryItem& h) { return !h.isFavorite; }),
        m_history.end()
    );
}

bool QueryHistory::save(const std::string& filepath) const {
    std::lock_guard<std::mutex> lock(m_mutex);

    std::ofstream file(filepath);
    if (!file.is_open()) {
        return false;
    }

    // Simple JSON format
    file << "[\n";
    for (size_t i = 0; i < m_history.size(); ++i) {
        const auto& item = m_history[i];
        auto time = std::chrono::system_clock::to_time_t(item.timestamp);

        file << "  {\n";
        file << "    \"id\": \"" << item.id << "\",\n";
        file << "    \"sql\": \"" << item.sql << "\",\n";  // TODO: escape
        file << "    \"connectionId\": \"" << item.connectionId << "\",\n";
        file << "    \"timestamp\": " << time << ",\n";
        file << "    \"executionTimeMs\": " << item.executionTimeMs << ",\n";
        file << "    \"success\": " << (item.success ? "true" : "false") << ",\n";
        file << "    \"errorMessage\": \"" << item.errorMessage << "\",\n";
        file << "    \"affectedRows\": " << item.affectedRows << ",\n";
        file << "    \"isFavorite\": " << (item.isFavorite ? "true" : "false") << "\n";
        file << "  }";
        if (i < m_history.size() - 1) {
            file << ",";
        }
        file << "\n";
    }
    file << "]\n";

    return true;
}

bool QueryHistory::load(const std::string& filepath) {
    // TODO: Implement JSON parsing with simdjson
    return false;
}

}  // namespace predategrip
