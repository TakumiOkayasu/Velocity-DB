#include "query_provider.h"

#include "../database/connection_utils.h"
#include "../database/driver_interface.h"
#include "../database/query_history.h"
#include "../database/result_cache.h"
#include "../interfaces/providers/connection_provider.h"
#include "../interfaces/sql_formattable.h"
#include "../parsers/split_utils.h"
#include "../parsers/sql_parser.h"
#include "../utils/json_utils.h"
#include "../utils/logger.h"
#include "../utils/simd_filter.h"
#include "../utils/sql_validation.h"
#include "simdjson.h"

#include <algorithm>
#include <chrono>
#include <format>

using namespace std::literals;

namespace velocitydb {

QueryProvider::QueryProvider(IConnectionProvider& connections) : m_connections(connections), m_resultCache(std::make_unique<ResultCache>()), m_queryHistory(std::make_unique<QueryHistory>()) {}

QueryProvider::~QueryProvider() = default;

std::string QueryProvider::handleExecuteQuery(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto sqlQuery = std::string(sqlQueryResult.value());

        auto driver = m_connections.getQueryDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        // Inject CopyBlockDetector for PostgreSQL connections
        auto statements = splitStatementsForDriver(sqlQuery, m_connections.getDriverType(connectionId));
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
                    (void)driver->execute("BEGIN");

                for (const auto& stmt : statements) {
                    auto stmtStart = std::chrono::high_resolution_clock::now();
                    ResultSet currentResult;
                    if (SQLParser::isUseStatement(stmt)) {
                        std::string dbName = SQLParser::extractDatabaseName(stmt);
                        [[maybe_unused]] auto _ = driver->execute(stmt);
                        currentResult.columns.push_back({.name = "Message", .type = "VARCHAR", .size = 255, .nullable = false, .isPrimaryKey = false});
                        ResultRow messageRow;
                        messageRow.values.push_back(std::format("Database changed to {}", dbName));
                        currentResult.rows.push_back(messageRow);
                        currentResult.affectedRows = 0;
                    } else {
                        currentResult = driver->execute(stmt);
                    }
                    auto stmtEnd = std::chrono::high_resolution_clock::now();
                    currentResult.executionTimeMs = std::chrono::duration<double, std::milli>(stmtEnd - stmtStart).count();
                    allResults.push_back({.statement = stmt, .result = std::move(currentResult)});
                    ++stmtIdx;
                }

                if (wrapTransaction)
                    (void)driver->execute("COMMIT");

                std::string jsonResponse = R"({"multipleResults":true,"results":[)";
                for (size_t i = 0; i < allResults.size(); ++i) {
                    if (i > 0)
                        jsonResponse += ",";
                    jsonResponse += R"({"statement":")";
                    jsonResponse += JsonUtils::escapeString(allResults[i].statement);
                    jsonResponse += R"(","data":)";
                    jsonResponse += JsonUtils::serializeResultSet(allResults[i].result, false);
                    jsonResponse += "}";
                }
                jsonResponse += "]}";
                return JsonUtils::successResponse(jsonResponse);
            } catch (const std::exception& e) {
                if (wrapTransaction)
                    try {
                        (void)driver->execute("ROLLBACK");
                    } catch (...) {
                    }
                return JsonUtils::errorResponse(std::format("Statement {} of {}: {}", stmtIdx + 1, statements.size(), e.what()));
            }
        }

        // Single USE statement
        if (SQLParser::isUseStatement(sqlQuery)) {
            std::string dbName = SQLParser::extractDatabaseName(sqlQuery);
            try {
                [[maybe_unused]] auto _ = driver->execute(sqlQuery);
                ResultSet useResult;
                useResult.columns.push_back({.name = "Message", .type = "VARCHAR", .size = 255, .nullable = false, .isPrimaryKey = false});
                ResultRow messageRow;
                messageRow.values.push_back(std::format("Database changed to {}", dbName));
                useResult.rows.push_back(messageRow);
                useResult.affectedRows = 0;
                useResult.executionTimeMs = 0.0;
                return JsonUtils::successResponse(JsonUtils::serializeResultSet(useResult, false));
            } catch (const std::exception& e) {
                return JsonUtils::errorResponse(std::format("Failed to switch database: {}", e.what()));
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
            if (auto cachedResult = m_resultCache->get(cacheKey); cachedResult.has_value()) {
                return JsonUtils::successResponse(JsonUtils::serializeResultSet(*cachedResult, true));
            }
        }

        auto queryResult = driver->execute(sqlQuery);

        if (useCache && selectQuery) {
            m_resultCache->put(cacheKey, queryResult);
        }

        std::string jsonResponse = JsonUtils::serializeResultSet(queryResult, false);

        HistoryItem historyEntry{.id = std::format("hist_{}", std::chrono::system_clock::now().time_since_epoch().count()),
                                 .sql = sqlQuery,
                                 .executionTimeMs = queryResult.executionTimeMs,
                                 .success = true,
                                 .affectedRows = static_cast<int64_t>(queryResult.affectedRows),
                                 .isFavorite = false};
        m_queryHistory->add(historyEntry);

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::handleExecuteQueryPaginated(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto sqlQuery = std::string(sqlQueryResult.value());

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
                    sortClauses += formatter->quoteIdentifier(std::string(colId.value())) + " " + (sort.value() == std::string_view("asc") ? "ASC" : "DESC");
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
            paginatedQuery = formatter->paginateQuery(sqlQuery + orderByClause, startRow, endRow - startRow);
        }

        auto queryResult = driver->execute(paginatedQuery);
        return JsonUtils::successResponse(JsonUtils::serializeResultSet(queryResult, false));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::handleGetRowCount(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto sqlQuery = std::string(sqlQueryResult.value());

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

std::string QueryProvider::handleCancelQuery(std::string_view params) {
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }
    if (auto driver = m_connections.getQueryDriver(*connectionIdResult)) {
        driver->cancel();
    }
    return JsonUtils::successResponse("{}");
}

std::string QueryProvider::handleFilterResultSet(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        auto columnIndexResult = doc["columnIndex"].get_uint64();
        auto filterTypeResult = doc["filterType"].get_string();
        auto filterValueResult = doc["filterValue"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error() || columnIndexResult.error() || filterTypeResult.error() || filterValueResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId, sql, columnIndex, filterType, or filterValue");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto sqlQuery = std::string(sqlQueryResult.value());
        auto columnIndex = columnIndexResult.value();
        auto filterType = std::string(filterTypeResult.value());
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

        std::string jsonResponse = "{";
        JsonUtils::appendColumns(jsonResponse, queryResult.columns);
        jsonResponse += R"(,"rows":[)";
        for (size_t i = 0; i < matchingIndices.size(); ++i) {
            if (i > 0)
                jsonResponse += ',';
            jsonResponse += '[';
            const auto& row = queryResult.rows[matchingIndices[i]];
            for (size_t colIndex = 0; colIndex < row.values.size(); ++colIndex) {
                if (colIndex > 0)
                    jsonResponse += ',';
                jsonResponse += std::format(R"("{}")", JsonUtils::escapeString(row.values[colIndex]));
            }
            jsonResponse += ']';
        }
        jsonResponse += "],";
        jsonResponse += std::format(R"("totalRows":{},"filteredRows":{},"simdAvailable":{}}})", queryResult.rows.size(), matchingIndices.size(), SIMDFilter::isAVX2Available() ? "true" : "false");
        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::handleGetCacheStats(std::string_view) {
    auto currentSize = m_resultCache->getCurrentSize();
    auto maxSize = m_resultCache->getMaxSize();
    std::string jsonResponse = std::format(R"({{"currentSizeBytes":{},"maxSizeBytes":{},"usagePercent":{:.1f}}})", currentSize, maxSize,
                                           maxSize > 0 ? (static_cast<double>(currentSize) / static_cast<double>(maxSize)) * 100.0 : 0.0);
    return JsonUtils::successResponse(jsonResponse);
}

std::string QueryProvider::handleClearCache(std::string_view) {
    m_resultCache->clear();
    return JsonUtils::successResponse(R"({"cleared":true})");
}

std::string QueryProvider::handleGetQueryHistory(std::string_view) {
    auto historyEntries = m_queryHistory->getAll();
    auto jsonResponse = JsonUtils::buildArray(historyEntries, [](std::string& out, const HistoryItem& e) {
        out += std::format(R"({{"id":"{}","sql":"{}","executionTimeMs":{},"success":{},"affectedRows":{},"isFavorite":{}}})", e.id, JsonUtils::escapeString(e.sql), e.executionTimeMs,
                           e.success ? "true" : "false", e.affectedRows, e.isFavorite ? "true" : "false");
    });
    return JsonUtils::successResponse(jsonResponse);
}

}  // namespace velocitydb
