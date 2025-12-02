#pragma once

#include <string>
#include <memory>
#include <functional>
#include <unordered_map>

namespace predategrip {

class SQLServerDriver;
class ConnectionPool;
class SchemaInspector;
class TransactionManager;
class QueryHistory;
class DataExporter;
class A5ERParser;
class SQLFormatter;

class IPCHandler {
public:
    IPCHandler();
    ~IPCHandler();

    IPCHandler(const IPCHandler&) = delete;
    IPCHandler& operator=(const IPCHandler&) = delete;

    std::string handle(const std::string& request);

private:
    void registerHandlers();

    // Handler methods
    std::string handleConnect(const std::string& params);
    std::string handleDisconnect(const std::string& params);
    std::string handleTestConnection(const std::string& params);
    std::string handleExecuteQuery(const std::string& params);
    std::string handleGetTables(const std::string& params);
    std::string handleGetColumns(const std::string& params);
    std::string handleGetDatabases(const std::string& params);
    std::string handleBeginTransaction(const std::string& params);
    std::string handleCommit(const std::string& params);
    std::string handleRollback(const std::string& params);
    std::string handleExportCSV(const std::string& params);
    std::string handleExportJSON(const std::string& params);
    std::string handleExportExcel(const std::string& params);
    std::string handleFormatSQL(const std::string& params);
    std::string handleParseA5ER(const std::string& params);
    std::string handleGetQueryHistory(const std::string& params);

    using Handler = std::function<std::string(const std::string&)>;
    std::unordered_map<std::string, Handler> m_handlers;

    std::unique_ptr<ConnectionPool> m_connectionPool;
    std::unique_ptr<SchemaInspector> m_schemaInspector;
    std::unique_ptr<TransactionManager> m_transactionManager;
    std::unique_ptr<QueryHistory> m_queryHistory;
    std::unique_ptr<SQLFormatter> m_sqlFormatter;
    std::unique_ptr<A5ERParser> m_a5erParser;

    // Active connections
    std::unordered_map<std::string, std::unique_ptr<SQLServerDriver>> m_connections;
    int m_nextConnectionId = 1;
};

}  // namespace predategrip
