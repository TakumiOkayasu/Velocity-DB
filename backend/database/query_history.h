#pragma once

#include "../utils/transparent_hash.h"

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <expected>
#include <format>
#include <list>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace velocitydb {

/// Truncate SQL to a safe size for history storage.
constexpr size_t MAX_HISTORY_SQL_BYTES = 10240;  // 10KB

[[nodiscard]] inline std::string truncateHistorySql(std::string_view sql) {
    if (sql.size() <= MAX_HISTORY_SQL_BYTES)
        return std::string(sql);
    // Back off from MAX to avoid splitting a multi-byte UTF-8 character.
    auto pos = MAX_HISTORY_SQL_BYTES;
    while (pos > 0 && (static_cast<unsigned char>(sql[pos]) & 0xC0) == 0x80)
        --pos;
    return std::string(sql.substr(0, pos));
}

/// Generate a unique history ID (timestamp + monotonic counter).
[[nodiscard]] inline std::string generateHistoryId() {
    static std::atomic<uint64_t> counter{0};
    return std::format("hist_{}_{}", std::chrono::system_clock::now().time_since_epoch().count(), counter.fetch_add(1, std::memory_order_relaxed));
}

struct HistoryItem {
    std::string id;
    std::string sql;
    std::string connectionId;
    std::chrono::system_clock::time_point timestamp = std::chrono::system_clock::now();
    double executionTimeMs = 0.0;
    bool success = true;
    std::string errorMessage;
    int64_t affectedRows = 0;
    bool isFavorite = false;
};

class QueryHistory {
public:
    /// デフォルト値は GeneralSettings::maxQueryHistory (accessors/settings_accessor.h) と一致させる。
    /// 不一致は Issue #426 を参照。
    explicit QueryHistory(size_t maxItems = 1000) : m_maxItems(maxItems) {}
    ~QueryHistory() = default;

    QueryHistory(const QueryHistory&) = delete;
    QueryHistory& operator=(const QueryHistory&) = delete;

    void add(const HistoryItem& item);
    [[nodiscard]] std::vector<HistoryItem> getAll() const;
    [[nodiscard]] std::vector<HistoryItem> search(std::string_view keyword) const;
    [[nodiscard]] std::vector<HistoryItem> getByDate(std::chrono::system_clock::time_point from, std::chrono::system_clock::time_point to) const;

    void setFavorite(std::string_view id, bool favorite);
    [[nodiscard]] std::vector<HistoryItem> getFavorites() const;

    void remove(std::string_view id);
    void clear();

    /// 上限件数を変更し、超過分の非 favorite を即時 eviction する。
    /// settings.general.maxQueryHistory のランタイム反映に使う (Issue #426)。
    void setMaxItems(size_t maxItems);

    [[nodiscard]] std::expected<void, std::string> save(std::string_view filepath) const;
    [[nodiscard]] std::expected<void, std::string> load(std::string_view filepath);

private:
    /// 呼び出し側で m_mutex を取得済みであることを前提とした eviction 共通ロジック。
    void evictOverLimitLocked();

    using HistoryIter = std::list<HistoryItem>::iterator;

    /// trigram (n=3) inverted index で search() を高速化する (Issue #424)。
    /// キーは sizeof 3 byte の `std::array<char,3>`、posting には HistoryItem の生ポインタを保持。
    /// std::list は erase 以外で iterator/要素アドレスが不変なので、ポインタは erase 時のみ同期すればよい。
    /// posting を unordered_set にすることで insert/erase/lookup を O(1) に保ち、
    /// add/remove のスケーリングを per-op O(1) に維持する (vector だと erase が posting size N に依存)。
    using Trigram = std::array<char, 3>;
    struct TrigramHash {
        size_t operator()(const Trigram& t) const noexcept {
            uint32_t v = (static_cast<uint32_t>(static_cast<uint8_t>(t[0])) << 16) | (static_cast<uint32_t>(static_cast<uint8_t>(t[1])) << 8) | static_cast<uint32_t>(static_cast<uint8_t>(t[2]));
            v ^= v >> 16;
            v *= 0x7feb352dU;
            v ^= v >> 15;
            v *= 0x846ca68bU;
            v ^= v >> 16;
            return v;
        }
    };

    /// sql の全 trigram を index に登録する (重複は除去)。
    void addToTrigramIndex(HistoryIter it);
    /// sql の全 trigram を index から削除する (posting が空なら entry も erase)。
    void removeFromTrigramIndex(HistoryIter it);
    /// search() の posting 交差処理。keyword の trigram 集合から AND 交差で候補集合を返す。
    /// 1 個でも posting が欠けていれば空集合を返す (ゼロ件確定)。要 m_mutex 保有。
    [[nodiscard]] std::unordered_set<const HistoryItem*> findSearchCandidatesLocked(std::string_view keyword) const;
    /// sql の全 trigram を抽出し重複排除した vector を返す。
    /// `unordered_set` で重複検出するため per-trigram O(1)、全体 O(L) (L = sql.size())。
    /// member 化している理由: `TrigramHash` が private nested 型のため anonymous namespace から不可視。
    [[nodiscard]] static std::vector<Trigram> buildUniqueTrigrams(std::string_view sql);

    size_t m_maxItems;
    mutable std::mutex m_mutex;
    // list を選定: erase 以外で iterator が無効化されないため、unordered_map に iterator を保持して
    // add/remove/setFavorite を平均 O(1) 化できる。vector では中央 erase で iterator が全無効化される。
    std::list<HistoryItem> m_history;  // Front = newest.
    std::unordered_map<std::string, HistoryIter, TransparentStringHash, TransparentStringEqual> m_indexById;
    // 非 favorite の件数。eviction loop が「全 favorite 状態」を O(1) で skip するためのキャッシュ。
    size_t m_nonFavoriteCount = 0;
    // trigram → posting (該当 sql を持つ HistoryItem* の集合)。Issue #424。
    std::unordered_map<Trigram, std::unordered_set<const HistoryItem*>, TrigramHash> m_trigramIndex;
};

}  // namespace velocitydb
