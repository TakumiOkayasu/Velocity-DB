#include "async_query_executor.h"

#include "../parsers/split_utils.h"
#include "../parsers/sql_parser.h"
#include "../utils/string_utils.h"

#include <algorithm>
#include <deque>
#include <format>
#include <memory>
#include <string>

namespace velocitydb {

AsyncQueryExecutor::~AsyncQueryExecutor() {
    std::vector<std::shared_ptr<QueryTask>> tasks;

    // Lock only to copy the task list
    {
        std::lock_guard lock(m_mutex);
        tasks.reserve(m_queries.size());
        for (auto& [id, task] : m_queries) {
            tasks.push_back(task);
        }
    }

    // Cancel and wait WITHOUT holding the mutex
    for (auto& task : tasks) {
        if (task->future.valid()) {
            // Cancel if still running
            if (task->status == QueryStatus::Running) {
                task->cancelled.store(true, std::memory_order_release);
                if (task->driver)
                    task->driver->cancel();
            }
            // Wait for completion (this can block, but we're not holding the mutex)
            task->future.wait();
        }
    }
}

std::string AsyncQueryExecutor::submitQuery(std::shared_ptr<IDatabaseDriver> driver, std::string_view sql) {
    auto queryId = std::format("query_{}", m_queryIdCounter++);

    auto task = std::make_shared<QueryTask>();
    task->driver = driver;  // shared_ptr ensures driver lifetime
    task->sql = std::string(sql);
    task->startTime = std::chrono::steady_clock::now();
    task->status = QueryStatus::Running;

    // Split SQL into multiple statements (inject CopyBlockDetector for PostgreSQL)
    auto statements = splitStatementsForDriver(sql, driver->getType());
    task->multipleResults = statements.size() > 1;

    // Auto-wrap in transaction if multiple statements and no user-supplied transaction control
    auto wrapTransaction = statements.size() > 1 && std::ranges::none_of(statements, &SQLParser::isTransactionControl);

    // Capture shared_ptr by value to ensure driver and task lifetime extends through async execution
    if (statements.size() > 1) {
        // Multiple statements: execute sequentially and collect all results
        task->future = m_pool.submit([driver, statements, task, wrapTransaction]() -> QueryResultVariant {
            try {
                if (wrapTransaction)
                    (void)driver->execute(beginTransactionSQL(driver->getType()));

                std::vector<StatementResult> allResults;
                allResults.reserve(statements.size());

                for (const auto& stmt : statements) {
                    if (task->cancelled.load(std::memory_order_acquire))
                        throw std::runtime_error("Query cancelled");

                    ResultSet currentResult;

                    if (SQLParser::isUseStatement(stmt)) {
                        // Execute USE statement
                        [[maybe_unused]] auto _ = driver->execute(stmt);
                        std::string dbName = SQLParser::extractDatabaseName(stmt);

                        // Create result for USE statement. Synthetic value
                        // needs an arena so ResultRow::values (string_view)
                        // has stable backing for the message text.
                        currentResult.columns.push_back({.name = "Message", .type = "VARCHAR", .size = 255, .nullable = false, .isPrimaryKey = false});
                        auto messageArena = std::make_shared<std::deque<std::string>>();
                        messageArena->emplace_back(std::format("Database changed to {}", dbName));
                        ResultRow messageRow;
                        messageRow.values.emplace_back(messageArena->back());
                        messageRow.nullFlags.push_back(false);
                        currentResult.rows.push_back(messageRow);
                        currentResult.storage = std::move(messageArena);
                        currentResult.affectedRows = 0;
                        currentResult.executionTimeMs = 0.0;
                    } else {
                        currentResult = driver->execute(stmt);
                    }

                    allResults.push_back(StatementResult{.statement = std::string(firstLine(stmt)), .result = std::move(currentResult)});
                }

                if (wrapTransaction)
                    (void)driver->execute("COMMIT");

                task->endTime = std::chrono::steady_clock::now();
                task->status = QueryStatus::Completed;
                return allResults;
            } catch (const std::exception& e) {
                if (wrapTransaction)
                    try {
                        (void)driver->execute("ROLLBACK");
                    } catch (...) {  // NOLINT(bugprone-empty-catch)
                    }
                task->endTime = std::chrono::steady_clock::now();
                task->errorMessage = e.what();
                task->status = QueryStatus::Failed;
                return std::vector<StatementResult>{};
            }
        });
    } else {
        // Single statement
        std::string sqlCopy(sql);
        task->future = m_pool.submit([driver, sqlCopy, task]() -> QueryResultVariant {
            try {
                auto result = driver->execute(sqlCopy);
                task->endTime = std::chrono::steady_clock::now();
                task->status = QueryStatus::Completed;
                return result;
            } catch (const std::exception& e) {
                task->endTime = std::chrono::steady_clock::now();
                task->errorMessage = e.what();
                task->status = QueryStatus::Failed;
                return ResultSet{};
            }
        });
    }

    std::lock_guard lock(m_mutex);
    m_queries[queryId] = task;

    return queryId;
}

std::string AsyncQueryExecutor::submitTask(std::function<QueryResultVariant(const std::atomic<bool>&)> task) {
    auto queryId = std::format("query_{}", m_queryIdCounter++);

    auto queryTask = std::make_shared<QueryTask>();
    queryTask->startTime = std::chrono::steady_clock::now();
    queryTask->status = QueryStatus::Running;

    queryTask->future = m_pool.submit([queryTask, fn = std::move(task)]() -> QueryResultVariant {
        try {
            auto result = fn(queryTask->cancelled);
            queryTask->endTime = std::chrono::steady_clock::now();
            queryTask->status = QueryStatus::Completed;
            return result;
        } catch (const std::exception& e) {
            queryTask->endTime = std::chrono::steady_clock::now();
            queryTask->errorMessage = e.what();
            queryTask->status = QueryStatus::Failed;
            return ResultSet{};
        }
    });

    std::lock_guard lock(m_mutex);
    m_queries[queryId] = queryTask;
    return queryId;
}

AsyncQueryResult AsyncQueryExecutor::getQueryResult(std::string_view queryId) {
    std::shared_ptr<QueryTask> task;

    // Lock only to find and copy the task pointer
    {
        std::lock_guard lock(m_mutex);
        auto iter = m_queries.find(queryId);
        if (iter == m_queries.end()) {
            return AsyncQueryResult{.queryId = std::string(queryId), .status = QueryStatus::Failed, .errorMessage = "Query not found"};
        }
        task = iter->second;
    }

    // Now operate on the task WITHOUT holding the mutex
    AsyncQueryResult result;
    result.queryId = std::string(queryId);
    result.status = task->status.load();
    result.multipleResults = task->multipleResults;
    result.startTime = task->startTime;
    result.endTime = task->endTime;
    result.errorMessage = task->errorMessage;

    // If completed, get the result (cache it to avoid double future.get() call)
    // Use wait_for(0) to avoid blocking the UI thread when status is set before future is ready
    if (result.status == QueryStatus::Completed || result.status == QueryStatus::Failed) {
        if (!task->cachedResult.has_value() && task->future.valid()) {
            if (task->future.wait_for(std::chrono::milliseconds(0)) == std::future_status::ready) {
                try {
                    task->cachedResult = task->future.get();
                } catch (...) {
                    result.status = QueryStatus::Failed;
                    result.errorMessage = "Failed to retrieve result";
                }
            } else {
                // Future not ready yet despite status - report as still running
                result.status = QueryStatus::Running;
                return result;
            }
        }
        if (task->cachedResult.has_value()) {
            if (task->multipleResults) {
                // Multiple results
                result.results = std::get<std::vector<StatementResult>>(*task->cachedResult);
            } else {
                // Single result
                result.result = std::get<ResultSet>(*task->cachedResult);
            }
        }
    }

    return result;
}

std::expected<void, std::string> AsyncQueryExecutor::cancelQuery(std::string_view queryId) {
    std::lock_guard lock(m_mutex);

    auto iter = m_queries.find(queryId);
    if (iter == m_queries.end()) {
        return std::unexpected(std::format("Query not found: {}", queryId));
    }

    auto& task = iter->second;
    if (task->status == QueryStatus::Running) {
        task->cancelled.store(true, std::memory_order_release);
        if (task->driver)
            task->driver->cancel();
        task->status = QueryStatus::Cancelled;
        task->endTime = std::chrono::steady_clock::now();
        return {};
    }

    return std::unexpected("Query is not running");
}

bool AsyncQueryExecutor::isQueryRunning(std::string_view queryId) const {
    std::lock_guard lock(m_mutex);

    auto iter = m_queries.find(queryId);
    if (iter == m_queries.end()) {
        return false;
    }

    return iter->second->status == QueryStatus::Running;
}

std::expected<void, std::string> AsyncQueryExecutor::removeQuery(std::string_view queryId) {
    std::lock_guard lock(m_mutex);
    auto it = m_queries.find(queryId);
    if (it == m_queries.end()) {
        return std::unexpected(std::format("Query not found: {}", queryId));
    }
    auto status = it->second->status.load();
    if (status == QueryStatus::Pending || status == QueryStatus::Running) {
        return std::unexpected("Cannot remove a running query");
    }
    m_queries.erase(it);
    return {};
}

std::vector<std::string> AsyncQueryExecutor::getActiveQueryIds() const {
    std::lock_guard lock(m_mutex);

    std::vector<std::string> ids;
    ids.reserve(m_queries.size());

    for (const auto& [id, task] : m_queries) {
        if (task->status == QueryStatus::Pending || task->status == QueryStatus::Running) {
            ids.push_back(id);
        }
    }

    return ids;
}

size_t AsyncQueryExecutor::evictStaleQueries(std::chrono::seconds maxAge) {
    std::lock_guard lock(m_mutex);
    if (m_queries.empty()) {
        return 0;
    }
    auto now = std::chrono::steady_clock::now();
    if (now - m_lastEvictTime < EVICT_INTERVAL) {
        return 0;
    }
    m_lastEvictTime = now;

    auto sizeBefore = m_queries.size();
    std::erase_if(m_queries, [&](const auto& pair) {
        const auto& task = pair.second;
        auto status = task->status.load();
        if (status == QueryStatus::Pending || status == QueryStatus::Running) {
            return false;
        }
        return (now - task->endTime) > maxAge;
    });
    return sizeBefore - m_queries.size();
}

}  // namespace velocitydb
