#pragma once

#include "driver_interface.h"
#include "thread_pool.h"

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
    [[nodiscard]] std::string submitQuery(std::shared_ptr<IDatabaseDriver> driver, std::string_view sql);

    /// Submits an arbitrary task for asynchronous execution (e.g., psql subprocess)
    [[nodiscard]] std::string submitTask(std::function<QueryResultVariant()> task);

    /// Gets the current status and result of a query
    [[nodiscard]] AsyncQueryResult getQueryResult(std::string_view queryId);

    /// Cancels a running query
    bool cancelQuery(std::string_view queryId);

    /// Checks if a query is still running
    [[nodiscard]] bool isQueryRunning(std::string_view queryId) const;

    /// Removes completed query from tracking (cleanup). Returns true if the query existed.
    [[nodiscard]] bool removeQuery(std::string_view queryId);

    /// Gets all active query IDs
    [[nodiscard]] std::vector<std::string> getActiveQueryIds() const;

    /// Evicts completed/failed/cancelled queries older than maxAge. Returns number evicted.
    [[nodiscard]] size_t evictStaleQueries(std::chrono::seconds maxAge = std::chrono::seconds{300});

private:
    struct QueryTask {
        std::future<QueryResultVariant> future;
        std::optional<QueryResultVariant> cachedResult;  // Cache result after first get()
        bool multipleResults = false;
        std::atomic<QueryStatus> status{QueryStatus::Pending};
        std::atomic<bool> cancelled{false};
        std::shared_ptr<IDatabaseDriver> driver;  // shared_ptr to prevent use-after-free
        std::string sql;
        std::string errorMessage;
        std::chrono::steady_clock::time_point startTime;
        std::chrono::steady_clock::time_point endTime;
    };

    static constexpr auto EVICT_INTERVAL = std::chrono::seconds{60};

    ThreadPool m_pool;
    mutable std::mutex m_mutex;
    std::unordered_map<std::string, std::shared_ptr<QueryTask>> m_queries;
    std::chrono::steady_clock::time_point m_lastEvictTime{};  // guarded by m_mutex
    std::atomic<int> m_queryIdCounter{1};
};

}  // namespace velocitydb
