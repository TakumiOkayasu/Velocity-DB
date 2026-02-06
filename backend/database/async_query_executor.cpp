#include "async_query_executor.h"

#include "../parsers/sql_parser.h"

#include <format>

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
            if (task->status == QueryStatus::Running && task->driver) {
                task->driver->cancel();
            }
            // Wait for completion (this can block, but we're not holding the mutex)
            task->future.wait();
        }
    }
}

std::string AsyncQueryExecutor::submitQuery(std::shared_ptr<SQLServerDriver> driver, std::string_view sql) {
    auto queryId = std::format("query_{}", m_queryIdCounter++);

    auto task = std::make_shared<QueryTask>();
    task->driver = driver;  // shared_ptr ensures driver lifetime
    task->sql = std::string(sql);
    task->startTime = std::chrono::steady_clock::now();
    task->status = QueryStatus::Running;

    // Split SQL into multiple statements
    auto statements = SQLParser::splitStatements(sql);
    task->multipleResults = statements.size() > 1;

    // Capture shared_ptr by value to ensure driver and task lifetime extends through async execution
    if (statements.size() > 1) {
        // Multiple statements: execute sequentially and collect all results
        task->future = std::async(std::launch::async, [driver, statements, task]() -> QueryResultVariant {
            try {
                std::vector<StatementResult> allResults;
                allResults.reserve(statements.size());

                for (const auto& stmt : statements) {
                    ResultSet currentResult;

                    if (SQLParser::isUseStatement(stmt)) {
                        // Execute USE statement
                        [[maybe_unused]] auto _ = driver->execute(stmt);
                        std::string dbName = SQLParser::extractDatabaseName(stmt);

                        // Create result for USE statement
                        currentResult.columns.push_back({.name = "Message", .type = "VARCHAR", .size = 255, .nullable = false, .isPrimaryKey = false});
                        ResultRow messageRow;
                        messageRow.values.push_back(std::format("Database changed to {}", dbName));
                        currentResult.rows.push_back(messageRow);
                        currentResult.affectedRows = 0;
                        currentResult.executionTimeMs = 0.0;
                    } else {
                        currentResult = driver->execute(stmt);
                    }

                    allResults.push_back(StatementResult{.statement = stmt, .result = std::move(currentResult)});
                }

                task->endTime = std::chrono::steady_clock::now();
                task->status = QueryStatus::Completed;
                return allResults;
            } catch (const std::exception& e) {
                task->endTime = std::chrono::steady_clock::now();
                task->errorMessage = e.what();
                task->status = QueryStatus::Failed;
                return std::vector<StatementResult>{};
            }
        });
    } else {
        // Single statement
        std::string sqlCopy(sql);
        task->future = std::async(std::launch::async, [driver, sqlCopy, task]() -> QueryResultVariant {
            try {
                ResultSet result = driver->execute(sqlCopy);
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

AsyncQueryResult AsyncQueryExecutor::getQueryResult(std::string_view queryId) {
    std::shared_ptr<QueryTask> task;

    // Lock only to find and copy the task pointer
    {
        std::lock_guard lock(m_mutex);
        auto iter = m_queries.find(std::string(queryId));
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

bool AsyncQueryExecutor::cancelQuery(std::string_view queryId) {
    std::lock_guard lock(m_mutex);

    auto iter = m_queries.find(std::string(queryId));
    if (iter == m_queries.end()) {
        return false;
    }

    auto& task = iter->second;
    if (task->status == QueryStatus::Running && task->driver) {
        task->driver->cancel();
        task->status = QueryStatus::Cancelled;
        task->endTime = std::chrono::steady_clock::now();
        return true;
    }

    return false;
}

bool AsyncQueryExecutor::isQueryRunning(std::string_view queryId) const {
    std::lock_guard lock(m_mutex);

    auto iter = m_queries.find(std::string(queryId));
    if (iter == m_queries.end()) {
        return false;
    }

    return iter->second->status == QueryStatus::Running;
}

void AsyncQueryExecutor::removeQuery(std::string_view queryId) {
    std::lock_guard lock(m_mutex);
    m_queries.erase(std::string(queryId));
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

}  // namespace velocitydb
