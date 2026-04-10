#include "query_history.h"

#include "simdjson.h"

#include <algorithm>
#include <format>
#include <fstream>
#include <ranges>
#include <sstream>

namespace velocitydb {

void QueryHistory::add(const HistoryItem& item) {
    std::lock_guard lock(m_mutex);

    m_history.insert(m_history.begin(), item);

    while (m_history.size() > m_maxItems) {
        auto it = std::ranges::find_if(m_history | std::views::reverse, [](const HistoryItem& h) { return !h.isFavorite; });

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

    if (keyword.empty()) {
        return m_history;
    }

    // Case-insensitive search without creating lowercase copies of entire strings
    auto caseInsensitiveFind = [](std::string_view haystack, std::string_view needle) -> bool {
        if (needle.size() > haystack.size()) {
            return false;
        }
        auto it = std::search(haystack.begin(), haystack.end(), needle.begin(), needle.end(), [](unsigned char a, unsigned char b) { return std::tolower(a) == std::tolower(b); });
        return it != haystack.end();
    };

    std::vector<HistoryItem> results;
    results.reserve(m_history.size() / 4);  // Estimate ~25% match rate

    for (const auto& item : m_history) {
        if (caseInsensitiveFind(item.sql, keyword)) {
            results.push_back(item);
        }
    }

    return results;
}

std::vector<HistoryItem> QueryHistory::getByDate(std::chrono::system_clock::time_point from, std::chrono::system_clock::time_point to) const {
    std::lock_guard lock(m_mutex);

    std::vector<HistoryItem> results;
    std::ranges::copy_if(m_history, std::back_inserter(results), [from, to](const HistoryItem& item) { return item.timestamp >= from && item.timestamp <= to; });

    return results;
}

void QueryHistory::setFavorite(std::string_view id, bool favorite) {
    std::lock_guard lock(m_mutex);

    if (auto it = std::ranges::find_if(m_history, [id](const HistoryItem& h) { return h.id == id; }); it != m_history.end()) {
        it->isFavorite = favorite;
    }
}

std::vector<HistoryItem> QueryHistory::getFavorites() const {
    std::lock_guard lock(m_mutex);

    std::vector<HistoryItem> results;
    std::ranges::copy_if(m_history, std::back_inserter(results), [](const HistoryItem& item) { return item.isFavorite; });

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

std::expected<void, std::string> QueryHistory::save(std::string_view filepath) const {
    std::lock_guard lock(m_mutex);

    auto path = std::string(filepath);
    std::ofstream outFile;
    outFile.open(path);
    if (!outFile.is_open()) [[unlikely]] {
        return std::unexpected(std::format("Failed to open history file for writing: {}", filepath));
    }

    outFile << "[\n";
    for (size_t i = 0; i < m_history.size(); ++i) {
        const auto& item = m_history[i];
        auto time = std::chrono::system_clock::to_time_t(item.timestamp);

        auto jsonEntry =
            std::format(R"(  {{
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
                        item.id, item.sql, item.connectionId, time, item.executionTimeMs, item.success ? "true" : "false", item.errorMessage, item.affectedRows, item.isFavorite ? "true" : "false");
        outFile << jsonEntry;

        if (i < m_history.size() - 1) {
            outFile << ",";
        }
        outFile << "\n";
    }
    outFile << "]\n";

    if (!outFile.good()) [[unlikely]] {
        return std::unexpected(std::format("Failed to write history file: {}", filepath));
    }
    return {};
}

std::expected<void, std::string> QueryHistory::load(std::string_view filepath) {
    std::lock_guard lock(m_mutex);

    std::string path(filepath);
    std::ifstream inFile(path);
    if (!inFile.is_open()) [[unlikely]] {
        return std::unexpected(std::format("Failed to open history file: {}", filepath));
    }

    std::stringstream buffer;
    buffer << inFile.rdbuf();
    std::string jsonContent = buffer.str();

    if (jsonContent.empty()) {
        return {};  // Empty file is valid
    }

    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(jsonContent);

        if (!doc.is_array()) {
            return std::unexpected("Invalid history file: expected JSON array");
        }

        m_history.clear();

        for (auto item : doc.get_array()) {
            HistoryItem historyItem;

            if (auto id = item["id"].get_string(); !id.error()) {
                historyItem.id = std::string(id.value());
            }
            if (auto sql = item["sql"].get_string(); !sql.error()) {
                historyItem.sql = std::string(sql.value());
            }
            if (auto connId = item["connectionId"].get_string(); !connId.error()) {
                historyItem.connectionId = std::string(connId.value());
            }
            if (auto timestamp = item["timestamp"].get_int64(); !timestamp.error()) {
                historyItem.timestamp = std::chrono::system_clock::from_time_t(timestamp.value());
            }
            if (auto execTime = item["executionTimeMs"].get_double(); !execTime.error()) {
                historyItem.executionTimeMs = execTime.value();
            }
            if (auto success = item["success"].get_bool(); !success.error()) {
                historyItem.success = success.value();
            }
            if (auto errorMsg = item["errorMessage"].get_string(); !errorMsg.error()) {
                historyItem.errorMessage = std::string(errorMsg.value());
            }
            if (auto affected = item["affectedRows"].get_int64(); !affected.error()) {
                historyItem.affectedRows = affected.value();
            }
            if (auto favorite = item["isFavorite"].get_bool(); !favorite.error()) {
                historyItem.isFavorite = favorite.value();
            }

            m_history.push_back(std::move(historyItem));
        }

        return {};
    } catch (const std::exception& e) {
        return std::unexpected(std::format("Failed to parse history file: {}", e.what()));
    }
}

}  // namespace velocitydb
