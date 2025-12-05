#pragma once

#include "sqlserver_driver.h"

#include <atomic>
#include <chrono>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

namespace predategrip {

enum class QueryStatus { Pending, Running, Completed, Cancelled, Failed };

struct AsyncQueryResult {
    std::string queryId;
    QueryStatus status = QueryStatus::Pending;
    std::optional<ResultSet> result;
    std::string errorMessage;
    std::chrono::steady_clock::time_point startTime;
    std::chrono::steady_clock::time_point endTime;
};

class AsyncQueryExecutor {
public:
    AsyncQueryExecutor() = default;
    ~AsyncQueryExecutor();

    AsyncQueryExecutor(const AsyncQueryExecutor&) = delete;
    AsyncQueryExecutor& operator=(const AsyncQueryExecutor&) = delete;
    AsyncQueryExecutor(AsyncQueryExecutor&&) = delete;
    AsyncQueryExecutor& operator=(AsyncQueryExecutor&&) = delete;

    /// Submits a query for asynchronous execution, returns a unique query ID
    /// Uses shared_ptr to ensure driver lifetime extends through async execution
    [[nodiscard]] std::string submitQuery(std::shared_ptr<SQLServerDriver> driver, std::string_view sql);

    /// Gets the current status and result of a query
    [[nodiscard]] AsyncQueryResult getQueryResult(std::string_view queryId);

    /// Cancels a running query
    bool cancelQuery(std::string_view queryId);

    /// Checks if a query is still running
    [[nodiscard]] bool isQueryRunning(std::string_view queryId) const;

    /// Removes completed query from tracking (cleanup)
    void removeQuery(std::string_view queryId);

    /// Gets all active query IDs
    [[nodiscard]] std::vector<std::string> getActiveQueryIds() const;

private:
    struct QueryTask {
        std::future<ResultSet> future;
        std::optional<ResultSet> cachedResult;  // Cache result after first get()
        std::atomic<QueryStatus> status{QueryStatus::Pending};
        std::shared_ptr<SQLServerDriver> driver;  // shared_ptr to prevent use-after-free
        std::string sql;
        std::string errorMessage;
        std::chrono::steady_clock::time_point startTime;
        std::chrono::steady_clock::time_point endTime;
    };

    mutable std::mutex m_mutex;
    std::unordered_map<std::string, std::shared_ptr<QueryTask>> m_queries;
    std::atomic<int> m_queryIdCounter{1};
};

}  // namespace predategrip
