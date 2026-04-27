#include "query_history.h"

#include "simdjson.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cctype>
#include <format>
#include <fstream>
#include <ranges>
#include <sstream>
#include <unordered_set>

namespace velocitydb {

namespace {

/// ASCII のみ lowercase 折りたたみ。UTF-8 multi-byte (>= 0x80) は std::tolower の定義域外だが
/// unsigned char 経由で UB を回避し、戻り値を変えないことで non-ASCII の identity を保つ。
inline char normalizeByte(unsigned char c) noexcept {
    return static_cast<char>(std::tolower(c));
}

/// sql の byte 単位 sliding window で trigram を yield する。size<3 なら no-op。
/// UTF-8 lead byte に開始位置を限定しない: index と検索の trigram 集合の対称性を優先し、
/// 偽陽性は最終 substring 検証で除外する。
template <typename F>
void forEachTrigram(std::string_view sql, F&& fn) {
    if (sql.size() < 3)
        return;
    for (size_t i = 0; i + 3 <= sql.size(); ++i) {
        std::array<char, 3> t{
            normalizeByte(static_cast<unsigned char>(sql[i])),
            normalizeByte(static_cast<unsigned char>(sql[i + 1])),
            normalizeByte(static_cast<unsigned char>(sql[i + 2])),
        };
        fn(t);
    }
}

bool caseInsensitiveFind(std::string_view haystack, std::string_view needle) {
    if (needle.size() > haystack.size()) {
        return false;
    }
    auto it = std::search(haystack.begin(), haystack.end(), needle.begin(), needle.end(), [](unsigned char a, unsigned char b) { return std::tolower(a) == std::tolower(b); });
    return it != haystack.end();
}

}  // namespace

std::vector<QueryHistory::Trigram> QueryHistory::buildUniqueTrigrams(std::string_view sql) {
    // unordered_set で per-trigram O(1) 重複検出。全体 O(L) (L = sql.size())。
    // 戻り値の順序は非保証だが、呼び出し側は重複なし集合として扱うのみで順序非依存。
    std::unordered_set<Trigram, TrigramHash> seen;
    seen.reserve(sql.size());
    std::vector<Trigram> result;
    result.reserve(sql.size());
    forEachTrigram(sql, [&seen, &result](const Trigram& t) {
        if (seen.insert(t).second) {
            result.push_back(t);
        }
    });
    return result;
}

void QueryHistory::addToTrigramIndex(HistoryIter it) {
    const HistoryItem* ptr = &*it;
    for (const auto& t : buildUniqueTrigrams(it->sql)) {
        m_trigramIndex[t].insert(ptr);
    }
}

void QueryHistory::removeFromTrigramIndex(HistoryIter it) {
    const HistoryItem* ptr = &*it;
    for (const auto& t : buildUniqueTrigrams(it->sql)) {
        auto mit = m_trigramIndex.find(t);
        if (mit == m_trigramIndex.end())
            continue;
        mit->second.erase(ptr);
        if (mit->second.empty()) {
            m_trigramIndex.erase(mit);
        }
    }
}

void QueryHistory::add(const HistoryItem& item) {
    // 事前条件: 呼び出し側 (provider 等) が generateHistoryId() で id を埋める。
    // 空 id を許すと map キーが衝突して履歴が破損するため、契約として弾く。
    assert(!item.id.empty() && "QueryHistory::add requires non-empty id; caller must use generateHistoryId()");

    std::lock_guard lock(m_mutex);

    if (auto existing = m_indexById.find(item.id); existing != m_indexById.end()) {
        if (!existing->second->isFavorite) {
            --m_nonFavoriteCount;
        }
        removeFromTrigramIndex(existing->second);
        m_history.erase(existing->second);
        m_indexById.erase(existing);
    }

    m_history.push_front(item);
    auto inserted = m_history.begin();
    m_indexById.emplace(inserted->id, inserted);
    addToTrigramIndex(inserted);
    if (!inserted->isFavorite) {
        ++m_nonFavoriteCount;
    }

    evictOverLimitLocked();
}

void QueryHistory::evictOverLimitLocked() {
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
        removeFromTrigramIndex(victim);
        m_history.erase(victim);
        --m_nonFavoriteCount;
    }
}

void QueryHistory::setMaxItems(size_t maxItems) {
    std::lock_guard lock(m_mutex);
    m_maxItems = maxItems;
    evictOverLimitLocked();
}

std::vector<HistoryItem> QueryHistory::getAll() const {
    std::lock_guard lock(m_mutex);
    return {m_history.begin(), m_history.end()};
}

std::unordered_set<const HistoryItem*> QueryHistory::findSearchCandidatesLocked(std::string_view keyword) const {
    const auto queryTrigrams = buildUniqueTrigrams(keyword);

    std::vector<const std::unordered_set<const HistoryItem*>*> postings;
    postings.reserve(queryTrigrams.size());
    for (const auto& t : queryTrigrams) {
        auto mit = m_trigramIndex.find(t);
        if (mit == m_trigramIndex.end()) {
            return {};
        }
        postings.push_back(&mit->second);
    }

    // 最短 posting を起点に、各候補が他全 posting に含まれるかチェック (AND 交差)。
    // unordered_set::contains は O(1) なので候補 K 個 × posting M 個で O(K*M)。
    auto shortest = std::ranges::min_element(postings, {}, [](const auto* p) { return p->size(); });
    std::unordered_set<const HistoryItem*> candidates;
    for (const auto* cand : **shortest) {
        const bool inAll = std::ranges::all_of(postings, [cand](const auto* p) { return p->contains(cand); });
        if (inAll) {
            candidates.insert(cand);
        }
    }
    return candidates;
}

std::vector<HistoryItem> QueryHistory::search(std::string_view keyword) const {
    std::lock_guard lock(m_mutex);

    if (keyword.empty()) {
        return {m_history.begin(), m_history.end()};
    }

    // 短語 (< 3 byte) は trigram 化不能 → 既存と同じ線形 substring search にフォールバック。
    if (keyword.size() < 3) {
        std::vector<HistoryItem> results;
        for (const auto& item : m_history) {
            if (caseInsensitiveFind(item.sql, keyword)) {
                results.push_back(item);
            }
        }
        return results;
    }

    const auto candidates = findSearchCandidatesLocked(keyword);

    // m_history を順走査して final substring 検証。LRU 順 (newest first) を保持する。
    std::vector<HistoryItem> results;
    results.reserve(candidates.size());
    for (const auto& item : m_history) {
        if (!candidates.contains(&item))
            continue;
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
    removeFromTrigramIndex(it->second);
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
            removeFromTrigramIndex(it);
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
        m_trigramIndex.clear();
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
            } else {
                addToTrigramIndex(last);
                if (!last->isFavorite) {
                    ++m_nonFavoriteCount;
                }
            }
        }

        return {};
    } catch (const std::exception& e) {
        return std::unexpected(std::format("Failed to parse history file: {}", e.what()));
    }
}

}  // namespace velocitydb
