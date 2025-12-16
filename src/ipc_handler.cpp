#include "ipc_handler.h"

#include "database/async_query_executor.h"
#include "database/connection_pool.h"
#include "database/odbc_driver_detector.h"
#include "database/query_history.h"
#include "database/result_cache.h"
#include "database/schema_inspector.h"
#include "database/sqlserver_driver.h"
#include "database/transaction_manager.h"
#include "exporters/csv_exporter.h"
#include "exporters/excel_exporter.h"
#include "exporters/json_exporter.h"
#include "parsers/a5er_parser.h"
#include "parsers/sql_formatter.h"
#include "parsers/sql_parser.h"
#include "simdjson.h"
#include "utils/global_search.h"
#include "utils/json_utils.h"
#include "utils/logger.h"
#include "utils/session_manager.h"
#include "utils/settings_manager.h"
#include "utils/simd_filter.h"

#include <chrono>
#include <format>
#include <fstream>

using namespace std::literals;

namespace predategrip {

namespace {

struct DatabaseConnectionParams {
    std::string server;
    std::string database;
    std::string username;
    std::string password;
    bool useWindowsAuth = true;
};

/// Escapes special characters in ODBC connection string values.
/// Wraps value in braces and escapes any closing braces by doubling them.
/// This prevents connection string injection attacks with special characters.
[[nodiscard]] std::string escapeOdbcValue(std::string_view value) {
    std::string result = "{";
    for (auto c : value) {
        if (c == '}') {
            result += "}}";  // Escape closing brace by doubling
        } else {
            result += c;
        }
    }
    result += "}";
    return result;
}

[[nodiscard]] std::string buildODBCConnectionString(const DatabaseConnectionParams& params) {
    auto connectionString = buildDriverConnectionPrefix(params.server, params.database);

    if (params.useWindowsAuth) {
        connectionString += "Trusted_Connection=yes;";
    } else {
        // Escape username and password to prevent connection string injection
        connectionString += std::format("Uid={};Pwd={};", escapeOdbcValue(params.username), escapeOdbcValue(params.password));
    }

    return connectionString;
}

[[nodiscard]] std::expected<DatabaseConnectionParams, std::string> extractConnectionParams(std::string_view jsonParams) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(jsonParams);

        DatabaseConnectionParams result;
        auto serverResult = doc["server"].get_string();
        auto databaseResult = doc["database"].get_string();
        if (serverResult.error() || databaseResult.error()) {
            return std::unexpected("Missing required fields: server or database");
        }
        result.server = std::string(serverResult.value());
        result.database = std::string(databaseResult.value());

        if (auto username = doc["username"].get_string(); !username.error()) {
            result.username = std::string(username.value());
        }
        if (auto password = doc["password"].get_string(); !password.error()) {
            result.password = std::string(password.value());
        }
        if (auto auth = doc["useWindowsAuth"].get_bool(); !auth.error()) {
            result.useWindowsAuth = auth.value();
        }

        return result;
    } catch (const std::exception& e) {
        return std::unexpected(e.what());
    }
}

[[nodiscard]] std::expected<std::string, std::string> extractConnectionId(std::string_view jsonParams) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(jsonParams);
        auto result = doc["connectionId"].get_string();
        if (result.error()) {
            return std::unexpected("Missing connectionId field");
        }
        return std::string(result.value());
    } catch (const std::exception& e) {
        return std::unexpected(e.what());
    }
}

}  // namespace

IPCHandler::IPCHandler()
    : m_connectionPool(std::make_unique<ConnectionPool>())
    , m_schemaInspector(std::make_unique<SchemaInspector>())
    , m_queryHistory(std::make_unique<QueryHistory>())
    , m_resultCache(std::make_unique<ResultCache>())
    , m_asyncExecutor(std::make_unique<AsyncQueryExecutor>())
    , m_simdFilter(std::make_unique<SIMDFilter>())
    , m_settingsManager(std::make_unique<SettingsManager>())
    , m_sessionManager(std::make_unique<SessionManager>())
    , m_globalSearch(std::make_unique<GlobalSearch>())
    , m_sqlFormatter(std::make_unique<SQLFormatter>())
    , m_a5erParser(std::make_unique<A5ERParser>()) {
    m_settingsManager->load();
    m_sessionManager->load();
    registerRequestRoutes();
}

IPCHandler::~IPCHandler() = default;

void IPCHandler::registerRequestRoutes() {
    m_requestRoutes["connect"] = [this](std::string_view p) { return openDatabaseConnection(p); };
    m_requestRoutes["disconnect"] = [this](std::string_view p) { return closeDatabaseConnection(p); };
    m_requestRoutes["testConnection"] = [this](std::string_view p) { return verifyDatabaseConnection(p); };
    m_requestRoutes["executeQuery"] = [this](std::string_view p) { return executeSQL(p); };
    m_requestRoutes["executeQueryPaginated"] = [this](std::string_view p) { return executeSQLPaginated(p); };
    m_requestRoutes["getRowCount"] = [this](std::string_view p) { return getRowCount(p); };
    m_requestRoutes["cancelQuery"] = [this](std::string_view p) { return cancelRunningQuery(p); };
    m_requestRoutes["getTables"] = [this](std::string_view p) { return fetchTableList(p); };
    m_requestRoutes["getColumns"] = [this](std::string_view p) { return fetchColumnDefinitions(p); };
    m_requestRoutes["getDatabases"] = [this](std::string_view p) { return fetchDatabaseList(p); };
    m_requestRoutes["beginTransaction"] = [this](std::string_view p) { return startTransaction(p); };
    m_requestRoutes["commit"] = [this](std::string_view p) { return commitTransaction(p); };
    m_requestRoutes["rollback"] = [this](std::string_view p) { return rollbackTransaction(p); };
    m_requestRoutes["exportCSV"] = [this](std::string_view p) { return exportToCSV(p); };
    m_requestRoutes["exportJSON"] = [this](std::string_view p) { return exportToJSON(p); };
    m_requestRoutes["exportExcel"] = [this](std::string_view p) { return exportToExcel(p); };
    m_requestRoutes["formatSQL"] = [this](std::string_view p) { return formatSQLQuery(p); };
    m_requestRoutes["parseA5ER"] = [this](std::string_view p) { return parseA5ERFile(p); };
    m_requestRoutes["getQueryHistory"] = [this](std::string_view p) { return retrieveQueryHistory(p); };
    m_requestRoutes["getExecutionPlan"] = [this](std::string_view p) { return getExecutionPlan(p); };
    m_requestRoutes["getCacheStats"] = [this](std::string_view p) { return getCacheStats(p); };
    m_requestRoutes["clearCache"] = [this](std::string_view p) { return clearCache(p); };
    m_requestRoutes["executeAsyncQuery"] = [this](std::string_view p) { return executeAsyncQuery(p); };
    m_requestRoutes["getAsyncQueryResult"] = [this](std::string_view p) { return getAsyncQueryResult(p); };
    m_requestRoutes["cancelAsyncQuery"] = [this](std::string_view p) { return cancelAsyncQuery(p); };
    m_requestRoutes["getActiveQueries"] = [this](std::string_view p) { return getActiveQueries(p); };
    m_requestRoutes["filterResultSet"] = [this](std::string_view p) { return filterResultSet(p); };
    m_requestRoutes["getSettings"] = [this](std::string_view p) { return getSettings(p); };
    m_requestRoutes["updateSettings"] = [this](std::string_view p) { return updateSettings(p); };
    m_requestRoutes["getConnectionProfiles"] = [this](std::string_view p) { return getConnectionProfiles(p); };
    m_requestRoutes["saveConnectionProfile"] = [this](std::string_view p) { return saveConnectionProfile(p); };
    m_requestRoutes["deleteConnectionProfile"] = [this](std::string_view p) { return deleteConnectionProfile(p); };
    m_requestRoutes["getProfilePassword"] = [this](std::string_view p) { return getProfilePassword(p); };
    m_requestRoutes["getSessionState"] = [this](std::string_view p) { return getSessionState(p); };
    m_requestRoutes["saveSessionState"] = [this](std::string_view p) { return saveSessionState(p); };
    m_requestRoutes["searchObjects"] = [this](std::string_view p) { return searchObjects(p); };
    m_requestRoutes["quickSearch"] = [this](std::string_view p) { return quickSearch(p); };
    m_requestRoutes["getIndexes"] = [this](std::string_view p) { return fetchIndexes(p); };
    m_requestRoutes["getConstraints"] = [this](std::string_view p) { return fetchConstraints(p); };
    m_requestRoutes["getForeignKeys"] = [this](std::string_view p) { return fetchForeignKeys(p); };
    m_requestRoutes["getReferencingForeignKeys"] = [this](std::string_view p) { return fetchReferencingForeignKeys(p); };
    m_requestRoutes["getTriggers"] = [this](std::string_view p) { return fetchTriggers(p); };
    m_requestRoutes["getTableMetadata"] = [this](std::string_view p) { return fetchTableMetadata(p); };
    m_requestRoutes["getTableDDL"] = [this](std::string_view p) { return fetchTableDDL(p); };
    m_requestRoutes["writeFrontendLog"] = [this](std::string_view p) { return writeFrontendLog(p); };
}

std::string IPCHandler::dispatchRequest(std::string_view request) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(request);

        auto methodResult = doc["method"].get_string();
        if (methodResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing method field");
        }
        std::string_view method = methodResult.value();

        std::string params;
        if (auto paramsResult = doc["params"].get_string(); !paramsResult.error()) {
            params = std::string(paramsResult.value());
        }

        if (auto route = m_requestRoutes.find(std::string(method)); route != m_requestRoutes.end()) [[likely]] {
            return route->second(params);
        }

        return JsonUtils::errorResponse(std::format("Unknown method: {}", method));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::openDatabaseConnection(std::string_view params) {
    auto connectionParams = extractConnectionParams(params);
    if (!connectionParams) {
        return JsonUtils::errorResponse(connectionParams.error());
    }

    auto odbcString = buildODBCConnectionString(*connectionParams);

    auto driver = std::make_shared<SQLServerDriver>();
    if (!driver->connect(odbcString)) {
        return JsonUtils::errorResponse(std::format("Connection failed: {}", driver->getLastError()));
    }

    auto connectionId = std::format("conn_{}", m_connectionIdCounter++);
    m_activeConnections[connectionId] = driver;

    return JsonUtils::successResponse(std::format(R"({{"connectionId":"{}"}})", connectionId));
}

std::string IPCHandler::closeDatabaseConnection(std::string_view params) {
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }
    auto connectionId = *connectionIdResult;

    if (auto connection = m_activeConnections.find(connectionId); connection != m_activeConnections.end()) {
        connection->second->disconnect();
        m_activeConnections.erase(connection);
        // Clean up TransactionManager for this connection
        m_transactionManagers.erase(connectionId);
    }

    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::verifyDatabaseConnection(std::string_view params) {
    auto connectionParams = extractConnectionParams(params);
    if (!connectionParams) {
        return JsonUtils::errorResponse(connectionParams.error());
    }

    auto odbcString = buildODBCConnectionString(*connectionParams);

    SQLServerDriver driver;
    if (driver.connect(odbcString)) {
        driver.disconnect();
        return JsonUtils::successResponse(R"({"success":true,"message":"Connection successful"})");
    }

    return JsonUtils::successResponse(std::format(R"({{"success":false,"message":"{}"}})", JsonUtils::escapeString(driver.getLastError())));
}

std::string IPCHandler::executeSQL(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        std::string connectionId = std::string(connectionIdResult.value());
        std::string sqlQuery = std::string(sqlQueryResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        // Split SQL into multiple statements
        auto statements = SQLParser::splitStatements(sqlQuery);

        log<LogLevel::INFO>(std::format("Split SQL into {} statements", statements.size()));
        for (size_t i = 0; i < statements.size(); ++i) {
            log<LogLevel::INFO>(std::format("Statement {}: '{}'", i + 1, statements[i]));
        }

        // If multiple statements, execute them sequentially and collect all results
        if (statements.size() > 1) {
            struct StatementResult {
                std::string statement;
                ResultSet result;
            };
            std::vector<StatementResult> allResults;
            auto startTime = std::chrono::high_resolution_clock::now();

            try {
                for (const auto& stmt : statements) {
                    ResultSet currentResult;

                    // Check if this is a USE statement
                    if (SQLParser::isUseStatement(stmt)) {
                        std::string dbName = SQLParser::extractDatabaseName(stmt);
                        [[maybe_unused]] auto _ = driver->execute(stmt);
                        log<LogLevel::INFO>(std::format("Database switched to '{}' for connection '{}'", dbName, connectionId));

                        // Create result for USE statement
                        currentResult.columns.push_back({.name = "Message", .type = "VARCHAR", .size = 255, .nullable = false, .isPrimaryKey = false});
                        ResultRow messageRow;
                        messageRow.values.push_back(std::format("Database changed to {}", dbName));
                        currentResult.rows.push_back(messageRow);
                        currentResult.affectedRows = 0;
                        currentResult.executionTimeMs = 0.0;
                    } else {
                        // Execute regular statement
                        currentResult = driver->execute(stmt);
                    }

                    allResults.push_back({.statement = stmt, .result = std::move(currentResult)});
                }

                auto endTime = std::chrono::high_resolution_clock::now();
                auto duration = std::chrono::duration<double, std::milli>(endTime - startTime);

                // Construct JSON for multiple results
                std::string jsonResponse = R"({"multipleResults":true,"results":[)";
                for (size_t i = 0; i < allResults.size(); ++i) {
                    if (i > 0)
                        jsonResponse += ",";

                    allResults[i].result.executionTimeMs = duration.count() / static_cast<double>(allResults.size());

                    jsonResponse += R"({"statement":")";
                    jsonResponse += JsonUtils::escapeString(allResults[i].statement);
                    jsonResponse += R"(","data":)";
                    jsonResponse += JsonUtils::serializeResultSet(allResults[i].result, false);
                    jsonResponse += "}";
                }
                jsonResponse += "]}";

                log<LogLevel::INFO>(std::format("Returning {} results from multi-statement execution", allResults.size()));
                return JsonUtils::successResponse(jsonResponse);
            } catch (const std::exception& e) {
                return JsonUtils::errorResponse(std::format("Failed to execute SQL: {}", e.what()));
            }
        }

        // Single statement - handle USE statement specially
        if (SQLParser::isUseStatement(sqlQuery)) {
            std::string dbName = SQLParser::extractDatabaseName(sqlQuery);

            try {
                [[maybe_unused]] auto _ = driver->execute(sqlQuery);
                log<LogLevel::INFO>(std::format("Database switched to '{}' for connection '{}'", dbName, connectionId));

                // Create a ResultSet with a message row
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

        // Check if cache should be used (default: true for SELECT queries)
        bool useCache = true;
        if (auto useCacheOpt = doc["useCache"].get_bool(); !useCacheOpt.error()) {
            useCache = useCacheOpt.value();
        }

        // Generate cache key from connection + query
        std::string cacheKey = connectionId + ":" + sqlQuery;

        // Check cache for SELECT queries
        bool isSelectQuery = sqlQuery.find("SELECT") != std::string::npos || sqlQuery.find("select") != std::string::npos;
        if (useCache && isSelectQuery) {
            if (auto cachedResult = m_resultCache->get(cacheKey); cachedResult.has_value()) {
                return JsonUtils::successResponse(JsonUtils::serializeResultSet(*cachedResult, true));
            }
        }

        ResultSet queryResult = driver->execute(sqlQuery);

        // Store in cache for SELECT queries
        if (useCache && isSelectQuery) {
            m_resultCache->put(cacheKey, queryResult);
        }

        std::string jsonResponse = JsonUtils::serializeResultSet(queryResult, false);

        // Record in query history
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

std::string IPCHandler::cancelRunningQuery(std::string_view params) {
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }
    auto connectionId = *connectionIdResult;

    if (auto connection = m_activeConnections.find(connectionId); connection != m_activeConnections.end()) {
        connection->second->cancel();
    }

    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::fetchTableList(std::string_view params) {
    predategrip::log<LogLevel::DEBUG>(std::format("IPCHandler::fetchTableList called with params: {}", params));

    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        predategrip::log<LogLevel::ERROR_LEVEL>(std::format("IPCHandler::fetchTableList: Failed to extract connection ID: {}", connectionIdResult.error()));
        return JsonUtils::errorResponse(connectionIdResult.error());
    }
    auto connectionId = *connectionIdResult;

    try {
        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            predategrip::log<LogLevel::ERROR_LEVEL>(std::format("IPCHandler::fetchTableList: Connection not found: {}", connectionId));
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;
        predategrip::log<LogLevel::DEBUG>(std::format("IPCHandler::fetchTableList: Driver found for connection: {}", connectionId));

        // Filter to only include user tables and views (exclude system tables)
        constexpr auto tableListQuery = R"(
            SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        )";

        predategrip::log<LogLevel::DEBUG>("IPCHandler::fetchTableList: Executing table list query"sv);
        ResultSet queryResult = driver->execute(tableListQuery);

        predategrip::log<LogLevel::INFO>(std::format("IPCHandler::fetchTableList: Found {} tables/views", queryResult.rows.size()));

        std::string jsonResponse = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                jsonResponse += ',';
            jsonResponse += std::format(R"({{"schema":"{}","name":"{}","type":"{}"}})", JsonUtils::escapeString(queryResult.rows[i].values[0]), JsonUtils::escapeString(queryResult.rows[i].values[1]),
                                        JsonUtils::escapeString(queryResult.rows[i].values[2]));
        }
        jsonResponse += ']';

        predategrip::log<LogLevel::DEBUG>("IPCHandler::fetchTableList: Returning JSON response"sv);
        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        predategrip::log<LogLevel::ERROR_LEVEL>(std::format("IPCHandler::fetchTableList: Exception: {}", e.what()));
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchColumnDefinitions(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        std::string connectionId = std::string(connectionIdResult.value());
        std::string tableName = std::string(tableNameResult.value());

        // Validate table name to prevent SQL injection
        // Only allow alphanumeric, underscore, and common schema prefixes
        auto isValidIdentifier = [](const std::string& name) -> bool {
            if (name.empty() || name.length() > 128) {
                return false;
            }
            for (char c : name) {
                if (!std::isalnum(static_cast<unsigned char>(c)) && c != '_' && c != '.' && c != '[' && c != ']') {
                    return false;
                }
            }
            return true;
        };

        if (!isValidIdentifier(tableName)) [[unlikely]] {
            return JsonUtils::errorResponse("Invalid table name");
        }

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        // Escape single quotes in table name for safety
        std::string escapedTableName;
        escapedTableName.reserve(tableName.size() * 2);
        for (char c : tableName) {
            if (c == '\'') {
                escapedTableName += "''";
            } else {
                escapedTableName += c;
            }
        }

        auto columnQuery = std::format(R"(
            SELECT
                c.COLUMN_NAME,
                c.DATA_TYPE,
                COALESCE(c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, 0) as SIZE,
                CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as IS_NULLABLE,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as IS_PRIMARY_KEY
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT ku.TABLE_NAME, ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                    ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            ) pk ON c.TABLE_NAME = pk.TABLE_NAME AND c.COLUMN_NAME = pk.COLUMN_NAME
            WHERE c.TABLE_NAME = '{}'
            ORDER BY c.ORDINAL_POSITION
        )",
                                       escapedTableName);

        ResultSet queryResult = driver->execute(columnQuery);

        std::string jsonResponse = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                jsonResponse += ',';
            jsonResponse += std::format(R"({{"name":"{}","type":"{}","size":{},"nullable":{},"isPrimaryKey":{}}})", JsonUtils::escapeString(queryResult.rows[i].values[0]),
                                        JsonUtils::escapeString(queryResult.rows[i].values[1]), queryResult.rows[i].values[2], queryResult.rows[i].values[3] == "1" ? "true" : "false",
                                        queryResult.rows[i].values[4] == "1" ? "true" : "false");
        }
        jsonResponse += ']';

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchDatabaseList(std::string_view params) {
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }
    auto connectionId = *connectionIdResult;

    try {
        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;
        ResultSet queryResult = driver->execute("SELECT name FROM sys.databases ORDER BY name");

        std::string jsonResponse = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                jsonResponse += ',';
            jsonResponse += std::format(R"("{}")", JsonUtils::escapeString(queryResult.rows[i].values[0]));
        }
        jsonResponse += ']';

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::startTransaction(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        if (connectionIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: connectionId");
        }
        auto connectionId = std::string(connectionIdResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        // Create TransactionManager for this connection if not exists
        if (m_transactionManagers.find(connectionId) == m_transactionManagers.end()) {
            auto txManager = std::make_unique<TransactionManager>();
            txManager->setDriver(connection->second);  // shared_ptr directly
            m_transactionManagers[connectionId] = std::move(txManager);
        }

        m_transactionManagers[connectionId]->begin();
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::commitTransaction(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        if (connectionIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: connectionId");
        }
        auto connectionId = std::string(connectionIdResult.value());

        auto txManager = m_transactionManagers.find(connectionId);
        if (txManager == m_transactionManagers.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("No transaction manager for connection: {}", connectionId));
        }

        txManager->second->commit();
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::rollbackTransaction(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        if (connectionIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: connectionId");
        }
        auto connectionId = std::string(connectionIdResult.value());

        auto txManager = m_transactionManagers.find(connectionId);
        if (txManager == m_transactionManagers.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("No transaction manager for connection: {}", connectionId));
        }

        txManager->second->rollback();
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::exportToCSV(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto filepathResult = doc["filepath"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || filepathResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId, filepath, or sql");
        }
        std::string connectionId = std::string(connectionIdResult.value());
        std::string filepath = std::string(filepathResult.value());
        std::string sqlQuery = std::string(sqlQueryResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;
        ResultSet queryResult = driver->execute(sqlQuery);

        ExportOptions options;
        if (auto delimiter = doc["delimiter"].get_string(); !delimiter.error()) {
            options.delimiter = std::string(delimiter.value());
        }
        if (auto includeHeader = doc["includeHeader"].get_bool(); !includeHeader.error()) {
            options.includeHeader = includeHeader.value();
        }
        if (auto nullValue = doc["nullValue"].get_string(); !nullValue.error()) {
            options.nullValue = std::string(nullValue.value());
        }

        CSVExporter exporter;
        if (exporter.exportData(queryResult, filepath, options)) {
            return JsonUtils::successResponse(std::format(R"({{"filepath":"{}"}})", JsonUtils::escapeString(filepath)));
        }
        return JsonUtils::errorResponse("Failed to export CSV");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::exportToJSON(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto filepathResult = doc["filepath"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || filepathResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId, filepath, or sql");
        }
        std::string connectionId = std::string(connectionIdResult.value());
        std::string filepath = std::string(filepathResult.value());
        std::string sqlQuery = std::string(sqlQueryResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;
        ResultSet queryResult = driver->execute(sqlQuery);

        JSONExporter exporter;
        if (auto prettyPrint = doc["prettyPrint"].get_bool(); !prettyPrint.error()) {
            exporter.setPrettyPrint(prettyPrint.value());
        }

        ExportOptions options;
        if (exporter.exportData(queryResult, filepath, options)) {
            return JsonUtils::successResponse(std::format(R"({{"filepath":"{}"}})", JsonUtils::escapeString(filepath)));
        }
        return JsonUtils::errorResponse("Failed to export JSON");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::exportToExcel(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto filepathResult = doc["filepath"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || filepathResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId, filepath, or sql");
        }
        std::string connectionId = std::string(connectionIdResult.value());
        std::string filepath = std::string(filepathResult.value());
        std::string sqlQuery = std::string(sqlQueryResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;
        ResultSet queryResult = driver->execute(sqlQuery);

        ExcelExporter exporter;
        ExportOptions options;
        if (exporter.exportData(queryResult, filepath, options)) {
            return JsonUtils::successResponse(std::format(R"({{"filepath":"{}"}})", JsonUtils::escapeString(filepath)));
        }
        return JsonUtils::errorResponse("Excel export not yet implemented");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::formatSQLQuery(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto sqlResult = doc["sql"].get_string();
        if (sqlResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing sql field");
        }
        std::string sqlQuery = std::string(sqlResult.value());

        SQLFormatter::FormatOptions options;
        auto formattedSQL = m_sqlFormatter->format(sqlQuery, options);
        return JsonUtils::successResponse(std::format(R"({{"sql":"{}"}})", JsonUtils::escapeString(formattedSQL)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::parseA5ERFile(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto filepathResult = doc["filepath"].get_string();
        if (filepathResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing filepath field");
        }
        std::string filepath = std::string(filepathResult.value());

        A5ERModel model = m_a5erParser->parse(filepath);

        // Build tables array
        std::string tablesJson = "[";
        for (size_t i = 0; i < model.tables.size(); ++i) {
            const auto& table = model.tables[i];
            if (i > 0)
                tablesJson += ',';

            // Build columns array for this table
            std::string columnsJson = "[";
            for (size_t j = 0; j < table.columns.size(); ++j) {
                const auto& col = table.columns[j];
                if (j > 0)
                    columnsJson += ',';
                columnsJson += std::format(R"({{"name":"{}","logicalName":"{}","type":"{}","size":{},"scale":{},"nullable":{},"isPrimaryKey":{},"defaultValue":"{}","comment":"{}"}})",
                                           JsonUtils::escapeString(col.name), JsonUtils::escapeString(col.logicalName), JsonUtils::escapeString(col.type), col.size, col.scale,
                                           col.nullable ? "true" : "false", col.isPrimaryKey ? "true" : "false", JsonUtils::escapeString(col.defaultValue), JsonUtils::escapeString(col.comment));
            }
            columnsJson += "]";

            // Build indexes array for this table
            std::string indexesJson = "[";
            for (size_t j = 0; j < table.indexes.size(); ++j) {
                const auto& idx = table.indexes[j];
                if (j > 0)
                    indexesJson += ',';

                std::string idxColumnsJson = "[";
                for (size_t k = 0; k < idx.columns.size(); ++k) {
                    if (k > 0)
                        idxColumnsJson += ',';
                    idxColumnsJson += std::format(R"("{}")", JsonUtils::escapeString(idx.columns[k]));
                }
                idxColumnsJson += "]";

                indexesJson += std::format(R"({{"name":"{}","columns":{},"isUnique":{}}})", JsonUtils::escapeString(idx.name), idxColumnsJson, idx.isUnique ? "true" : "false");
            }
            indexesJson += "]";

            tablesJson += std::format(R"({{"name":"{}","logicalName":"{}","comment":"{}","columns":{},"indexes":{},"posX":{},"posY":{}}})", JsonUtils::escapeString(table.name),
                                      JsonUtils::escapeString(table.logicalName), JsonUtils::escapeString(table.comment), columnsJson, indexesJson, table.posX, table.posY);
        }
        tablesJson += "]";

        // Build relations array
        std::string relationsJson = "[";
        for (size_t i = 0; i < model.relations.size(); ++i) {
            const auto& rel = model.relations[i];
            if (i > 0)
                relationsJson += ',';
            relationsJson += std::format(R"({{"name":"{}","parentTable":"{}","childTable":"{}","parentColumn":"{}","childColumn":"{}","cardinality":"{}"}})", JsonUtils::escapeString(rel.name),
                                         JsonUtils::escapeString(rel.parentTable), JsonUtils::escapeString(rel.childTable), JsonUtils::escapeString(rel.parentColumn),
                                         JsonUtils::escapeString(rel.childColumn), JsonUtils::escapeString(rel.cardinality));
        }
        relationsJson += "]";

        // Build final response
        std::string jsonResponse = "{";
        jsonResponse += "\"name\":\"" + JsonUtils::escapeString(model.name) + "\",";
        jsonResponse += "\"databaseType\":\"" + JsonUtils::escapeString(model.databaseType) + "\",";
        jsonResponse += "\"tables\":" + tablesJson + ",";
        jsonResponse += "\"relations\":" + relationsJson + "}";

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::retrieveQueryHistory(std::string_view) {
    auto historyEntries = m_queryHistory->getAll();

    std::string jsonResponse = "[";
    for (size_t i = 0; i < historyEntries.size(); ++i) {
        if (i > 0)
            jsonResponse += ',';
        jsonResponse +=
            std::format(R"({{"id":"{}","sql":"{}","executionTimeMs":{},"success":{},"affectedRows":{},"isFavorite":{}}})", historyEntries[i].id, JsonUtils::escapeString(historyEntries[i].sql),
                        historyEntries[i].executionTimeMs, historyEntries[i].success ? "true" : "false", historyEntries[i].affectedRows, historyEntries[i].isFavorite ? "true" : "false");
    }
    jsonResponse += ']';

    return JsonUtils::successResponse(jsonResponse);
}

std::string IPCHandler::getExecutionPlan(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        std::string connectionId = std::string(connectionIdResult.value());
        std::string sqlQuery = std::string(sqlQueryResult.value());
        bool actualPlan = false;
        if (auto actual = doc["actual"].get_bool(); !actual.error()) {
            actualPlan = actual.value();
        }

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        // Build execution plan query for SQL Server
        std::string planQuery;
        if (actualPlan) {
            // Actual execution plan (executes the query)
            planQuery = std::format("SET STATISTICS XML ON;\n{}\nSET STATISTICS XML OFF;", sqlQuery);
        } else {
            // Estimated execution plan (does not execute)
            planQuery = std::format("SET SHOWPLAN_TEXT ON;\nGO\n{}\nGO\nSET SHOWPLAN_TEXT OFF;", sqlQuery);
        }

        ResultSet queryResult = driver->execute(planQuery);

        // Collect plan text from result
        std::string planText;
        for (const auto& row : queryResult.rows) {
            for (const auto& value : row.values) {
                if (!planText.empty()) {
                    planText += "\n";
                }
                planText += value;
            }
        }

        std::string planJson = "{\"plan\":\"" + JsonUtils::escapeString(planText) + "\",";
        planJson += "\"actual\":" + std::string(actualPlan ? "true" : "false") + "}";
        return JsonUtils::successResponse(planJson);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getCacheStats(std::string_view) {
    auto currentSize = m_resultCache->getCurrentSize();
    auto maxSize = m_resultCache->getMaxSize();

    std::string jsonResponse = std::format(R"({{"currentSizeBytes":{},"maxSizeBytes":{},"usagePercent":{:.1f}}})", currentSize, maxSize,
                                           maxSize > 0 ? (static_cast<double>(currentSize) / static_cast<double>(maxSize)) * 100.0 : 0.0);

    return JsonUtils::successResponse(jsonResponse);
}

std::string IPCHandler::clearCache(std::string_view) {
    m_resultCache->clear();
    return JsonUtils::successResponse(R"({"cleared":true})");
}

std::string IPCHandler::executeAsyncQuery(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        std::string connectionId = std::string(connectionIdResult.value());
        std::string sqlQuery = std::string(sqlQueryResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto driver = connection->second;  // Copy shared_ptr to extend lifetime during async execution
        std::string queryId = m_asyncExecutor->submitQuery(driver, sqlQuery);

        return JsonUtils::successResponse(std::format(R"({{"queryId":"{}"}})", queryId));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getAsyncQueryResult(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto queryIdResult = doc["queryId"].get_string();
        if (queryIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: queryId");
        }
        std::string queryId = std::string(queryIdResult.value());

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

        if (asyncResult.result.has_value()) {
            const auto& queryResult = *asyncResult.result;

            jsonResponse += R"(,"columns":[)";
            for (size_t i = 0; i < queryResult.columns.size(); ++i) {
                if (i > 0)
                    jsonResponse += ',';
                jsonResponse += std::format(R"({{"name":"{}","type":"{}"}})", JsonUtils::escapeString(queryResult.columns[i].name), queryResult.columns[i].type);
            }
            jsonResponse += "],";

            jsonResponse += R"("rows":[)";
            for (size_t rowIndex = 0; rowIndex < queryResult.rows.size(); ++rowIndex) {
                if (rowIndex > 0)
                    jsonResponse += ',';
                jsonResponse += '[';
                for (size_t colIndex = 0; colIndex < queryResult.rows[rowIndex].values.size(); ++colIndex) {
                    if (colIndex > 0)
                        jsonResponse += ',';
                    jsonResponse += std::format(R"("{}")", JsonUtils::escapeString(queryResult.rows[rowIndex].values[colIndex]));
                }
                jsonResponse += ']';
            }
            jsonResponse += "],";

            jsonResponse += std::format(R"("affectedRows":{},"executionTimeMs":{})", queryResult.affectedRows, queryResult.executionTimeMs);
        }

        jsonResponse += "}";

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::cancelAsyncQuery(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto queryIdResult = doc["queryId"].get_string();
        if (queryIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: queryId");
        }
        std::string queryId = std::string(queryIdResult.value());

        bool cancelled = m_asyncExecutor->cancelQuery(queryId);

        return JsonUtils::successResponse(std::format(R"({{"cancelled":{}}})", cancelled ? "true" : "false"));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getActiveQueries(std::string_view) {
    auto activeIds = m_asyncExecutor->getActiveQueryIds();

    std::string jsonResponse = "[";
    for (size_t i = 0; i < activeIds.size(); ++i) {
        if (i > 0)
            jsonResponse += ',';
        jsonResponse += std::format(R"("{}")", activeIds[i]);
    }
    jsonResponse += "]";

    return JsonUtils::successResponse(jsonResponse);
}

std::string IPCHandler::filterResultSet(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

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

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        // First execute the query to get data
        auto& driver = connection->second;
        ResultSet queryResult = driver->execute(sqlQuery);

        // Apply SIMD-optimized filter
        std::vector<size_t> matchingIndices;
        if (filterType == "equals") {
            matchingIndices = m_simdFilter->filterEquals(queryResult, columnIndex, filterValue);
        } else if (filterType == "contains") {
            matchingIndices = m_simdFilter->filterContains(queryResult, columnIndex, filterValue);
        } else if (filterType == "range") {
            std::string minValue = filterValue;
            std::string maxValue;
            if (auto maxVal = doc["filterValueMax"].get_string(); !maxVal.error()) {
                maxValue = std::string(maxVal.value());
            }
            matchingIndices = m_simdFilter->filterRange(queryResult, columnIndex, minValue, maxValue);
        } else {
            return JsonUtils::errorResponse(std::format("Unknown filter type: {}", filterType));
        }

        // Build filtered result
        std::string jsonResponse = "{";

        // Columns
        jsonResponse += R"("columns":[)";
        for (size_t i = 0; i < queryResult.columns.size(); ++i) {
            if (i > 0)
                jsonResponse += ',';
            jsonResponse += std::format(R"({{"name":"{}","type":"{}"}})", JsonUtils::escapeString(queryResult.columns[i].name), queryResult.columns[i].type);
        }
        jsonResponse += "],";

        // Filtered rows
        jsonResponse += R"("rows":[)";
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

std::string IPCHandler::getSettings(std::string_view) {
    const auto& settings = m_settingsManager->getSettings();

    std::string json = "{";

    // General settings
    json += "\"general\":{";
    json += std::format("\"autoConnect\":{},", settings.general.autoConnect ? "true" : "false");
    json += std::format("\"lastConnectionId\":\"{}\",", JsonUtils::escapeString(settings.general.lastConnectionId));
    json += std::format("\"confirmOnExit\":{},", settings.general.confirmOnExit ? "true" : "false");
    json += std::format("\"maxQueryHistory\":{},", settings.general.maxQueryHistory);
    json += std::format("\"maxRecentConnections\":{},", settings.general.maxRecentConnections);
    json += std::format("\"language\":\"{}\"", JsonUtils::escapeString(settings.general.language));
    json += "},";

    // Editor settings
    json += "\"editor\":{";
    json += std::format("\"fontSize\":{},", settings.editor.fontSize);
    json += std::format("\"fontFamily\":\"{}\",", JsonUtils::escapeString(settings.editor.fontFamily));
    json += std::format("\"wordWrap\":{},", settings.editor.wordWrap ? "true" : "false");
    json += std::format("\"tabSize\":{},", settings.editor.tabSize);
    json += std::format("\"insertSpaces\":{},", settings.editor.insertSpaces ? "true" : "false");
    json += std::format("\"showLineNumbers\":{},", settings.editor.showLineNumbers ? "true" : "false");
    json += std::format("\"showMinimap\":{},", settings.editor.showMinimap ? "true" : "false");
    json += std::format("\"theme\":\"{}\"", JsonUtils::escapeString(settings.editor.theme));
    json += "},";

    // Grid settings
    json += "\"grid\":{";
    json += std::format("\"defaultPageSize\":{},", settings.grid.defaultPageSize);
    json += std::format("\"showRowNumbers\":{},", settings.grid.showRowNumbers ? "true" : "false");
    json += std::format("\"enableCellEditing\":{},", settings.grid.enableCellEditing ? "true" : "false");
    json += std::format("\"dateFormat\":\"{}\",", JsonUtils::escapeString(settings.grid.dateFormat));
    json += std::format("\"nullDisplay\":\"{}\"", JsonUtils::escapeString(settings.grid.nullDisplay));
    json += "}";

    json += "}";

    return JsonUtils::successResponse(json);
}

std::string IPCHandler::updateSettings(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        AppSettings settings = m_settingsManager->getSettings();

        // Update general settings
        if (auto general = doc["general"]; !general.error()) {
            if (auto val = general["autoConnect"].get_bool(); !val.error())
                settings.general.autoConnect = val.value();
            if (auto val = general["confirmOnExit"].get_bool(); !val.error())
                settings.general.confirmOnExit = val.value();
            if (auto val = general["maxQueryHistory"].get_int64(); !val.error())
                settings.general.maxQueryHistory = static_cast<int>(val.value());
            if (auto val = general["language"].get_string(); !val.error())
                settings.general.language = std::string(val.value());
        }

        // Update editor settings
        if (auto editor = doc["editor"]; !editor.error()) {
            if (auto val = editor["fontSize"].get_int64(); !val.error())
                settings.editor.fontSize = static_cast<int>(val.value());
            if (auto val = editor["fontFamily"].get_string(); !val.error())
                settings.editor.fontFamily = std::string(val.value());
            if (auto val = editor["wordWrap"].get_bool(); !val.error())
                settings.editor.wordWrap = val.value();
            if (auto val = editor["tabSize"].get_int64(); !val.error())
                settings.editor.tabSize = static_cast<int>(val.value());
            if (auto val = editor["theme"].get_string(); !val.error())
                settings.editor.theme = std::string(val.value());
        }

        // Update grid settings
        if (auto grid = doc["grid"]; !grid.error()) {
            if (auto val = grid["defaultPageSize"].get_int64(); !val.error())
                settings.grid.defaultPageSize = static_cast<int>(val.value());
            if (auto val = grid["showRowNumbers"].get_bool(); !val.error())
                settings.grid.showRowNumbers = val.value();
            if (auto val = grid["nullDisplay"].get_string(); !val.error())
                settings.grid.nullDisplay = std::string(val.value());
        }

        // Update window settings
        if (auto window = doc["window"]; !window.error()) {
            if (auto val = window["width"].get_int64(); !val.error())
                settings.window.width = static_cast<int>(val.value());
            if (auto val = window["height"].get_int64(); !val.error())
                settings.window.height = static_cast<int>(val.value());
            if (auto val = window["x"].get_int64(); !val.error())
                settings.window.x = static_cast<int>(val.value());
            if (auto val = window["y"].get_int64(); !val.error())
                settings.window.y = static_cast<int>(val.value());
            if (auto val = window["isMaximized"].get_bool(); !val.error())
                settings.window.isMaximized = val.value();
        }

        m_settingsManager->updateSettings(settings);
        m_settingsManager->save();

        return JsonUtils::successResponse(R"({"saved":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getConnectionProfiles(std::string_view) {
    const auto& profiles = m_settingsManager->getConnectionProfiles();

    std::string json = R"({"profiles":[)";
    for (size_t i = 0; i < profiles.size(); ++i) {
        if (i > 0)
            json += ',';
        const auto& p = profiles[i];
        json += "{";
        json += std::format("\"id\":\"{}\",", JsonUtils::escapeString(p.id));
        json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(p.name));
        json += std::format("\"server\":\"{}\",", JsonUtils::escapeString(p.server));
        json += std::format("\"port\":{},", p.port);
        json += std::format("\"database\":\"{}\",", JsonUtils::escapeString(p.database));
        json += std::format("\"username\":\"{}\",", JsonUtils::escapeString(p.username));
        json += std::format("\"useWindowsAuth\":{},", p.useWindowsAuth ? "true" : "false");
        json += std::format("\"savePassword\":{}", p.savePassword ? "true" : "false");
        json += "}";
    }
    json += "]}";

    return JsonUtils::successResponse(json);
}

std::string IPCHandler::saveConnectionProfile(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        ConnectionProfile profile;
        if (auto val = doc["id"].get_string(); !val.error())
            profile.id = std::string(val.value());
        if (auto val = doc["name"].get_string(); !val.error())
            profile.name = std::string(val.value());
        if (auto val = doc["server"].get_string(); !val.error())
            profile.server = std::string(val.value());
        if (auto val = doc["port"].get_int64(); !val.error())
            profile.port = static_cast<int>(val.value());
        if (auto val = doc["database"].get_string(); !val.error())
            profile.database = std::string(val.value());
        if (auto val = doc["username"].get_string(); !val.error())
            profile.username = std::string(val.value());
        if (auto val = doc["useWindowsAuth"].get_bool(); !val.error())
            profile.useWindowsAuth = val.value();
        if (auto val = doc["savePassword"].get_bool(); !val.error())
            profile.savePassword = val.value();

        // Generate ID if empty
        if (profile.id.empty()) {
            profile.id = std::format("profile_{}", std::chrono::system_clock::now().time_since_epoch().count());
        }

        // Check if profile exists
        if (m_settingsManager->getConnectionProfile(profile.id).has_value()) {
            m_settingsManager->updateConnectionProfile(profile);
        } else {
            m_settingsManager->addConnectionProfile(profile);
        }

        // Handle password encryption
        if (profile.savePassword) {
            if (auto val = doc["password"].get_string(); !val.error()) {
                auto password = std::string(val.value());
                if (!password.empty()) {
                    (void)m_settingsManager->setProfilePassword(profile.id, password);
                }
            }
        } else {
            // Clear saved password if savePassword is false
            (void)m_settingsManager->setProfilePassword(profile.id, "");
        }

        m_settingsManager->save();

        return JsonUtils::successResponse(std::format(R"({{"id":"{}"}})", JsonUtils::escapeString(profile.id)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::deleteConnectionProfile(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto profileIdResult = doc["id"].get_string();
        if (profileIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: id");
        }
        auto profileId = std::string(profileIdResult.value());
        m_settingsManager->removeConnectionProfile(profileId);
        m_settingsManager->save();

        return JsonUtils::successResponse(R"({"deleted":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getProfilePassword(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto idResult = doc["id"].get_string();
        if (idResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: id");
        }
        auto profileId = std::string(idResult.value());

        auto passwordResult = m_settingsManager->getProfilePassword(profileId);
        if (!passwordResult) {
            return JsonUtils::errorResponse(passwordResult.error());
        }

        return JsonUtils::successResponse(std::format(R"({{"password":"{}"}})", JsonUtils::escapeString(passwordResult.value())));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getSessionState(std::string_view) {
    const auto& state = m_sessionManager->getState();

    std::string json = "{";
    json += std::format("\"activeConnectionId\":\"{}\",", JsonUtils::escapeString(state.activeConnectionId));
    json += std::format("\"activeTabId\":\"{}\",", JsonUtils::escapeString(state.activeTabId));
    json += std::format("\"windowX\":{},", state.windowX);
    json += std::format("\"windowY\":{},", state.windowY);
    json += std::format("\"windowWidth\":{},", state.windowWidth);
    json += std::format("\"windowHeight\":{},", state.windowHeight);
    json += std::format("\"isMaximized\":{},", state.isMaximized ? "true" : "false");
    json += std::format("\"leftPanelWidth\":{},", state.leftPanelWidth);
    json += std::format("\"bottomPanelHeight\":{},", state.bottomPanelHeight);

    // Open tabs
    json += "\"openTabs\":[";
    for (size_t i = 0; i < state.openTabs.size(); ++i) {
        if (i > 0)
            json += ',';
        const auto& tab = state.openTabs[i];
        json += "{";
        json += std::format("\"id\":\"{}\",", JsonUtils::escapeString(tab.id));
        json += std::format("\"title\":\"{}\",", JsonUtils::escapeString(tab.title));
        json += std::format("\"content\":\"{}\",", JsonUtils::escapeString(tab.content));
        json += std::format("\"filePath\":\"{}\",", JsonUtils::escapeString(tab.filePath));
        json += std::format("\"isDirty\":{},", tab.isDirty ? "true" : "false");
        json += std::format("\"cursorLine\":{},", tab.cursorLine);
        json += std::format("\"cursorColumn\":{}", tab.cursorColumn);
        json += "}";
    }
    json += "],";

    // Expanded nodes
    json += "\"expandedTreeNodes\":[";
    for (size_t i = 0; i < state.expandedTreeNodes.size(); ++i) {
        if (i > 0)
            json += ',';
        json += std::format("\"{}\"", JsonUtils::escapeString(state.expandedTreeNodes[i]));
    }
    json += "]";

    json += "}";

    return JsonUtils::successResponse(json);
}

std::string IPCHandler::saveSessionState(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        SessionState state = m_sessionManager->getState();

        if (auto val = doc["activeConnectionId"].get_string(); !val.error())
            state.activeConnectionId = std::string(val.value());
        if (auto val = doc["activeTabId"].get_string(); !val.error())
            state.activeTabId = std::string(val.value());
        if (auto val = doc["windowX"].get_int64(); !val.error())
            state.windowX = static_cast<int>(val.value());
        if (auto val = doc["windowY"].get_int64(); !val.error())
            state.windowY = static_cast<int>(val.value());
        if (auto val = doc["windowWidth"].get_int64(); !val.error())
            state.windowWidth = static_cast<int>(val.value());
        if (auto val = doc["windowHeight"].get_int64(); !val.error())
            state.windowHeight = static_cast<int>(val.value());
        if (auto val = doc["isMaximized"].get_bool(); !val.error())
            state.isMaximized = val.value();
        if (auto val = doc["leftPanelWidth"].get_int64(); !val.error())
            state.leftPanelWidth = static_cast<int>(val.value());
        if (auto val = doc["bottomPanelHeight"].get_int64(); !val.error())
            state.bottomPanelHeight = static_cast<int>(val.value());

        // Update tabs
        state.openTabs.clear();
        if (auto tabs = doc["openTabs"].get_array(); !tabs.error()) {
            for (auto tabEl : tabs.value()) {
                EditorTab tab;
                if (auto val = tabEl["id"].get_string(); !val.error())
                    tab.id = std::string(val.value());
                if (auto val = tabEl["title"].get_string(); !val.error())
                    tab.title = std::string(val.value());
                if (auto val = tabEl["content"].get_string(); !val.error())
                    tab.content = std::string(val.value());
                if (auto val = tabEl["filePath"].get_string(); !val.error())
                    tab.filePath = std::string(val.value());
                if (auto val = tabEl["isDirty"].get_bool(); !val.error())
                    tab.isDirty = val.value();
                if (auto val = tabEl["cursorLine"].get_int64(); !val.error())
                    tab.cursorLine = static_cast<int>(val.value());
                if (auto val = tabEl["cursorColumn"].get_int64(); !val.error())
                    tab.cursorColumn = static_cast<int>(val.value());
                state.openTabs.push_back(tab);
            }
        }

        // Update expanded nodes
        state.expandedTreeNodes.clear();
        if (auto nodes = doc["expandedTreeNodes"].get_array(); !nodes.error()) {
            for (auto nodeEl : nodes.value()) {
                if (auto val = nodeEl.get_string(); !val.error()) {
                    state.expandedTreeNodes.push_back(std::string(val.value()));
                }
            }
        }

        m_sessionManager->updateState(state);
        m_sessionManager->save();

        return JsonUtils::successResponse(R"({"saved":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::searchObjects(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto patternResult = doc["pattern"].get_string();
        if (connectionIdResult.error() || patternResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or pattern");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto pattern = std::string(patternResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        SearchOptions options;
        if (auto val = doc["searchTables"].get_bool(); !val.error())
            options.searchTables = val.value();
        if (auto val = doc["searchViews"].get_bool(); !val.error())
            options.searchViews = val.value();
        if (auto val = doc["searchProcedures"].get_bool(); !val.error())
            options.searchProcedures = val.value();
        if (auto val = doc["searchFunctions"].get_bool(); !val.error())
            options.searchFunctions = val.value();
        if (auto val = doc["searchColumns"].get_bool(); !val.error())
            options.searchColumns = val.value();
        if (auto val = doc["caseSensitive"].get_bool(); !val.error())
            options.caseSensitive = val.value();
        if (auto val = doc["maxResults"].get_int64(); !val.error())
            options.maxResults = static_cast<int>(val.value());

        auto results = m_globalSearch->searchObjects(connection->second.get(), pattern, options);

        std::string json = "[";
        for (size_t i = 0; i < results.size(); ++i) {
            if (i > 0)
                json += ',';
            const auto& r = results[i];
            json += "{";
            json += std::format("\"objectType\":\"{}\",", JsonUtils::escapeString(r.objectType));
            json += std::format("\"schemaName\":\"{}\",", JsonUtils::escapeString(r.schemaName));
            json += std::format("\"objectName\":\"{}\",", JsonUtils::escapeString(r.objectName));
            json += std::format("\"parentName\":\"{}\"", JsonUtils::escapeString(r.parentName));
            json += "}";
        }
        json += "]";

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::quickSearch(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto prefixResult = doc["prefix"].get_string();
        if (connectionIdResult.error() || prefixResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or prefix");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto prefix = std::string(prefixResult.value());
        int limit = 20;
        if (auto val = doc["limit"].get_int64(); !val.error())
            limit = static_cast<int>(val.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto results = m_globalSearch->quickSearch(connection->second.get(), prefix, limit);

        std::string json = "[";
        for (size_t i = 0; i < results.size(); ++i) {
            if (i > 0)
                json += ',';
            json += std::format("\"{}\"", JsonUtils::escapeString(results[i]));
        }
        json += "]";

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchIndexes(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto tableName = std::string(tableNameResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        auto indexQuery = std::format(R"(
            SELECT
                i.name AS IndexName,
                i.type_desc AS IndexType,
                i.is_unique AS IsUnique,
                i.is_primary_key AS IsPrimaryKey,
                STUFF((
                    SELECT ',' + c.name
                    FROM sys.index_columns ic
                    JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                    WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                    ORDER BY ic.key_ordinal
                    FOR XML PATH('')
                ), 1, 1, '') AS Columns
            FROM sys.indexes i
            WHERE i.object_id = OBJECT_ID('{}')
              AND i.name IS NOT NULL
            ORDER BY i.is_primary_key DESC, i.name
        )",
                                      JsonUtils::escapeString(tableName));

        ResultSet queryResult = driver->execute(indexQuery);

        std::string json = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                json += ',';
            const auto& row = queryResult.rows[i];
            json += "{";
            json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            json += std::format("\"type\":\"{}\",", JsonUtils::escapeString(row.values[1]));
            json += std::format("\"isUnique\":{},", row.values[2] == "1" ? "true" : "false");
            json += std::format("\"isPrimaryKey\":{},", row.values[3] == "1" ? "true" : "false");
            // Convert comma-separated columns to array
            json += "\"columns\":[";
            if (!row.values[4].empty()) {
                std::string cols = row.values[4];
                size_t pos = 0;
                bool first = true;
                while ((pos = cols.find(',')) != std::string::npos || !cols.empty()) {
                    std::string col;
                    if (pos != std::string::npos) {
                        col = cols.substr(0, pos);
                        cols = cols.substr(pos + 1);
                    } else {
                        col = cols;
                        cols.clear();
                    }
                    if (!first)
                        json += ',';
                    json += std::format("\"{}\"", JsonUtils::escapeString(col));
                    first = false;
                    if (cols.empty())
                        break;
                }
            }
            json += "]";
            json += "}";
        }
        json += "]";

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchConstraints(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto tableName = std::string(tableNameResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        auto constraintQuery = std::format(R"(
            SELECT
                tc.CONSTRAINT_NAME,
                tc.CONSTRAINT_TYPE,
                STUFF((
                    SELECT ',' + kcu.COLUMN_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    WHERE kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                      AND kcu.TABLE_NAME = tc.TABLE_NAME
                    ORDER BY kcu.ORDINAL_POSITION
                    FOR XML PATH('')
                ), 1, 1, '') AS Columns,
                ISNULL(cc.CHECK_CLAUSE, dc.definition) AS Definition
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            LEFT JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
                ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
            LEFT JOIN sys.default_constraints dc
                ON dc.name = tc.CONSTRAINT_NAME
            WHERE tc.TABLE_NAME = '{}'
            ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME
        )",
                                           JsonUtils::escapeString(tableName));

        ResultSet queryResult = driver->execute(constraintQuery);

        std::string json = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                json += ',';
            const auto& row = queryResult.rows[i];
            json += "{";
            json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            json += std::format("\"type\":\"{}\",", JsonUtils::escapeString(row.values[1]));
            // Convert comma-separated columns to array
            json += "\"columns\":[";
            if (!row.values[2].empty()) {
                std::string cols = row.values[2];
                size_t pos = 0;
                bool first = true;
                while ((pos = cols.find(',')) != std::string::npos || !cols.empty()) {
                    std::string col;
                    if (pos != std::string::npos) {
                        col = cols.substr(0, pos);
                        cols = cols.substr(pos + 1);
                    } else {
                        col = cols;
                        cols.clear();
                    }
                    if (!first)
                        json += ',';
                    json += std::format("\"{}\"", JsonUtils::escapeString(col));
                    first = false;
                    if (cols.empty())
                        break;
                }
            }
            json += "],";
            json += std::format("\"definition\":\"{}\"", JsonUtils::escapeString(row.values[3]));
            json += "}";
        }
        json += "]";

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchForeignKeys(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto tableName = std::string(tableNameResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        auto fkQuery = std::format(R"(
            SELECT
                fk.name AS FKName,
                STUFF((
                    SELECT ',' + COL_NAME(fkc.parent_object_id, fkc.parent_column_id)
                    FROM sys.foreign_key_columns fkc
                    WHERE fkc.constraint_object_id = fk.object_id
                    ORDER BY fkc.constraint_column_id
                    FOR XML PATH('')
                ), 1, 1, '') AS Columns,
                OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable,
                STUFF((
                    SELECT ',' + COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id)
                    FROM sys.foreign_key_columns fkc
                    WHERE fkc.constraint_object_id = fk.object_id
                    ORDER BY fkc.constraint_column_id
                    FOR XML PATH('')
                ), 1, 1, '') AS ReferencedColumns,
                fk.delete_referential_action_desc AS OnDelete,
                fk.update_referential_action_desc AS OnUpdate
            FROM sys.foreign_keys fk
            WHERE fk.parent_object_id = OBJECT_ID('{}')
            ORDER BY fk.name
        )",
                                   JsonUtils::escapeString(tableName));

        ResultSet queryResult = driver->execute(fkQuery);

        std::string json = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                json += ',';
            const auto& row = queryResult.rows[i];
            json += "{";
            json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            // Columns array
            json += "\"columns\":[";
            if (!row.values[1].empty()) {
                std::string cols = row.values[1];
                size_t pos = 0;
                bool first = true;
                while ((pos = cols.find(',')) != std::string::npos || !cols.empty()) {
                    std::string col;
                    if (pos != std::string::npos) {
                        col = cols.substr(0, pos);
                        cols = cols.substr(pos + 1);
                    } else {
                        col = cols;
                        cols.clear();
                    }
                    if (!first)
                        json += ',';
                    json += std::format("\"{}\"", JsonUtils::escapeString(col));
                    first = false;
                    if (cols.empty())
                        break;
                }
            }
            json += "],";
            json += std::format("\"referencedTable\":\"{}\",", JsonUtils::escapeString(row.values[2]));
            // Referenced columns array
            json += "\"referencedColumns\":[";
            if (!row.values[3].empty()) {
                std::string cols = row.values[3];
                size_t pos = 0;
                bool first = true;
                while ((pos = cols.find(',')) != std::string::npos || !cols.empty()) {
                    std::string col;
                    if (pos != std::string::npos) {
                        col = cols.substr(0, pos);
                        cols = cols.substr(pos + 1);
                    } else {
                        col = cols;
                        cols.clear();
                    }
                    if (!first)
                        json += ',';
                    json += std::format("\"{}\"", JsonUtils::escapeString(col));
                    first = false;
                    if (cols.empty())
                        break;
                }
            }
            json += "],";
            json += std::format("\"onDelete\":\"{}\",", JsonUtils::escapeString(row.values[4]));
            json += std::format("\"onUpdate\":\"{}\"", JsonUtils::escapeString(row.values[5]));
            json += "}";
        }
        json += "]";

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchReferencingForeignKeys(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto tableName = std::string(tableNameResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        auto refFkQuery = std::format(R"(
            SELECT
                fk.name AS FKName,
                OBJECT_SCHEMA_NAME(fk.parent_object_id) + '.' + OBJECT_NAME(fk.parent_object_id) AS ReferencingTable,
                STUFF((
                    SELECT ',' + COL_NAME(fkc.parent_object_id, fkc.parent_column_id)
                    FROM sys.foreign_key_columns fkc
                    WHERE fkc.constraint_object_id = fk.object_id
                    ORDER BY fkc.constraint_column_id
                    FOR XML PATH('')
                ), 1, 1, '') AS ReferencingColumns,
                STUFF((
                    SELECT ',' + COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id)
                    FROM sys.foreign_key_columns fkc
                    WHERE fkc.constraint_object_id = fk.object_id
                    ORDER BY fkc.constraint_column_id
                    FOR XML PATH('')
                ), 1, 1, '') AS Columns,
                fk.delete_referential_action_desc AS OnDelete,
                fk.update_referential_action_desc AS OnUpdate
            FROM sys.foreign_keys fk
            WHERE fk.referenced_object_id = OBJECT_ID('{}')
            ORDER BY fk.name
        )",
                                      JsonUtils::escapeString(tableName));

        ResultSet queryResult = driver->execute(refFkQuery);

        std::string json = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                json += ',';
            const auto& row = queryResult.rows[i];
            json += "{";
            json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            json += std::format("\"referencingTable\":\"{}\",", JsonUtils::escapeString(row.values[1]));
            // Referencing columns array
            json += "\"referencingColumns\":[";
            if (!row.values[2].empty()) {
                std::string cols = row.values[2];
                size_t pos = 0;
                bool first = true;
                while ((pos = cols.find(',')) != std::string::npos || !cols.empty()) {
                    std::string col;
                    if (pos != std::string::npos) {
                        col = cols.substr(0, pos);
                        cols = cols.substr(pos + 1);
                    } else {
                        col = cols;
                        cols.clear();
                    }
                    if (!first)
                        json += ',';
                    json += std::format("\"{}\"", JsonUtils::escapeString(col));
                    first = false;
                    if (cols.empty())
                        break;
                }
            }
            json += "],";
            // Referenced columns (on this table)
            json += "\"columns\":[";
            if (!row.values[3].empty()) {
                std::string cols = row.values[3];
                size_t pos = 0;
                bool first = true;
                while ((pos = cols.find(',')) != std::string::npos || !cols.empty()) {
                    std::string col;
                    if (pos != std::string::npos) {
                        col = cols.substr(0, pos);
                        cols = cols.substr(pos + 1);
                    } else {
                        col = cols;
                        cols.clear();
                    }
                    if (!first)
                        json += ',';
                    json += std::format("\"{}\"", JsonUtils::escapeString(col));
                    first = false;
                    if (cols.empty())
                        break;
                }
            }
            json += "],";
            json += std::format("\"onDelete\":\"{}\",", JsonUtils::escapeString(row.values[4]));
            json += std::format("\"onUpdate\":\"{}\"", JsonUtils::escapeString(row.values[5]));
            json += "}";
        }
        json += "]";

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchTriggers(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto tableName = std::string(tableNameResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        auto triggerQuery = std::format(R"(
            SELECT
                t.name AS TriggerName,
                CASE
                    WHEN t.is_instead_of_trigger = 1 THEN 'INSTEAD OF'
                    ELSE 'AFTER'
                END AS TriggerType,
                STUFF((
                    SELECT ',' +
                        CASE te.type
                            WHEN 1 THEN 'INSERT'
                            WHEN 2 THEN 'UPDATE'
                            WHEN 3 THEN 'DELETE'
                        END
                    FROM sys.trigger_events te
                    WHERE te.object_id = t.object_id
                    FOR XML PATH('')
                ), 1, 1, '') AS Events,
                CASE WHEN t.is_disabled = 0 THEN 1 ELSE 0 END AS IsEnabled,
                OBJECT_DEFINITION(t.object_id) AS Definition
            FROM sys.triggers t
            WHERE t.parent_id = OBJECT_ID('{}')
            ORDER BY t.name
        )",
                                        JsonUtils::escapeString(tableName));

        ResultSet queryResult = driver->execute(triggerQuery);

        std::string json = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                json += ',';
            const auto& row = queryResult.rows[i];
            json += "{";
            json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            json += std::format("\"type\":\"{}\",", JsonUtils::escapeString(row.values[1]));
            // Events array
            json += "\"events\":[";
            if (!row.values[2].empty()) {
                std::string events = row.values[2];
                size_t pos = 0;
                bool first = true;
                while ((pos = events.find(',')) != std::string::npos || !events.empty()) {
                    std::string evt;
                    if (pos != std::string::npos) {
                        evt = events.substr(0, pos);
                        events = events.substr(pos + 1);
                    } else {
                        evt = events;
                        events.clear();
                    }
                    if (!first)
                        json += ',';
                    json += std::format("\"{}\"", JsonUtils::escapeString(evt));
                    first = false;
                    if (events.empty())
                        break;
                }
            }
            json += "],";
            json += std::format("\"isEnabled\":{},", row.values[3] == "1" ? "true" : "false");
            json += std::format("\"definition\":\"{}\"", JsonUtils::escapeString(row.values[4]));
            json += "}";
        }
        json += "]";

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchTableMetadata(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto tableName = std::string(tableNameResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        auto metadataQuery = std::format(R"(
            SELECT
                OBJECT_SCHEMA_NAME(o.object_id) AS SchemaName,
                o.name AS TableName,
                o.type_desc AS ObjectType,
                ISNULL(p.rows, 0) AS RowCount,
                CONVERT(varchar, o.create_date, 120) AS CreatedAt,
                CONVERT(varchar, o.modify_date, 120) AS ModifiedAt,
                ISNULL(USER_NAME(o.principal_id), 'dbo') AS Owner,
                ISNULL(ep.value, '') AS Comment
            FROM sys.objects o
            LEFT JOIN sys.partitions p ON o.object_id = p.object_id AND p.index_id IN (0, 1)
            LEFT JOIN sys.extended_properties ep ON ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
            WHERE o.object_id = OBJECT_ID('{}')
        )",
                                         JsonUtils::escapeString(tableName));

        ResultSet queryResult = driver->execute(metadataQuery);

        if (queryResult.rows.empty()) {
            return JsonUtils::errorResponse("Table not found");
        }

        const auto& row = queryResult.rows[0];
        std::string json = "{";
        json += std::format("\"schema\":\"{}\",", JsonUtils::escapeString(row.values[0]));
        json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[1]));
        json += std::format("\"type\":\"{}\",", JsonUtils::escapeString(row.values[2]));
        json += std::format("\"rowCount\":{},", row.values[3]);
        json += std::format("\"createdAt\":\"{}\",", JsonUtils::escapeString(row.values[4]));
        json += std::format("\"modifiedAt\":\"{}\",", JsonUtils::escapeString(row.values[5]));
        json += std::format("\"owner\":\"{}\",", JsonUtils::escapeString(row.values[6]));
        json += std::format("\"comment\":\"{}\"", JsonUtils::escapeString(row.values[7]));
        json += "}";

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchTableDDL(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto tableNameResult = doc["table"].get_string();
        if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or table");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto tableName = std::string(tableNameResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        // Build CREATE TABLE DDL from column information
        auto columnQuery = std::format(R"(
            SELECT
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_PRECISION,
                c.NUMERIC_SCALE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = '{}'
            ORDER BY c.ORDINAL_POSITION
        )",
                                       JsonUtils::escapeString(tableName));

        ResultSet columnResult = driver->execute(columnQuery);

        std::string ddl = "CREATE TABLE " + tableName + " (\n";
        for (size_t i = 0; i < columnResult.rows.size(); ++i) {
            const auto& row = columnResult.rows[i];
            if (i > 0)
                ddl += ",\n";
            ddl += "    " + row.values[0] + " " + row.values[1];

            // Add size/precision
            if (!row.values[2].empty() && row.values[2] != "-1") {
                ddl += "(" + row.values[2] + ")";
            } else if (!row.values[3].empty() && row.values[3] != "0") {
                ddl += "(" + row.values[3];
                if (!row.values[4].empty() && row.values[4] != "0") {
                    ddl += "," + row.values[4];
                }
                ddl += ")";
            }

            // Nullable
            if (row.values[5] == "NO") {
                ddl += " NOT NULL";
            }

            // Default value
            if (!row.values[6].empty()) {
                ddl += " DEFAULT " + row.values[6];
            }
        }

        // Add primary key constraint
        auto pkQuery = std::format(R"(
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_NAME = '{}'
              AND CONSTRAINT_NAME = (
                  SELECT CONSTRAINT_NAME
                  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
                  WHERE TABLE_NAME = '{}' AND CONSTRAINT_TYPE = 'PRIMARY KEY'
              )
            ORDER BY ORDINAL_POSITION
        )",
                                   JsonUtils::escapeString(tableName), JsonUtils::escapeString(tableName));

        ResultSet pkResult = driver->execute(pkQuery);
        if (!pkResult.rows.empty()) {
            ddl += ",\n    CONSTRAINT PK_" + tableName + " PRIMARY KEY (";
            for (size_t i = 0; i < pkResult.rows.size(); ++i) {
                if (i > 0)
                    ddl += ", ";
                ddl += pkResult.rows[i].values[0];
            }
            ddl += ")";
        }

        ddl += "\n);";

        std::string json = std::format("{{\"ddl\":\"{}\"}}", JsonUtils::escapeString(ddl));
        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::executeSQLPaginated(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto sqlQuery = std::string(sqlQueryResult.value());

        // Extract pagination parameters
        int64_t startRow = 0;
        int64_t endRow = 100;  // Default: 100 rows
        if (auto startRowOpt = doc["startRow"].get_int64(); !startRowOpt.error()) {
            startRow = startRowOpt.value();
        }
        if (auto endRowOpt = doc["endRow"].get_int64(); !endRowOpt.error()) {
            endRow = endRowOpt.value();
        }

        // Extract sort model (optional)
        std::string orderByClause;
        if (auto sortModel = doc["sortModel"].get_array(); !sortModel.error()) {
            std::string sortClauses;
            for (auto item : sortModel.value()) {
                auto colId = item["colId"].get_string();
                auto sort = item["sort"].get_string();
                if (!colId.error() && !sort.error()) {
                    if (!sortClauses.empty())
                        sortClauses += ", ";
                    sortClauses += std::string(colId.value()) + " " + (sort.value() == std::string_view("asc") ? "ASC" : "DESC");
                }
            }
            if (!sortClauses.empty()) {
                orderByClause = " ORDER BY " + sortClauses;
            }
        }

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        // Build paginated query using SQL Server OFFSET/FETCH
        // Note: OFFSET/FETCH requires ORDER BY clause
        std::string paginatedQuery;
        if (orderByClause.empty()) {
            // No sort specified - use a default order (e.g., by first column or row number)
            paginatedQuery = std::format("{} ORDER BY (SELECT NULL) OFFSET {} ROWS FETCH NEXT {} ROWS ONLY", sqlQuery, startRow, endRow - startRow);
        } else {
            paginatedQuery = std::format("{}{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY", sqlQuery, orderByClause, startRow, endRow - startRow);
        }

        ResultSet queryResult = driver->execute(paginatedQuery);

        std::string jsonResponse = JsonUtils::serializeResultSet(queryResult, false);

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getRowCount(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto sqlQuery = std::string(sqlQueryResult.value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

        // Optimize COUNT query for better performance:
        // 1. Use COUNT_BIG(*) instead of COUNT(*) for large tables
        // 2. Add WITH(NOLOCK) hint to avoid locking issues
        // Note: NOLOCK may read uncommitted data, but this is acceptable for row count estimation
        auto countQuery = std::format("SELECT COUNT_BIG(*) AS total_rows FROM ({}) AS subquery WITH(NOLOCK)", sqlQuery);

        ResultSet queryResult = driver->execute(countQuery);

        if (queryResult.rows.empty() || queryResult.rows[0].values.empty()) {
            return JsonUtils::errorResponse("Failed to get row count");
        }

        auto rowCount = queryResult.rows[0].values[0];
        auto json = std::format("{{\"rowCount\":{}}}", rowCount);

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::writeFrontendLog(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        std::string logContent = std::string(doc["content"].get_string().value());

        // Write to log/frontend.log
        std::filesystem::path logPath("log/frontend.log");
        std::filesystem::create_directories(logPath.parent_path());

        // Clear log on first write (app startup)
        static bool firstWrite = true;
        std::ofstream logFile(logPath, firstWrite ? std::ios::trunc : std::ios::app);
        firstWrite = false;

        if (!logFile.is_open()) {
            return JsonUtils::errorResponse("Failed to open frontend log file");
        }

        logFile << logContent;
        logFile.flush();
        logFile.close();

        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace predategrip
