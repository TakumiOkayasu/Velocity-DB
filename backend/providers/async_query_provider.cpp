#include "async_query_provider.h"

#include "../database/async_query_executor.h"
#include "../database/driver_interface.h"
#include "../database/psql_subprocess.h"
#include "../database/query_history.h"
#include "../database/result_cache.h"
#include "../interfaces/providers/connection_provider.h"
#include "../parsers/copy_block_detector.h"
#include "../parsers/split_utils.h"
#include "../parsers/sql_parser.h"
#include "../utils/json_utils.h"
#include "simdjson.h"

#include <format>
#include <optional>

namespace velocitydb {

AsyncQueryProvider::AsyncQueryProvider(IConnectionProvider& connections, QueryHistory& queryHistory, std::shared_ptr<ResultCache> resultCache)
    : m_connections(connections), m_queryHistory(queryHistory), m_resultCache(std::move(resultCache)), m_asyncExecutor(std::make_unique<AsyncQueryExecutor>()) {}

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
            if (m_resultCache) {
                // COPY は書き込みのため接続単位でキャッシュ無効化 (#511)
                m_resultCache->invalidatePrefix(makeConnectionCachePrefix(connectionId));
            }
            auto connInfo = toPsqlConnectionInfo(*connParams);
            queryId = m_asyncExecutor->submitTask([connInfo = std::move(connInfo), sqlCopy = std::string(sqlQuery)](const std::atomic<bool>& cancelled) -> QueryResultVariant {
                auto result = executePsql(connInfo, sqlCopy, cancelled);
                if (!result)
                    throw std::runtime_error(result.error());
                return *result;
            });
        }

        // 単文の読み取り専用クエリは QueryProvider と共有の ResultCache を利用する (#511)。
        // ヒット時は DB を叩かず、キャッシュ済み ResultSet を返すタスクを積んで既存の
        // ポーリング契約 (getAsyncQueryResult) をそのまま満たす。
        std::string cacheKey;
        bool fromCache = false;
        if (queryId.empty() && m_resultCache) {
            auto statements = splitStatementsForDriver(sqlQuery, driverType);
            if (statements.size() == 1 && SQLParser::isReadOnlyQuery(sqlQuery)) {
                cacheKey = makeConnectionCachePrefix(connectionId);
                cacheKey += SQLParser::normalizeForCacheKey(sqlQuery);
                auto cached = m_resultCache->getAndApply(cacheKey, [](const ResultSet& rs) { return std::optional<ResultSet>(rs); });
                if (cached.has_value()) {
                    fromCache = true;
                    cacheKey.clear();  // ヒット結果を再 put しない
                    queryId = m_asyncExecutor->submitTask([rs = std::move(*cached)](const std::atomic<bool>&) -> QueryResultVariant { return rs; });
                }
            } else {
                // 書き込みの可能性がある (複文 or 非 SELECT) ため安全側で接続単位無効化 (#511)
                m_resultCache->invalidatePrefix(makeConnectionCachePrefix(connectionId));
            }
        }

        if (queryId.empty())
            queryId = m_asyncExecutor->submitQuery(driver, sqlQuery);

        m_queryMeta[queryId] = {.connectionId = std::string(connectionId), .sql = truncateHistorySql(sqlQuery), .cacheKey = std::move(cacheKey), .skipHistory = fromCache};
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
            // 完了した単文 SELECT の結果を共有キャッシュへ格納 (#511)。meta 消去前の一度きり
            if (asyncResult.status == QueryStatus::Completed && m_resultCache && !metaIt->second.cacheKey.empty() && !asyncResult.multipleResults && asyncResult.result.has_value()) {
                m_resultCache->put(metaIt->second.cacheKey, ResultSet(*asyncResult.result));
            }
            if (!metaIt->second.skipHistory && (asyncResult.status == QueryStatus::Completed || asyncResult.status == QueryStatus::Failed)) {
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
