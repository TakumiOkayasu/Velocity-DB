#pragma once

#include <atomic>
#include <chrono>
#include <format>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
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
    explicit QueryHistory(size_t maxItems = 10000) : m_maxItems(maxItems) {}
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

    [[nodiscard]] bool save(std::string_view filepath) const;
    [[nodiscard]] bool load(std::string_view filepath);

private:
    size_t m_maxItems;
    mutable std::mutex m_mutex;
    std::vector<HistoryItem> m_history;
};

}  // namespace velocitydb
