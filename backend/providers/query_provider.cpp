#include "query_provider.h"

#include "../database/connection_params_parser.h"
#include "../database/driver_interface.h"
#include "../database/psql_subprocess.h"
#include "../database/query_history.h"
#include "../database/result_cache.h"
#include "../database/sql_builder.h"
#include "../interfaces/providers/connection_provider.h"
#include "../interfaces/sql_formattable.h"
#include "../parsers/copy_block_detector.h"
#include "../parsers/split_utils.h"
#include "../parsers/sql_parser.h"
#include "../search/simd_filter.h"
#include "../utils/json_utils.h"
#include "../utils/logger.h"
#include "../utils/sql_validation.h"
#include "../utils/string_utils.h"
#include "query_result_formatter.h"
#include "simdjson.h"

#include <algorithm>
#include <chrono>
#include <format>
#include <optional>

#undef max

using namespace std::literals;

namespace velocitydb {

namespace {

/// simdjson result → optional への小ヘルパ。
/// IPC 境界で「省略可能なフィールド」を扱う際に頻出するため共通化。
template <typename T>
[[nodiscard]] std::optional<T> toOpt(simdjson::simdjson_result<T> r) {
    if (r.error())
        return std::nullopt;
    return r.value();
}

}  // namespace

QueryProvider::QueryProvider(IConnectionProvider& connections, QueryHistory& queryHistory) : m_connections(connections), m_resultCache(std::make_unique<ResultCache>()), m_queryHistory(queryHistory) {}

QueryProvider::~QueryProvider() = default;

void QueryProvider::recordHistory(std::string_view sql, std::string_view connectionId, double execTimeMs, bool success, std::string_view errorMsg, int64_t affectedRows) {
    m_queryHistory.add({.id = generateHistoryId(),
                        .sql = truncateHistorySql(sql),
                        .connectionId = std::string(connectionId),
                        .executionTimeMs = execTimeMs,
                        .success = success,
                        .errorMessage = std::string(errorMsg),
                        .affectedRows = affectedRows,
                        .isFavorite = false});
}

std::string QueryProvider::executeQuery(std::string_view params) {
    std::string_view connectionId;
    std::string_view sqlQuery;

    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        connectionId = connectionIdResult.value();
        sqlQuery = sqlQueryResult.value();

        auto driver = m_connections.getQueryDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        // Delegate entire SQL to psql for COPY FROM stdin (libpq can't handle pg_dump format)
        auto driverType = m_connections.getDriverType(connectionId);
        if (driverType == DriverType::PostgreSQL && containsCopyFromStdin(sqlQuery)) {
            auto connParams = m_connections.getConnectionParams(connectionId);
            if (!connParams) {
                return JsonUtils::errorResponse("Connection parameters not found for psql delegation");
            }
            static const std::atomic<bool> neverCancelled{false};
            auto psqlResult = executePsql(toPsqlConnectionInfo(*connParams), sqlQuery, neverCancelled);
            if (psqlResult) {
                recordHistory(sqlQuery, connectionId, psqlResult->executionTimeMs, true, {}, psqlResult->affectedRows);
                return JsonUtils::successResponse(JsonUtils::serializeResultSet(*psqlResult, false));
            }
            recordHistory(sqlQuery, connectionId, 0.0, false, psqlResult.error());
            return JsonUtils::errorResponse(psqlResult.error());
        }

        // Inject CopyBlockDetector for PostgreSQL connections
        auto statements = splitStatementsForDriver(sqlQuery, driverType);
        log<LogLevel::INFO>(std::format("Split SQL into {} statements", statements.size()));

        // Multiple statements
        if (statements.size() > 1) {
            struct StatementResult {
                std::string statement;
                ResultSet result;
            };
            std::vector<StatementResult> allResults;
            auto wrapTransaction = std::ranges::none_of(statements, &SQLParser::isTransactionControl);

            size_t stmtIdx = 0;
            try {
                if (wrapTransaction)
                    (void)driver->execute(beginTransactionSQL(m_connections.getDriverType(connectionId)));

                for (const auto& stmt : statements) {
                    auto stmtStart = std::chrono::high_resolution_clock::now();
                    ResultSet currentResult;
                    if (SQLParser::isUseStatement(stmt)) {
                        [[maybe_unused]] auto _ = driver->execute(stmt);
                        currentResult = QueryResultFormatter::buildUseStatementResult(SQLParser::extractDatabaseName(stmt));
                    } else {
                        currentResult = driver->execute(stmt);
                    }
                    auto stmtEnd = std::chrono::high_resolution_clock::now();
                    currentResult.executionTimeMs = std::chrono::duration<double, std::milli>(stmtEnd - stmtStart).count();
                    allResults.push_back({.statement = std::string(firstLine(stmt)), .result = std::move(currentResult)});
                    ++stmtIdx;
                }

                if (wrapTransaction)
                    (void)driver->execute("COMMIT");

                // Record history
                double totalExecMs = 0.0;
                int64_t totalAffected = 0;
                for (const auto& r : allResults) {
                    totalExecMs += r.result.executionTimeMs;
                    totalAffected += static_cast<int64_t>(r.result.affectedRows);
                }
                recordHistory(sqlQuery, connectionId, totalExecMs, true, {}, totalAffected);

                std::vector<NamedResult> namedResults;
                namedResults.reserve(allResults.size());
                for (const auto& r : allResults)
                    namedResults.push_back({.statement = r.statement, .result = std::cref(r.result)});
                return JsonUtils::successResponse(QueryResultFormatter::buildMultipleResultsJson(namedResults));
            } catch (const std::exception& e) {
                if (wrapTransaction)
                    try {
                        (void)driver->execute("ROLLBACK");
                    } catch (...) {  // NOLINT(bugprone-empty-catch)
                    }
                auto errorMsg = std::format("Statement {} of {}: {}", stmtIdx + 1, statements.size(), e.what());
                recordHistory(sqlQuery, connectionId, 0.0, false, errorMsg);
                return JsonUtils::errorResponse(errorMsg);
            }
        }

        // Single USE statement
        if (SQLParser::isUseStatement(sqlQuery)) {
            try {
                [[maybe_unused]] auto _ = driver->execute(sqlQuery);
                auto useResult = QueryResultFormatter::buildUseStatementResult(SQLParser::extractDatabaseName(sqlQuery));
                recordHistory(sqlQuery, connectionId, 0.0, true);
                return JsonUtils::successResponse(JsonUtils::serializeResultSet(useResult, false));
            } catch (const std::exception& e) {
                auto errorMsg = std::format("Failed to switch database: {}", e.what());
                recordHistory(sqlQuery, connectionId, 0.0, false, errorMsg);
                return JsonUtils::errorResponse(errorMsg);
            }
        }

        // Cache check
        bool useCache = true;
        if (auto useCacheOpt = doc["useCache"].get_bool(); !useCacheOpt.error()) {
            useCache = useCacheOpt.value();
        }
        std::string cacheKey;
        cacheKey.reserve(connectionId.size() + 1 + sqlQuery.size());
        cacheKey.append(connectionId);
        cacheKey.push_back('\0');
        cacheKey.append(sqlQuery);
        bool selectQuery = SQLParser::isReadOnlyQuery(sqlQuery);
        if (useCache && selectQuery) {
            if (auto cachedJson = m_resultCache->getAndApply(cacheKey, [](const ResultSet& rs) { return JsonUtils::serializeResultSet(rs, true); }); !cachedJson.empty()) {
                return JsonUtils::successResponse(cachedJson);
            }
        }

        auto queryResult = driver->execute(sqlQuery);

        std::string jsonResponse = JsonUtils::serializeResultSet(queryResult, false);

        if (useCache && selectQuery) {
            auto execTimeMs = queryResult.executionTimeMs;
            auto affectedRows = queryResult.affectedRows;
            m_resultCache->put(cacheKey, std::move(queryResult));
            recordHistory(sqlQuery, connectionId, execTimeMs, true, {}, affectedRows);
        } else {
            recordHistory(sqlQuery, connectionId, queryResult.executionTimeMs, true, {}, queryResult.affectedRows);
        }

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        if (!sqlQuery.empty()) {
            recordHistory(sqlQuery, connectionId, 0.0, false, e.what());
        }
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::executeQueryPaginated(std::string_view params) {
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

        int64_t startRow = 0;
        int64_t endRow = 100;
        if (auto startRowOpt = doc["startRow"].get_int64(); !startRowOpt.error())
            startRow = startRowOpt.value();
        if (auto endRowOpt = doc["endRow"].get_int64(); !endRowOpt.error())
            endRow = endRowOpt.value();

        auto driverType = m_connections.getDriverType(connectionId);
        auto formatter = DriverFactory::createSqlFormattable(driverType);

        std::string orderByClause;
        if (auto sortModel = doc["sortModel"].get_array(); !sortModel.error()) {
            std::string sortClauses;
            for (auto item : sortModel.value()) {
                auto colId = item["colId"].get_string();
                auto sort = item["sort"].get_string();
                if (!colId.error() && !sort.error()) {
                    if (!sortClauses.empty())
                        sortClauses += ", ";
                    sortClauses += formatter->quoteIdentifier(colId.value()) + " " + (sort.value() == std::string_view("asc") ? "ASC" : "DESC");
                }
            }
            if (!sortClauses.empty())
                orderByClause = " ORDER BY " + sortClauses;
        }

        auto driver = m_connections.getQueryDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        std::string paginatedQuery;
        if (orderByClause.empty()) {
            paginatedQuery = formatter->paginateQuery(sqlQuery, startRow, endRow - startRow);
        } else {
            paginatedQuery = formatter->paginateQuery(std::string(sqlQuery) + orderByClause, startRow, endRow - startRow);
        }

        auto queryResult = driver->execute(paginatedQuery);
        return JsonUtils::successResponse(JsonUtils::serializeResultSet(queryResult, false));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::getRowCount(std::string_view params) {
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

        auto driverType = m_connections.getDriverType(connectionId);
        auto formatter = DriverFactory::createSqlFormattable(driverType);
        auto countQuery = formatter->rowCountQuery(sqlQuery);
        auto queryResult = driver->execute(countQuery);

        if (queryResult.rows.empty() || queryResult.rows[0].values.empty()) {
            return JsonUtils::errorResponse("Failed to get row count");
        }

        auto rowCount = queryResult.rows[0].values[0];
        return JsonUtils::successResponse(std::format("{{\"rowCount\":{}}}", rowCount));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::cancelQuery(std::string_view params) {
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }
    if (auto driver = m_connections.getQueryDriver(*connectionIdResult)) {
        driver->cancel();
    }
    return JsonUtils::successResponse("{}");
}

std::string QueryProvider::filterResultSet(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        auto columnIndexResult = doc["columnIndex"].get_uint64();
        auto filterTypeResult = doc["filterType"].get_string();
        auto filterValueResult = doc["filterValue"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error() || columnIndexResult.error() || filterTypeResult.error() || filterValueResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId, sql, columnIndex, filterType, or filterValue");
        }
        std::string_view connectionId = connectionIdResult.value();
        std::string_view sqlQuery = sqlQueryResult.value();
        auto columnIndex = columnIndexResult.value();
        std::string_view filterType = filterTypeResult.value();
        auto filterValue = std::string(filterValueResult.value());

        auto driver = m_connections.getQueryDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto queryResult = driver->execute(sqlQuery);

        SIMDFilter simdFilter;
        std::vector<size_t> matchingIndices;
        if (filterType == "equals") {
            matchingIndices = simdFilter.filterEquals(queryResult, columnIndex, filterValue);
        } else if (filterType == "contains") {
            matchingIndices = simdFilter.filterContains(queryResult, columnIndex, filterValue);
        } else if (filterType == "range") {
            std::string minValue = filterValue;
            std::string maxValue;
            if (auto maxVal = doc["filterValueMax"].get_string(); !maxVal.error())
                maxValue = std::string(maxVal.value());
            matchingIndices = simdFilter.filterRange(queryResult, columnIndex, minValue, maxValue);
        } else {
            return JsonUtils::errorResponse(std::format("Unknown filter type: {}", filterType));
        }

        return JsonUtils::successResponse(QueryResultFormatter::buildFilteredResultJson(queryResult, matchingIndices));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::getCacheStats(std::string_view) {
    auto currentSize = m_resultCache->getCurrentSize();
    auto maxSize = m_resultCache->getMaxSize();
    std::string jsonResponse = std::format(R"({{"currentSizeBytes":{},"maxSizeBytes":{},"usagePercent":{:.1f}}})", currentSize, maxSize,
                                           maxSize > 0 ? (static_cast<double>(currentSize) / static_cast<double>(maxSize)) * 100.0 : 0.0);
    return JsonUtils::successResponse(jsonResponse);
}

std::string QueryProvider::clearCache(std::string_view) {
    m_resultCache->clear();
    return JsonUtils::successResponse(R"({"cleared":true})");
}

std::string QueryProvider::getQueryHistory(std::string_view) {
    auto historyEntries = m_queryHistory.getAll();
    auto jsonResponse = JsonUtils::buildArray(historyEntries, [](std::string& out, const HistoryItem& e) {
        auto timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(e.timestamp.time_since_epoch()).count();
        out += std::format(R"({{"id":"{}","sql":"{}","connectionId":"{}","timestamp":{},"executionTimeMs":{},"success":{},"errorMessage":"{}","affectedRows":{},"isFavorite":{}}})", e.id,
                           JsonUtils::escapeString(e.sql), JsonUtils::escapeString(e.connectionId), timestamp, e.executionTimeMs, e.success ? "true" : "false", JsonUtils::escapeString(e.errorMessage),
                           e.affectedRows, e.isFavorite ? "true" : "false");
    });
    return JsonUtils::successResponse(jsonResponse);
}

std::string QueryProvider::removeQueryHistory(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);
        auto idResult = doc["id"].get_string();
        if (idResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: id");
        }
        m_queryHistory.remove(idResult.value());
        return JsonUtils::successResponse(R"({"removed":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::clearQueryHistory(std::string_view) {
    m_queryHistory.clear();
    return JsonUtils::successResponse(R"({"cleared":true})");
}

std::string QueryProvider::setQueryHistoryFavorite(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);
        auto idResult = doc["id"].get_string();
        auto isFavoriteResult = doc["isFavorite"].get_bool();
        if (idResult.error() || isFavoriteResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: id or isFavorite");
        }
        m_queryHistory.setFavorite(idResult.value(), isFavoriteResult.value());
        return JsonUtils::successResponse(R"({"updated":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::buildDataViewSql(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["tableName"].get_string();
        auto limitResult = doc["limit"].get_int64();
        if (connectionIdResult.error() || tableNameResult.error() || limitResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId, tableName, or limit");
        }
        std::string_view connectionId = connectionIdResult.value();
        std::string_view tableName = tableNameResult.value();
        auto limit = std::max(limitResult.value(), int64_t{0});

        auto formatter = DriverFactory::createSqlFormattable(m_connections.getDriverType(connectionId));
        std::string_view whereClause;
        if (auto whereResult = doc["whereClause"].get_string(); !whereResult.error()) {
            whereClause = whereResult.value();
        }

        auto sql = SqlBuilder(*formatter).buildDataView(tableName, whereClause, limit);
        return JsonUtils::successResponse(std::format(R"({{"sql":"{}"}})", JsonUtils::escapeString(sql)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::buildWhereClause(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto conditionsResult = doc["conditions"].get_array();
        if (connectionIdResult.error() || conditionsResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or conditions");
        }

        auto formatter = DriverFactory::createSqlFormattable(m_connections.getDriverType(connectionIdResult.value()));
        auto whereClause = SqlBuilder(*formatter).buildWhere(conditionsResult.value());
        return JsonUtils::successResponse(std::format(R"({{"whereClause":"{}"}})", JsonUtils::escapeString(whereClause)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::buildDmlStatements(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto schemaResult = doc["schema"].get_string();
        auto tableResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        std::string_view connectionId = connectionIdResult.value();
        std::string_view schema = schemaResult.error() ? std::string_view{} : schemaResult.value();
        std::string_view table = tableResult.value();

        std::vector<std::string> pkColumns;
        if (auto pkResult = doc["pkColumns"].get_array(); !pkResult.error()) {
            for (auto pk : pkResult.value()) {
                if (auto s = pk.get_string(); !s.error())
                    pkColumns.emplace_back(s.value());
            }
        }

        auto formatter = DriverFactory::createSqlFormattable(m_connections.getDriverType(connectionId));
        auto statements = SqlBuilder(*formatter)
                              .buildDml(DmlInput{.schema = schema,
                                                 .table = table,
                                                 .pkColumns = std::move(pkColumns),
                                                 .updates = toOpt(doc["updates"].get_array()),
                                                 .inserts = toOpt(doc["inserts"].get_array()),
                                                 .deletes = toOpt(doc["deletes"].get_array())});

        std::string statementsJson = "[";
        for (size_t i = 0; i < statements.size(); ++i) {
            if (i > 0)
                statementsJson += ",";
            statementsJson += "\"" + JsonUtils::escapeString(statements[i]) + "\"";
        }
        statementsJson += "]";
        return JsonUtils::successResponse(std::format(R"({{"statements":{}}})", statementsJson));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
