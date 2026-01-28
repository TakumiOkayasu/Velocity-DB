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
#include <variant>
#include <vector>

namespace velocitydb {

enum class QueryStatus { Pending, Running, Completed, Cancelled, Failed };

struct StatementResult {
    std::string statement;
    ResultSet result;
};

using QueryResultVariant = std::variant<ResultSet, std::vector<StatementResult>>;

struct AsyncQueryResult {
    std::string queryId;
    QueryStatus status = QueryStatus::Pending;
    bool multipleResults = false;
    std::optional<ResultSet> result;
    std::vector<StatementResult> results;
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
        std::future<QueryResultVariant> future;
        std::optional<QueryResultVariant> cachedResult;  // Cache result after first get()
        bool multipleResults = false;
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

}  // namespace velocitydb
