#pragma once

#include <chrono>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace predategrip {

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

}  // namespace predategrip
