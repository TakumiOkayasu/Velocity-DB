#include "async_query_provider.h"

#include "../database/async_query_executor.h"
#include "../database/driver_interface.h"
#include "../database/psql_subprocess.h"
#include "../database/query_history.h"
#include "../interfaces/providers/connection_provider.h"
#include "../parsers/copy_block_detector.h"
#include "../utils/json_utils.h"
#include "simdjson.h"

#include <format>

namespace velocitydb {

AsyncQueryProvider::AsyncQueryProvider(IConnectionProvider& connections, QueryHistory& queryHistory)
    : m_connections(connections), m_queryHistory(queryHistory), m_asyncExecutor(std::make_unique<AsyncQueryExecutor>()) {}

AsyncQueryProvider::~AsyncQueryProvider() = default;

std::string AsyncQueryProvider::executeAsyncQuery(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        std::string_view connectionId = connectionIdResult.value();
        std::string_view sqlQuery = sqlQueryResult.value();

        auto driver = m_connections.getQueryDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        // Delegate entire SQL to psql for COPY FROM stdin (libpq can't handle pg_dump format)
        auto driverType = m_connections.getDriverType(connectionId);
        std::string queryId;
        if (driverType == DriverType::PostgreSQL && containsCopyFromStdin(sqlQuery)) {
            auto connParams = m_connections.getConnectionParams(connectionId);
            if (!connParams) {
                return JsonUtils::errorResponse("Connection parameters not found for psql delegation");
            }
            auto connInfo = toPsqlConnectionInfo(*connParams);
            queryId = m_asyncExecutor->submitTask([connInfo = std::move(connInfo), sqlCopy = std::string(sqlQuery)](const std::atomic<bool>& cancelled) -> QueryResultVariant {
                auto result = executePsql(connInfo, sqlCopy, cancelled);
                if (!result)
                    throw std::runtime_error(result.error());
                return *result;
            });
        }

        if (queryId.empty())
            queryId = m_asyncExecutor->submitQuery(driver, sqlQuery);

        m_queryMeta[queryId] = {.connectionId = std::string(connectionId), .sql = truncateHistorySql(sqlQuery)};
        return JsonUtils::successResponse(std::format(R"({{"queryId":"{}"}})", queryId));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string AsyncQueryProvider::getAsyncQueryResult(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto queryIdResult = doc["queryId"].get_string();
        if (queryIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: queryId");
        }
        auto queryId = std::string(queryIdResult.value());

        [[maybe_unused]] auto evicted = m_asyncExecutor->evictStaleQueries();

        AsyncQueryResult asyncResult = m_asyncExecutor->getQueryResult(queryId);

        std::string statusStr;
        switch (asyncResult.status) {
            case QueryStatus::Pending:
                statusStr = "pending";
                break;
            case QueryStatus::Running:
                statusStr = "running";
                break;
            case QueryStatus::Completed:
                statusStr = "completed";
                break;
            case QueryStatus::Cancelled:
                statusStr = "cancelled";
                break;
            case QueryStatus::Failed:
                statusStr = "failed";
                break;
        }

        std::string jsonResponse = "{";
        jsonResponse += std::format(R"("queryId":"{}","status":"{}")", asyncResult.queryId, statusStr);

        if (!asyncResult.errorMessage.empty()) {
            jsonResponse += std::format(R"(,"error":"{}")", JsonUtils::escapeString(asyncResult.errorMessage));
        }

        if (asyncResult.multipleResults && !asyncResult.results.empty()) {
            jsonResponse += R"(,"multipleResults":true,"results":[)";
            for (size_t i = 0; i < asyncResult.results.size(); ++i) {
                if (i > 0)
                    jsonResponse += ",";
                const auto& stmtResult = asyncResult.results[i];
                jsonResponse += R"({"statement":")";
                jsonResponse += JsonUtils::escapeString(stmtResult.statement);
                jsonResponse += R"(","data":)";
                jsonResponse += JsonUtils::serializeResultSet(stmtResult.result, false);
                jsonResponse += "}";
            }
            jsonResponse += "]";
        } else if (asyncResult.result.has_value()) {
            jsonResponse += ',';
            JsonUtils::appendResultSetFields(jsonResponse, *asyncResult.result);
        }

        // Record history on completion/failure; erase meta on any terminal status to prevent leaks
        if (auto metaIt = m_queryMeta.find(queryId); metaIt != m_queryMeta.end()) {
            bool terminal = asyncResult.status == QueryStatus::Completed || asyncResult.status == QueryStatus::Failed || asyncResult.status == QueryStatus::Cancelled;
            if (asyncResult.status == QueryStatus::Completed || asyncResult.status == QueryStatus::Failed) {
                double totalExecMs = 0.0;
                int64_t totalAffected = 0;
                if (asyncResult.result.has_value()) {
                    totalExecMs = asyncResult.result->executionTimeMs;
                    totalAffected = static_cast<int64_t>(asyncResult.result->affectedRows);
                }
                for (const auto& r : asyncResult.results) {
                    totalExecMs += r.result.executionTimeMs;
                    totalAffected += static_cast<int64_t>(r.result.affectedRows);
                }
                m_queryHistory.add({.id = generateHistoryId(),
                                    .sql = metaIt->second.sql,
                                    .connectionId = metaIt->second.connectionId,
                                    .executionTimeMs = totalExecMs,
                                    .success = (asyncResult.status == QueryStatus::Completed),
                                    .errorMessage = asyncResult.errorMessage,
                                    .affectedRows = totalAffected,
                                    .isFavorite = false});
            }
            if (terminal)
                m_queryMeta.erase(metaIt);
        }

        jsonResponse += "}";
        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string AsyncQueryProvider::cancelAsyncQuery(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto queryIdResult = doc["queryId"].get_string();
        if (queryIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: queryId");
        }
        bool cancelled = m_asyncExecutor->cancelQuery(queryIdResult.value()).has_value();
        return JsonUtils::successResponse(std::format(R"({{"cancelled":{}}})", cancelled ? "true" : "false"));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string AsyncQueryProvider::removeAsyncQuery(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto queryIdResult = doc["queryId"].get_string();
        if (queryIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: queryId");
        }
        auto qid = std::string(queryIdResult.value());
        bool removed = m_asyncExecutor->removeQuery(qid).has_value();
        m_queryMeta.erase(qid);
        return JsonUtils::successResponse(std::format(R"({{"removed":{}}})", removed ? "true" : "false"));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string AsyncQueryProvider::getActiveQueries(std::string_view) {
    auto activeIds = m_asyncExecutor->getActiveQueryIds();
    auto jsonResponse = JsonUtils::buildArray(activeIds, [](std::string& out, const std::string& id) { out += std::format(R"("{}")", id); });
    return JsonUtils::successResponse(jsonResponse);
}

}  // namespace velocitydb
