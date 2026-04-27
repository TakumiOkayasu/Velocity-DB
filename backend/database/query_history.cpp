#include "query_history.h"

#include "simdjson.h"

#include <algorithm>
#include <cassert>
#include <format>
#include <fstream>
#include <ranges>
#include <sstream>

namespace velocitydb {

void QueryHistory::add(const HistoryItem& item) {
    // 事前条件: 呼び出し側 (provider 等) が generateHistoryId() で id を埋める。
    // 空 id を許すと map キーが衝突して履歴が破損するため、契約として弾く。
    assert(!item.id.empty() && "QueryHistory::add requires non-empty id; caller must use generateHistoryId()");

    std::lock_guard lock(m_mutex);

    if (auto existing = m_indexById.find(item.id); existing != m_indexById.end()) {
        if (!existing->second->isFavorite) {
            --m_nonFavoriteCount;
        }
        m_history.erase(existing->second);
        m_indexById.erase(existing);
    }

    m_history.push_front(item);
    auto inserted = m_history.begin();
    m_indexById.emplace(inserted->id, inserted);
    if (!inserted->isFavorite) {
        ++m_nonFavoriteCount;
    }

    // eviction: 平均 O(1) (通常は末尾が非 favorite)。
    // 全 favorite 状態は m_nonFavoriteCount で先に判定して O(1) で skip する。
    while (m_history.size() > m_maxItems) {
        if (m_nonFavoriteCount == 0) {
            break;  // 全要素 favorite — eviction 対象なし
        }

        auto rit = std::ranges::find_if(m_history | std::views::reverse, [](const HistoryItem& h) { return !h.isFavorite; });
        if (rit == (m_history | std::views::reverse).end()) {
            // counter と list が一致していれば到達不能。防御的 break。
            assert(false && "m_nonFavoriteCount out of sync with m_history");
            break;
        }

        auto victim = std::next(rit).base();
        m_indexById.erase(victim->id);
        m_history.erase(victim);
        --m_nonFavoriteCount;
    }
}

std::vector<HistoryItem> QueryHistory::getAll() const {
    std::lock_guard lock(m_mutex);
    return {m_history.begin(), m_history.end()};
}

std::vector<HistoryItem> QueryHistory::search(std::string_view keyword) const {
    std::lock_guard lock(m_mutex);

    if (keyword.empty()) {
        return {m_history.begin(), m_history.end()};
    }

    auto caseInsensitiveFind = [](std::string_view haystack, std::string_view needle) -> bool {
        if (needle.size() > haystack.size()) {
            return false;
        }
        auto it = std::search(haystack.begin(), haystack.end(), needle.begin(), needle.end(), [](unsigned char a, unsigned char b) { return std::tolower(a) == std::tolower(b); });
        return it != haystack.end();
    };

    std::vector<HistoryItem> results;
    results.reserve(m_history.size() / 4);

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

    if (auto it = m_indexById.find(id); it != m_indexById.end()) {
        if (it->second->isFavorite && !favorite) {
            ++m_nonFavoriteCount;
        } else if (!it->second->isFavorite && favorite) {
            --m_nonFavoriteCount;
        }
        it->second->isFavorite = favorite;
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

    auto it = m_indexById.find(id);
    if (it == m_indexById.end()) {
        return;
    }
    if (!it->second->isFavorite) {
        --m_nonFavoriteCount;
    }
    m_history.erase(it->second);
    m_indexById.erase(it);
}

void QueryHistory::clear() {
    std::lock_guard lock(m_mutex);

    for (auto it = m_history.begin(); it != m_history.end();) {
        if (it->isFavorite) {
            ++it;
        } else {
            m_indexById.erase(it->id);
            it = m_history.erase(it);
        }
    }
    m_nonFavoriteCount = 0;
}

std::expected<void, std::string> QueryHistory::save(std::string_view filepath) const {
    std::lock_guard lock(m_mutex);

    auto path = std::string(filepath);
    std::ofstream outFile;
    outFile.open(path);
    if (!outFile.is_open()) [[unlikely]] {
        return std::unexpected(std::format("Failed to open history file for writing: {}", filepath));
    }

    outFile << "[";
    bool first = true;
    for (const auto& item : m_history) {
        if (!first) {
            outFile << ",";
        }
        outFile << "\n";
        first = false;

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
    }
    if (!m_history.empty()) {
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
        return {};
    }

    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(jsonContent);

        if (!doc.is_array()) {
            return std::unexpected("Invalid history file: expected JSON array");
        }

        m_history.clear();
        m_indexById.clear();
        m_nonFavoriteCount = 0;

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

            if (historyItem.id.empty()) {
                // 不正な入力 (id 欠落) はスキップ。読み込み全体を中断する代わりに防御的に無視する。
                continue;
            }

            m_history.push_back(std::move(historyItem));
            auto last = std::prev(m_history.end());
            if (auto [_, inserted] = m_indexById.emplace(last->id, last); !inserted) {
                // 重複 id を検出。新エントリを破棄して map との整合を維持する。
                m_history.pop_back();
            } else if (!last->isFavorite) {
                ++m_nonFavoriteCount;
            }
        }

        return {};
    } catch (const std::exception& e) {
        return std::unexpected(std::format("Failed to parse history file: {}", e.what()));
    }
}

}  // namespace velocitydb
