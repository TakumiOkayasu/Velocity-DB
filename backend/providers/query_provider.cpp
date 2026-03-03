#include "query_provider.h"

#include "../database/connection_utils.h"
#include "../database/driver_interface.h"
#include "../database/psql_subprocess.h"
#include "../database/query_history.h"
#include "../database/result_cache.h"
#include "../interfaces/providers/connection_provider.h"
#include "../interfaces/sql_formattable.h"
#include "../parsers/copy_block_detector.h"
#include "../parsers/split_utils.h"
#include "../parsers/sql_parser.h"
#include "../utils/json_utils.h"
#include "../utils/logger.h"
#include "../utils/simd_filter.h"
#include "../utils/sql_validation.h"
#include "../utils/string_utils.h"
#include "simdjson.h"

#include <algorithm>
#include <chrono>
#include <format>

#undef max

using namespace std::literals;

namespace velocitydb {

QueryProvider::QueryProvider(IConnectionProvider& connections, QueryHistory& queryHistory) : m_connections(connections), m_resultCache(std::make_unique<ResultCache>()), m_queryHistory(queryHistory) {}

QueryProvider::~QueryProvider() = default;

void QueryProvider::recordHistory(const std::string& sql, const std::string& connectionId, double execTimeMs, bool success, std::string_view errorMsg, int64_t affectedRows) {
    m_queryHistory.add({.id = generateHistoryId(),
                        .sql = truncateHistorySql(sql),
                        .connectionId = connectionId,
                        .executionTimeMs = execTimeMs,
                        .success = success,
                        .errorMessage = std::string(errorMsg),
                        .affectedRows = affectedRows,
                        .isFavorite = false});
}

std::string QueryProvider::handleExecuteQuery(std::string_view params) {
    std::string connectionId;
    std::string sqlQuery;

    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        connectionId = std::string(connectionIdResult.value());
        sqlQuery = std::string(sqlQueryResult.value());

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
            auto psqlResult = executePsql(toPsqlConnectionInfo(*connParams), sqlQuery);
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
                        std::string dbName = SQLParser::extractDatabaseName(stmt);
                        [[maybe_unused]] auto _ = driver->execute(stmt);
                        currentResult.columns.push_back({.name = "Message", .type = "VARCHAR", .size = 255, .nullable = false, .isPrimaryKey = false});
                        ResultRow messageRow;
                        messageRow.values.push_back(std::format("Database changed to {}", dbName));
                        messageRow.nullFlags.push_back(false);
                        currentResult.rows.push_back(messageRow);
                        currentResult.affectedRows = 0;
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
                    } catch (...) {  // NOLINT(bugprone-empty-catch)
                    }
                auto errorMsg = std::format("Statement {} of {}: {}", stmtIdx + 1, statements.size(), e.what());
                recordHistory(sqlQuery, connectionId, 0.0, false, errorMsg);
                return JsonUtils::errorResponse(errorMsg);
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
                messageRow.nullFlags.push_back(false);
                useResult.rows.push_back(messageRow);
                useResult.affectedRows = 0;
                useResult.executionTimeMs = 0.0;
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
            if (auto cachedResult = m_resultCache->get(cacheKey); cachedResult.has_value()) {
                return JsonUtils::successResponse(JsonUtils::serializeResultSet(*cachedResult, true));
            }
        }

        auto queryResult = driver->execute(sqlQuery);

        if (useCache && selectQuery) {
            m_resultCache->put(cacheKey, queryResult);
        }

        std::string jsonResponse = JsonUtils::serializeResultSet(queryResult, false);

        recordHistory(sqlQuery, connectionId, queryResult.executionTimeMs, true, {}, static_cast<int64_t>(queryResult.affectedRows));

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        if (!sqlQuery.empty()) {
            recordHistory(sqlQuery, connectionId, 0.0, false, e.what());
        }
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
                JsonUtils::appendJsonValue(jsonResponse, row, colIndex);
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
    auto historyEntries = m_queryHistory.getAll();
    auto jsonResponse = JsonUtils::buildArray(historyEntries, [](std::string& out, const HistoryItem& e) {
        auto timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(e.timestamp.time_since_epoch()).count();
        out += std::format(R"({{"id":"{}","sql":"{}","connectionId":"{}","timestamp":{},"executionTimeMs":{},"success":{},"errorMessage":"{}","affectedRows":{},"isFavorite":{}}})", e.id,
                           JsonUtils::escapeString(e.sql), JsonUtils::escapeString(e.connectionId), timestamp, e.executionTimeMs, e.success ? "true" : "false", JsonUtils::escapeString(e.errorMessage),
                           e.affectedRows, e.isFavorite ? "true" : "false");
    });
    return JsonUtils::successResponse(jsonResponse);
}

std::string QueryProvider::handleRemoveQueryHistory(std::string_view params) {
    try {
        simdjson::dom::parser parser;
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

std::string QueryProvider::handleClearQueryHistory(std::string_view) {
    m_queryHistory.clear();
    return JsonUtils::successResponse(R"({"cleared":true})");
}

std::string QueryProvider::handleSetQueryHistoryFavorite(std::string_view params) {
    try {
        simdjson::dom::parser parser;
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

std::string QueryProvider::handleBuildDataViewSql(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["tableName"].get_string();
        auto limitResult = doc["limit"].get_int64();
        if (connectionIdResult.error() || tableNameResult.error() || limitResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId, tableName, or limit");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto tableName = std::string(tableNameResult.value());
        auto limit = std::max(limitResult.value(), int64_t{0});

        auto driverType = m_connections.getDriverType(connectionId);
        auto formatter = DriverFactory::createSqlFormattable(driverType);
        auto quotedTable = formatter->quoteIdentifier(tableName);

        std::string sql;
        if (auto whereResult = doc["whereClause"].get_string(); !whereResult.error() && !whereResult.value().empty()) {
            sql = formatter->buildSelectAllWhere(quotedTable, whereResult.value(), limit);
        } else {
            sql = formatter->buildSelectAll(quotedTable, limit);
        }

        return JsonUtils::successResponse(std::format(R"({{"sql":"{}"}})", JsonUtils::escapeString(sql)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::handleBuildWhereClause(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto conditionsResult = doc["conditions"].get_array();
        if (connectionIdResult.error() || conditionsResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or conditions");
        }
        auto connectionId = std::string(connectionIdResult.value());

        auto driverType = m_connections.getDriverType(connectionId);
        auto formatter = DriverFactory::createSqlFormattable(driverType);

        std::string whereClause;
        for (auto condition : conditionsResult.value()) {
            auto columnResult = condition["column"].get_string();
            if (columnResult.error())
                continue;

            if (!whereClause.empty()) {
                whereClause += " AND ";
            }

            auto quotedCol = formatter->quoteIdentifier(std::string(columnResult.value()));

            // null → IS NULL, string → quoted literal, numeric → unquoted
            auto valueEl = condition["value"];
            if (valueEl.error() || valueEl.is_null()) {
                whereClause += quotedCol + " IS NULL";
            } else if (auto v = valueEl.get_string(); !v.error()) {
                whereClause += quotedCol + " = " + formatter->quoteLiteral(v.value());
            } else if (!valueEl.get_int64().error() || !valueEl.get_uint64().error() || !valueEl.get_double().error() || !valueEl.get_bool().error()) {
                // Numeric/bool: embed directly without quoting (safe — no string content)
                whereClause += quotedCol + " = " + simdjson::minify(valueEl.value());
            } else {
                // Unknown type: fall back to quoted literal for safety
                whereClause += quotedCol + " = " + formatter->quoteLiteral(simdjson::minify(valueEl.value()));
            }
        }

        return JsonUtils::successResponse(std::format(R"({{"whereClause":"{}"}})", JsonUtils::escapeString(whereClause)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string QueryProvider::handleBuildDmlStatements(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto schemaResult = doc["schema"].get_string();
        auto tableResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto schema = schemaResult.error() ? std::string() : std::string(schemaResult.value());
        auto table = std::string(tableResult.value());

        auto driverType = m_connections.getDriverType(connectionId);
        auto formatter = DriverFactory::createSqlFormattable(driverType);

        auto fullTableName = schema.empty() ? formatter->quoteIdentifier(table) : formatter->quoteIdentifier(schema) + "." + formatter->quoteIdentifier(table);

        // Collect PK columns
        std::vector<std::string> pkColumns;
        if (auto pkResult = doc["pkColumns"].get_array(); !pkResult.error()) {
            for (auto pk : pkResult.value()) {
                if (auto s = pk.get_string(); !s.error())
                    pkColumns.emplace_back(s.value());
            }
        }

        std::string statementsJson = "[";
        bool firstStmt = true;

        auto appendStmt = [&](const std::string& sql) {
            if (!firstStmt)
                statementsJson += ",";
            firstStmt = false;
            statementsJson += "\"" + JsonUtils::escapeString(sql) + "\"";
        };

        // UPDATE statements
        if (auto updatesResult = doc["updates"].get_array(); !updatesResult.error()) {
            for (auto update : updatesResult.value()) {
                auto changesObj = update["changes"].get_object();
                auto originalObj = update["originalData"].get_object();
                if (changesObj.error())
                    continue;

                // SET clause
                std::string setClauses;
                for (auto field : changesObj.value()) {
                    if (!setClauses.empty())
                        setClauses += ", ";
                    auto col = formatter->quoteIdentifier(std::string(field.key));
                    if (field.value.is_null()) {
                        setClauses += col + " = NULL";
                    } else if (auto v = field.value.get_string(); !v.error()) {
                        setClauses += col + " = " + formatter->quoteLiteral(v.value());
                    } else {
                        setClauses += col + " = " + formatter->quoteLiteral(simdjson::minify(field.value));
                    }
                }

                // WHERE clause from PK or all original columns
                std::string whereClauses;
                auto buildWhere = [&](std::string_view colName) {
                    if (!whereClauses.empty())
                        whereClauses += " AND ";
                    auto col = formatter->quoteIdentifier(std::string(colName));
                    // Use original value for the WHERE
                    if (!originalObj.error()) {
                        auto origVal = originalObj.value()[colName];
                        if (origVal.is_null() || origVal.error()) {
                            whereClauses += col + " IS NULL";
                        } else if (auto v = origVal.get_string(); !v.error()) {
                            whereClauses += col + " = " + formatter->quoteLiteral(v.value());
                        } else {
                            whereClauses += col + " = " + formatter->quoteLiteral(simdjson::minify(origVal.value()));
                        }
                    }
                };

                if (!pkColumns.empty()) {
                    for (const auto& pk : pkColumns)
                        buildWhere(pk);
                } else if (!originalObj.error()) {
                    for (auto field : originalObj.value())
                        buildWhere(field.key);
                }

                if (!setClauses.empty() && !whereClauses.empty()) {
                    appendStmt("UPDATE " + fullTableName + " SET " + setClauses + " WHERE " + whereClauses + ";");
                }
            }
        }

        // INSERT statements
        if (auto insertsResult = doc["inserts"].get_array(); !insertsResult.error()) {
            for (auto insert : insertsResult.value()) {
                auto obj = insert.get_object();
                if (obj.error())
                    continue;

                std::string columns, values;
                for (auto field : obj.value()) {
                    if (!columns.empty()) {
                        columns += ", ";
                        values += ", ";
                    }
                    columns += formatter->quoteIdentifier(std::string(field.key));
                    if (field.value.is_null()) {
                        values += "NULL";
                    } else if (auto v = field.value.get_string(); !v.error()) {
                        values += formatter->quoteLiteral(v.value());
                    } else {
                        values += formatter->quoteLiteral(simdjson::minify(field.value));
                    }
                }

                if (!columns.empty()) {
                    appendStmt("INSERT INTO " + fullTableName + " (" + columns + ") VALUES (" + values + ");");
                }
            }
        }

        // DELETE statements
        if (auto deletesResult = doc["deletes"].get_array(); !deletesResult.error()) {
            for (auto del : deletesResult.value()) {
                auto obj = del.get_object();
                if (obj.error())
                    continue;

                std::string whereClauses;
                auto buildWhere = [&](std::string_view colName) {
                    if (!whereClauses.empty())
                        whereClauses += " AND ";
                    auto col = formatter->quoteIdentifier(std::string(colName));
                    auto val = obj.value()[colName];
                    if (val.is_null() || val.error()) {
                        whereClauses += col + " IS NULL";
                    } else if (auto v = val.get_string(); !v.error()) {
                        whereClauses += col + " = " + formatter->quoteLiteral(v.value());
                    } else {
                        whereClauses += col + " = " + formatter->quoteLiteral(simdjson::minify(val.value()));
                    }
                };

                if (!pkColumns.empty()) {
                    for (const auto& pk : pkColumns)
                        buildWhere(pk);
                } else {
                    for (auto field : obj.value())
                        buildWhere(field.key);
                }

                if (!whereClauses.empty()) {
                    appendStmt("DELETE FROM " + fullTableName + " WHERE " + whereClauses + ";");
                }
            }
        }

        statementsJson += "]";
        return JsonUtils::successResponse(std::format(R"({{"statements":{}}})", statementsJson));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
