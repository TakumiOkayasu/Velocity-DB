#include "ipc_handler.h"

#include "database/connection_pool.h"
#include "database/query_history.h"
#include "database/schema_inspector.h"
#include "database/sqlserver_driver.h"
#include "database/transaction_manager.h"
#include "exporters/csv_exporter.h"
#include "exporters/excel_exporter.h"
#include "exporters/json_exporter.h"
#include "parsers/a5er_parser.h"
#include "parsers/sql_formatter.h"
#include "simdjson.h"
#include "utils/json_utils.h"

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
    auto connectionString =
        std::format("Driver={{ODBC Driver 17 for SQL Server}};Server={};Database={};", params.server, params.database);

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

[[nodiscard]] std::string extractConnectionId(std::string_view jsonParams) {
    simdjson::dom::parser parser;
    simdjson::dom::element doc = parser.parse(jsonParams);
    return std::string(doc["connectionId"].get_string().value());
}

}  // namespace

IPCHandler::IPCHandler()
    : m_connectionPool(std::make_unique<ConnectionPool>())
    , m_schemaInspector(std::make_unique<SchemaInspector>())
    , m_transactionManager(std::make_unique<TransactionManager>())
    , m_queryHistory(std::make_unique<QueryHistory>())
    , m_sqlFormatter(std::make_unique<SQLFormatter>())
    , m_a5erParser(std::make_unique<A5ERParser>()) {
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
    try {
        auto connectionId = extractConnectionId(params);

        if (auto connection = m_activeConnections.find(connectionId); connection != m_activeConnections.end()) {
            connection->second->disconnect();
            m_activeConnections.erase(connection);
        }

        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
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

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string sqlQuery = std::string(doc["sql"].get_string().value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;
        ResultSet queryResult = driver->execute(sqlQuery);

        std::string jsonResponse = "{";

        // Build columns array
        jsonResponse += R"("columns":[)";
        for (size_t i = 0; i < queryResult.columns.size(); ++i) {
            if (i > 0)
                jsonResponse += ',';
            jsonResponse +=
                std::format(R"({{"name":"{}","type":"{}"}})", JsonUtils::escapeString(queryResult.columns[i].name),
                            queryResult.columns[i].type);
        }
        jsonResponse += "],";

        // Build rows array
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

        jsonResponse += std::format(R"("affectedRows":{},"executionTimeMs":{}}})", queryResult.affectedRows,
                                    queryResult.executionTimeMs);

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
    try {
        auto connectionId = extractConnectionId(params);

        if (auto connection = m_activeConnections.find(connectionId); connection != m_activeConnections.end()) {
            connection->second->cancel();
        }

        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::fetchTableList(std::string_view params) {
    try {
        auto connectionId = extractConnectionId(params);

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

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string tableName = std::string(doc["table"].get_string().value());

        auto connection = m_activeConnections.find(connectionId);
        if (connection == m_activeConnections.end()) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto& driver = connection->second;

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
                                       tableName);

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
    try {
        auto connectionId = extractConnectionId(params);

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

std::string IPCHandler::parseA5ERFile(std::string_view) {
    // TODO: Implement A5:ER parsing
    return JsonUtils::successResponse("{}");
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

        return JsonUtils::successResponse(
            std::format(R"({{"plan":"{}","actual":{}}})", JsonUtils::escapeString(planText), actualPlan ? "true" : "false"));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace predategrip
