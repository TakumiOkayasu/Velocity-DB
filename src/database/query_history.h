#pragma once

#include <string>
#include <vector>
#include <chrono>
#include <mutex>

namespace predategrip {

struct HistoryItem {
    std::string id;
    std::string sql;
    std::string connectionId;
    std::chrono::system_clock::time_point timestamp;
    double executionTimeMs;
    bool success;
    std::string errorMessage;
    int64_t affectedRows;
    bool isFavorite;
};

class QueryHistory {
public:
    QueryHistory(size_t maxItems = 10000);
    ~QueryHistory() = default;

    void add(const HistoryItem& item);
    std::vector<HistoryItem> getAll() const;
    std::vector<HistoryItem> search(const std::string& keyword) const;
    std::vector<HistoryItem> getByDate(
        std::chrono::system_clock::time_point from,
        std::chrono::system_clock::time_point to) const;

    void setFavorite(const std::string& id, bool favorite);
    std::vector<HistoryItem> getFavorites() const;

    void remove(const std::string& id);
    void clear();

    bool save(const std::string& filepath) const;
    bool load(const std::string& filepath);

private:
    size_t m_maxItems;
    mutable std::mutex m_mutex;
    std::vector<HistoryItem> m_history;
};

}  // namespace predategrip
