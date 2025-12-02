#include "ipc_handler.h"
#include "database/sqlserver_driver.h"
#include "database/connection_pool.h"
#include "database/schema_inspector.h"
#include "database/transaction_manager.h"
#include "database/query_history.h"
#include "parsers/sql_formatter.h"
#include "parsers/a5er_parser.h"
#include "utils/json_utils.h"
#include "simdjson.h"
#include <sstream>
#include <chrono>

namespace predategrip {

IPCHandler::IPCHandler()
    : m_connectionPool(std::make_unique<ConnectionPool>())
    , m_schemaInspector(std::make_unique<SchemaInspector>())
    , m_transactionManager(std::make_unique<TransactionManager>())
    , m_queryHistory(std::make_unique<QueryHistory>())
    , m_sqlFormatter(std::make_unique<SQLFormatter>())
    , m_a5erParser(std::make_unique<A5ERParser>())
{
    registerHandlers();
}

IPCHandler::~IPCHandler() = default;

void IPCHandler::registerHandlers() {
    m_handlers["connect"] = [this](const std::string& p) { return handleConnect(p); };
    m_handlers["disconnect"] = [this](const std::string& p) { return handleDisconnect(p); };
    m_handlers["testConnection"] = [this](const std::string& p) { return handleTestConnection(p); };
    m_handlers["executeQuery"] = [this](const std::string& p) { return handleExecuteQuery(p); };
    m_handlers["getTables"] = [this](const std::string& p) { return handleGetTables(p); };
    m_handlers["getColumns"] = [this](const std::string& p) { return handleGetColumns(p); };
    m_handlers["getDatabases"] = [this](const std::string& p) { return handleGetDatabases(p); };
    m_handlers["beginTransaction"] = [this](const std::string& p) { return handleBeginTransaction(p); };
    m_handlers["commit"] = [this](const std::string& p) { return handleCommit(p); };
    m_handlers["rollback"] = [this](const std::string& p) { return handleRollback(p); };
    m_handlers["exportCSV"] = [this](const std::string& p) { return handleExportCSV(p); };
    m_handlers["exportJSON"] = [this](const std::string& p) { return handleExportJSON(p); };
    m_handlers["exportExcel"] = [this](const std::string& p) { return handleExportExcel(p); };
    m_handlers["formatSQL"] = [this](const std::string& p) { return handleFormatSQL(p); };
    m_handlers["parseA5ER"] = [this](const std::string& p) { return handleParseA5ER(p); };
    m_handlers["getQueryHistory"] = [this](const std::string& p) { return handleGetQueryHistory(p); };
}

std::string IPCHandler::handle(const std::string& request) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(request);

        std::string_view method_sv;
        auto method_result = doc["method"].get_string();
        if (method_result.error()) {
            return JsonUtils::errorResponse("Missing method field");
        }
        method_sv = method_result.value();

        std::string params;
        auto params_result = doc["params"].get_string();
        if (!params_result.error()) {
            params = std::string(params_result.value());
        }

        auto it = m_handlers.find(std::string(method_sv));
        if (it != m_handlers.end()) {
            return it->second(params);
        }

        return JsonUtils::errorResponse("Unknown method: " + std::string(method_sv));
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

// Build ODBC connection string from parameters
static std::string buildConnectionString(
    const std::string& server,
    const std::string& database,
    const std::string& username,
    const std::string& password,
    bool useWindowsAuth)
{
    std::ostringstream ss;
    ss << "Driver={ODBC Driver 17 for SQL Server};";
    ss << "Server=" << server << ";";
    ss << "Database=" << database << ";";

    if (useWindowsAuth) {
        ss << "Trusted_Connection=yes;";
    } else {
        ss << "Uid=" << username << ";";
        ss << "Pwd=" << password << ";";
    }

    return ss.str();
}

std::string IPCHandler::handleConnect(const std::string& params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string server = std::string(doc["server"].get_string().value());
        std::string database = std::string(doc["database"].get_string().value());

        std::string username;
        auto username_result = doc["username"].get_string();
        if (!username_result.error()) {
            username = std::string(username_result.value());
        }

        std::string password;
        auto password_result = doc["password"].get_string();
        if (!password_result.error()) {
            password = std::string(password_result.value());
        }

        bool useWindowsAuth = true;
        auto auth_result = doc["useWindowsAuth"].get_bool();
        if (!auth_result.error()) {
            useWindowsAuth = auth_result.value();
        }

        std::string connStr = buildConnectionString(server, database, username, password, useWindowsAuth);

        auto driver = std::make_unique<SQLServerDriver>();
        if (!driver->connect(connStr)) {
            return JsonUtils::errorResponse("Connection failed: " + driver->getLastError());
        }

        std::string connectionId = "conn_" + std::to_string(m_nextConnectionId++);
        m_connections[connectionId] = std::move(driver);

        return JsonUtils::successResponse("{\"connectionId\":\"" + connectionId + "\"}");
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::handleDisconnect(const std::string& params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string connectionId = std::string(doc["connectionId"].get_string().value());

        auto it = m_connections.find(connectionId);
        if (it != m_connections.end()) {
            it->second->disconnect();
            m_connections.erase(it);
        }

        return JsonUtils::successResponse("{}");
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::handleTestConnection(const std::string& params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string server = std::string(doc["server"].get_string().value());
        std::string database = std::string(doc["database"].get_string().value());

        std::string username;
        auto username_result = doc["username"].get_string();
        if (!username_result.error()) {
            username = std::string(username_result.value());
        }

        std::string password;
        auto password_result = doc["password"].get_string();
        if (!password_result.error()) {
            password = std::string(password_result.value());
        }

        bool useWindowsAuth = true;
        auto auth_result = doc["useWindowsAuth"].get_bool();
        if (!auth_result.error()) {
            useWindowsAuth = auth_result.value();
        }

        std::string connStr = buildConnectionString(server, database, username, password, useWindowsAuth);

        SQLServerDriver driver;
        if (driver.connect(connStr)) {
            driver.disconnect();
            return JsonUtils::successResponse("{\"success\":true,\"message\":\"Connection successful\"}");
        } else {
            return JsonUtils::successResponse("{\"success\":false,\"message\":\"" +
                JsonUtils::escapeString(driver.getLastError()) + "\"}");
        }
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::handleExecuteQuery(const std::string& params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string sql = std::string(doc["sql"].get_string().value());

        auto it = m_connections.find(connectionId);
        if (it == m_connections.end()) {
            return JsonUtils::errorResponse("Connection not found: " + connectionId);
        }

        auto& driver = it->second;
        ResultSet result = driver->execute(sql);

        // Build JSON response
        std::ostringstream json;
        json << "{";

        // Columns
        json << "\"columns\":[";
        for (size_t i = 0; i < result.columns.size(); ++i) {
            if (i > 0) json << ",";
            json << "{\"name\":\"" << JsonUtils::escapeString(result.columns[i].name) << "\","
                 << "\"type\":\"" << result.columns[i].type << "\"}";
        }
        json << "],";

        // Rows
        json << "\"rows\":[";
        for (size_t i = 0; i < result.rows.size(); ++i) {
            if (i > 0) json << ",";
            json << "[";
            for (size_t j = 0; j < result.rows[i].values.size(); ++j) {
                if (j > 0) json << ",";
                json << "\"" << JsonUtils::escapeString(result.rows[i].values[j]) << "\"";
            }
            json << "]";
        }
        json << "],";

        // Metadata
        json << "\"affectedRows\":" << result.affectedRows << ",";
        json << "\"executionTimeMs\":" << result.executionTimeMs;
        json << "}";

        // Add to history
        HistoryItem historyItem;
        historyItem.id = "hist_" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count());
        historyItem.sql = sql;
        historyItem.executionTimeMs = result.executionTimeMs;
        historyItem.success = true;
        historyItem.affectedRows = static_cast<int>(result.affectedRows);
        historyItem.isFavorite = false;
        m_queryHistory->add(historyItem);

        return JsonUtils::successResponse(json.str());
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::handleGetTables(const std::string& params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string connectionId = std::string(doc["connectionId"].get_string().value());

        auto it = m_connections.find(connectionId);
        if (it == m_connections.end()) {
            return JsonUtils::errorResponse("Connection not found: " + connectionId);
        }

        auto& driver = it->second;

        // Query for tables
        std::string sql = R"(
            SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
            FROM INFORMATION_SCHEMA.TABLES
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        )";

        ResultSet result = driver->execute(sql);

        std::ostringstream json;
        json << "[";
        for (size_t i = 0; i < result.rows.size(); ++i) {
            if (i > 0) json << ",";
            json << "{\"schema\":\"" << JsonUtils::escapeString(result.rows[i].values[0]) << "\","
                 << "\"name\":\"" << JsonUtils::escapeString(result.rows[i].values[1]) << "\","
                 << "\"type\":\"" << JsonUtils::escapeString(result.rows[i].values[2]) << "\"}";
        }
        json << "]";

        return JsonUtils::successResponse(json.str());
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::handleGetColumns(const std::string& params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string connectionId = std::string(doc["connectionId"].get_string().value());
        std::string table = std::string(doc["table"].get_string().value());

        auto it = m_connections.find(connectionId);
        if (it == m_connections.end()) {
            return JsonUtils::errorResponse("Connection not found: " + connectionId);
        }

        auto& driver = it->second;

        std::string sql = R"(
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
            WHERE c.TABLE_NAME = ')" + table + R"('
            ORDER BY c.ORDINAL_POSITION
        )";

        ResultSet result = driver->execute(sql);

        std::ostringstream json;
        json << "[";
        for (size_t i = 0; i < result.rows.size(); ++i) {
            if (i > 0) json << ",";
            json << "{\"name\":\"" << JsonUtils::escapeString(result.rows[i].values[0]) << "\","
                 << "\"type\":\"" << JsonUtils::escapeString(result.rows[i].values[1]) << "\","
                 << "\"size\":" << result.rows[i].values[2] << ","
                 << "\"nullable\":" << (result.rows[i].values[3] == "1" ? "true" : "false") << ","
                 << "\"isPrimaryKey\":" << (result.rows[i].values[4] == "1" ? "true" : "false") << "}";
        }
        json << "]";

        return JsonUtils::successResponse(json.str());
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::handleGetDatabases(const std::string& params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        std::string connectionId = std::string(doc["connectionId"].get_string().value());

        auto it = m_connections.find(connectionId);
        if (it == m_connections.end()) {
            return JsonUtils::errorResponse("Connection not found: " + connectionId);
        }

        auto& driver = it->second;

        std::string sql = "SELECT name FROM sys.databases ORDER BY name";
        ResultSet result = driver->execute(sql);

        std::ostringstream json;
        json << "[";
        for (size_t i = 0; i < result.rows.size(); ++i) {
            if (i > 0) json << ",";
            json << "\"" << JsonUtils::escapeString(result.rows[i].values[0]) << "\"";
        }
        json << "]";

        return JsonUtils::successResponse(json.str());
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::handleBeginTransaction(const std::string& params) {
    m_transactionManager->begin();
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleCommit(const std::string& params) {
    m_transactionManager->commit();
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleRollback(const std::string& params) {
    m_transactionManager->rollback();
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleExportCSV(const std::string& params) {
    // TODO: Implement CSV export
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleExportJSON(const std::string& params) {
    // TODO: Implement JSON export
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleExportExcel(const std::string& params) {
    // TODO: Implement Excel export
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleFormatSQL(const std::string& params) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(params);

        auto sql_result = doc["sql"].get_string();
        if (sql_result.error()) {
            return JsonUtils::errorResponse("Missing sql field");
        }
        std::string sql = std::string(sql_result.value());

        SQLFormatter::FormatOptions options;
        auto formatted = m_sqlFormatter->format(sql, options);
        return JsonUtils::successResponse("{\"sql\":\"" + JsonUtils::escapeString(formatted) + "\"}");
    }
    catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IPCHandler::handleParseA5ER(const std::string& params) {
    // TODO: Implement A5:ER parsing
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleGetQueryHistory(const std::string& params) {
    auto history = m_queryHistory->getAll();

    std::ostringstream json;
    json << "[";
    for (size_t i = 0; i < history.size(); ++i) {
        if (i > 0) json << ",";
        json << "{\"id\":\"" << history[i].id << "\","
             << "\"sql\":\"" << JsonUtils::escapeString(history[i].sql) << "\","
             << "\"executionTimeMs\":" << history[i].executionTimeMs << ","
             << "\"success\":" << (history[i].success ? "true" : "false") << ","
             << "\"affectedRows\":" << history[i].affectedRows << ","
             << "\"isFavorite\":" << (history[i].isFavorite ? "true" : "false") << "}";
    }
    json << "]";

    return JsonUtils::successResponse(json.str());
}

}  // namespace predategrip
