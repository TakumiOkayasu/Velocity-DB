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
#include "simdjson.h"
#include "utils/global_search.h"
#include "utils/json_utils.h"
#include "utils/session_manager.h"
#include "utils/settings_manager.h"
#include "utils/simd_filter.h"

#include <chrono>
#include <format>

namespace predategrip {

namespace {

struct DatabaseConnectionParams {
    std::string server;
    std::string database;
    std::string username;
    std::string password;
    bool useWindowsAuth = true;
};

[[nodiscard]] std::string buildODBCConnectionString(const DatabaseConnectionParams& params) {
    auto connectionString = buildDriverConnectionPrefix(params.server, params.database);

    if (params.useWindowsAuth) {
        connectionString += "Trusted_Connection=yes;";
    } else {
        connectionString += std::format("Uid={};Pwd={};", params.username, params.password);
    }

    return connectionString;
}

[[nodiscard]] std::expected<DatabaseConnectionParams, std::string> extractConnectionParams(
    std::string_view jsonParams) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(jsonParams);

        DatabaseConnectionParams result;
        result.server = std::string(doc["server"].get_string().value());
        result.database = std::string(doc["database"].get_string().value());

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
    , m_transactionManager(std::make_unique<TransactionManager>())
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
    m_requestRoutes["getSessionState"] = [this](std::string_view p) { return getSessionState(p); };
    m_requestRoutes["saveSessionState"] = [this](std::string_view p) { return saveSessionState(p); };
    m_requestRoutes["searchObjects"] = [this](std::string_view p) { return searchObjects(p); };
    m_requestRoutes["quickSearch"] = [this](std::string_view p) { return quickSearch(p); };
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

    auto driver = std::make_unique<SQLServerDriver>();
    if (!driver->connect(odbcString)) {
        return JsonUtils::errorResponse(std::format("Connection failed: {}", driver->getLastError()));
    }

    auto connectionId = std::format("conn_{}", m_connectionIdCounter++);
    m_activeConnections[connectionId] = std::move(driver);

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

    return JsonUtils::successResponse(
        std::format(R"({{"success":false,"message":"{}"}})", JsonUtils::escapeString(driver.getLastError())));
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

        // Check if cache should be used (default: true for SELECT queries)
        bool useCache = true;
        if (auto useCacheOpt = doc["useCache"].get_bool(); !useCacheOpt.error()) {
            useCache = useCacheOpt.value();
        }

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        // Generate cache key from connection + query
        std::string cacheKey = connectionId + ":" + sqlQuery;

        // Check cache for SELECT queries
        bool isSelectQuery =
            sqlQuery.find("SELECT") != std::string::npos || sqlQuery.find("select") != std::string::npos;
        if (useCache && isSelectQuery) {
            if (auto cachedResult = m_resultCache->get(cacheKey); cachedResult.has_value()) {
                return JsonUtils::successResponse(JsonUtils::serializeResultSet(*cachedResult, true));
            }
        }

        auto& driver = connection->second;
        ResultSet queryResult = driver->execute(sqlQuery);

        // Store in cache for SELECT queries
        if (useCache && isSelectQuery) {
            m_resultCache->put(cacheKey, queryResult);
        }

        std::string jsonResponse = JsonUtils::serializeResultSet(queryResult, false);

        // Record in query history
        HistoryItem historyEntry{
            .id = std::format("hist_{}", std::chrono::system_clock::now().time_since_epoch().count()),
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

        constexpr auto tableListQuery = R"(
            SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
            FROM INFORMATION_SCHEMA.TABLES
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        )";

        ResultSet queryResult = driver->execute(tableListQuery);

        std::string jsonResponse = "[";
        for (size_t i = 0; i < queryResult.rows.size(); ++i) {
            if (i > 0)
                jsonResponse += ',';
            jsonResponse += std::format(R"({{"schema":"{}","name":"{}","type":"{}"}})",
                                        JsonUtils::escapeString(queryResult.rows[i].values[0]),
                                        JsonUtils::escapeString(queryResult.rows[i].values[1]),
                                        JsonUtils::escapeString(queryResult.rows[i].values[2]));
        }
        jsonResponse += ']';

        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
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
            jsonResponse +=
                std::format(R"({{"name":"{}","type":"{}","size":{},"nullable":{},"isPrimaryKey":{}}})",
                            JsonUtils::escapeString(queryResult.rows[i].values[0]),
                            JsonUtils::escapeString(queryResult.rows[i].values[1]), queryResult.rows[i].values[2],
                            queryResult.rows[i].values[3] == "1" ? "true" : "false",
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

std::string IPCHandler::startTransaction(std::string_view) {
    m_transactionManager->begin();
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::commitTransaction(std::string_view) {
    m_transactionManager->commit();
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::rollbackTransaction(std::string_view) {
    m_transactionManager->rollback();
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::exportToCSV(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string filepath = std::string(doc["filepath"].get_string().value());
        std::string sqlQuery = std::string(doc["sql"].get_string().value());

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

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string filepath = std::string(doc["filepath"].get_string().value());
        std::string sqlQuery = std::string(doc["sql"].get_string().value());

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

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string filepath = std::string(doc["filepath"].get_string().value());
        std::string sqlQuery = std::string(doc["sql"].get_string().value());

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
                columnsJson += std::format(
                    R"({{"name":"{}","logicalName":"{}","type":"{}","size":{},"scale":{},"nullable":{},"isPrimaryKey":{},"defaultValue":"{}","comment":"{}"}})",
                    JsonUtils::escapeString(col.name), JsonUtils::escapeString(col.logicalName),
                    JsonUtils::escapeString(col.type), col.size, col.scale, col.nullable ? "true" : "false",
                    col.isPrimaryKey ? "true" : "false", JsonUtils::escapeString(col.defaultValue),
                    JsonUtils::escapeString(col.comment));
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

                indexesJson +=
                    std::format(R"({{"name":"{}","columns":{},"isUnique":{}}})", JsonUtils::escapeString(idx.name),
                                idxColumnsJson, idx.isUnique ? "true" : "false");
            }
            indexesJson += "]";

            tablesJson += std::format(
                R"({{"name":"{}","logicalName":"{}","comment":"{}","columns":{},"indexes":{},"posX":{},"posY":{}}})",
                JsonUtils::escapeString(table.name), JsonUtils::escapeString(table.logicalName),
                JsonUtils::escapeString(table.comment), columnsJson, indexesJson, table.posX, table.posY);
        }
        tablesJson += "]";

        // Build relations array
        std::string relationsJson = "[";
        for (size_t i = 0; i < model.relations.size(); ++i) {
            const auto& rel = model.relations[i];
            if (i > 0)
                relationsJson += ',';
            relationsJson += std::format(
                R"({{"name":"{}","parentTable":"{}","childTable":"{}","parentColumn":"{}","childColumn":"{}","cardinality":"{}"}})",
                JsonUtils::escapeString(rel.name), JsonUtils::escapeString(rel.parentTable),
                JsonUtils::escapeString(rel.childTable), JsonUtils::escapeString(rel.parentColumn),
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
        jsonResponse += std::format(
            R"({{"id":"{}","sql":"{}","executionTimeMs":{},"success":{},"affectedRows":{},"isFavorite":{}}})",
            historyEntries[i].id, JsonUtils::escapeString(historyEntries[i].sql), historyEntries[i].executionTimeMs,
            historyEntries[i].success ? "true" : "false", historyEntries[i].affectedRows,
            historyEntries[i].isFavorite ? "true" : "false");
    }
    jsonResponse += ']';

    return JsonUtils::successResponse(jsonResponse);
}

std::string IPCHandler::getExecutionPlan(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string sqlQuery = std::string(doc["sql"].get_string().value());
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

    std::string jsonResponse =
        std::format(R"({{"currentSizeBytes":{},"maxSizeBytes":{},"usagePercent":{:.1f}}})", currentSize, maxSize,
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

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string sqlQuery = std::string(doc["sql"].get_string().value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;
        std::string queryId = m_asyncExecutor->submitQuery(driver.get(), sqlQuery);

        return JsonUtils::successResponse(std::format(R"({{"queryId":"{}"}})", queryId));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getAsyncQueryResult(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string queryId = std::string(doc["queryId"].get_string().value());

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
                jsonResponse +=
                    std::format(R"({{"name":"{}","type":"{}"}})", JsonUtils::escapeString(queryResult.columns[i].name),
                                queryResult.columns[i].type);
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
                    jsonResponse +=
                        std::format(R"("{}")", JsonUtils::escapeString(queryResult.rows[rowIndex].values[colIndex]));
                }
                jsonResponse += ']';
            }
            jsonResponse += "],";

            jsonResponse += std::format(R"("affectedRows":{},"executionTimeMs":{})", queryResult.affectedRows,
                                        queryResult.executionTimeMs);
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

        std::string queryId = std::string(doc["queryId"].get_string().value());

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

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string sqlQuery = std::string(doc["sql"].get_string().value());
        auto columnIndex = doc["columnIndex"].get_uint64().value();
        std::string filterType = std::string(doc["filterType"].get_string().value());
        std::string filterValue = std::string(doc["filterValue"].get_string().value());

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
            jsonResponse +=
                std::format(R"({{"name":"{}","type":"{}"}})", JsonUtils::escapeString(queryResult.columns[i].name),
                            queryResult.columns[i].type);
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

        jsonResponse += std::format(R"("totalRows":{},"filteredRows":{},"simdAvailable":{}}})", queryResult.rows.size(),
                                    matchingIndices.size(), SIMDFilter::isAVX2Available() ? "true" : "false");

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

        m_settingsManager->updateSettings(settings);
        m_settingsManager->save();

        return JsonUtils::successResponse(R"({"saved":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::getConnectionProfiles(std::string_view) {
    const auto& profiles = m_settingsManager->getConnectionProfiles();

    std::string json = "[";
    for (size_t i = 0; i < profiles.size(); ++i) {
        if (i > 0)
            json += ',';
        const auto& p = profiles[i];
        json += "{";
        json += std::format("\"id\":\"{}\",", JsonUtils::escapeString(p.id));
        json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(p.name));
        json += std::format("\"server\":\"{}\",", JsonUtils::escapeString(p.server));
        json += std::format("\"database\":\"{}\",", JsonUtils::escapeString(p.database));
        json += std::format("\"username\":\"{}\",", JsonUtils::escapeString(p.username));
        json += std::format("\"useWindowsAuth\":{}", p.useWindowsAuth ? "true" : "false");
        json += "}";
    }
    json += "]";

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
        if (auto val = doc["database"].get_string(); !val.error())
            profile.database = std::string(val.value());
        if (auto val = doc["username"].get_string(); !val.error())
            profile.username = std::string(val.value());
        if (auto val = doc["useWindowsAuth"].get_bool(); !val.error())
            profile.useWindowsAuth = val.value();

        // Check if profile exists
        if (m_settingsManager->getConnectionProfile(profile.id).has_value()) {
            m_settingsManager->updateConnectionProfile(profile);
        } else {
            if (profile.id.empty()) {
                profile.id = std::format("profile_{}", std::chrono::system_clock::now().time_since_epoch().count());
            }
            m_settingsManager->addConnectionProfile(profile);
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

        std::string profileId = std::string(doc["id"].get_string().value());
        m_settingsManager->removeConnectionProfile(profileId);
        m_settingsManager->save();

        return JsonUtils::successResponse(R"({"deleted":true})");
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

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string pattern = std::string(doc["pattern"].get_string().value());

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

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string prefix = std::string(doc["prefix"].get_string().value());
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

}  // namespace predategrip
