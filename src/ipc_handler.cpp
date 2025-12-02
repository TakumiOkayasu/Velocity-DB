#include "ipc_handler.h"
#include "database/connection_pool.h"
#include "database/schema_inspector.h"
#include "database/transaction_manager.h"
#include "database/query_history.h"
#include "parsers/sql_formatter.h"
#include "parsers/a5er_parser.h"
#include "utils/json_utils.h"
#include "simdjson.h"

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

std::string IPCHandler::handleConnect(const std::string& params) {
    // TODO: Implement connection logic
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleDisconnect(const std::string& params) {
    // TODO: Implement disconnect logic
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleExecuteQuery(const std::string& params) {
    // TODO: Implement query execution
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleGetTables(const std::string& params) {
    // TODO: Implement get tables
    return JsonUtils::successResponse("[]");
}

std::string IPCHandler::handleGetColumns(const std::string& params) {
    // TODO: Implement get columns
    return JsonUtils::successResponse("[]");
}

std::string IPCHandler::handleGetDatabases(const std::string& params) {
    // TODO: Implement get databases
    return JsonUtils::successResponse("[]");
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
    simdjson::dom::parser parser;
    simdjson::dom::element doc = parser.parse(params);
    std::string_view sql = doc["sql"].get_string();

    SQLFormatter::FormatOptions options;
    auto formatted = m_sqlFormatter->format(std::string(sql), options);
    return JsonUtils::successResponse("{\"sql\":\"" + formatted + "\"}");
}

std::string IPCHandler::handleParseA5ER(const std::string& params) {
    // TODO: Implement A5:ER parsing
    return JsonUtils::successResponse("{}");
}

std::string IPCHandler::handleGetQueryHistory(const std::string& params) {
    auto history = m_queryHistory->getAll();
    // TODO: Convert to JSON
    return JsonUtils::successResponse("[]");
}

}  // namespace predategrip
