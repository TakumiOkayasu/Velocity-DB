#pragma once

#include <expected>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
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

/// Dispatches IPC requests from the frontend to appropriate backend operations
class IPCHandler {
public:
    IPCHandler();
    ~IPCHandler();

    IPCHandler(const IPCHandler&) = delete;
    IPCHandler& operator=(const IPCHandler&) = delete;
    IPCHandler(IPCHandler&&) = delete;
    IPCHandler& operator=(IPCHandler&&) = delete;

    /// Parses and dispatches an IPC request, returning a JSON response
    [[nodiscard]] std::string dispatchRequest(std::string_view request);

private:
    void registerRequestRoutes();

    using RequestProcessor = std::function<std::string(std::string_view)>;
    std::unordered_map<std::string, RequestProcessor> m_requestRoutes;

    // Database connection operations
    [[nodiscard]] std::string openDatabaseConnection(std::string_view params);
    [[nodiscard]] std::string closeDatabaseConnection(std::string_view params);
    [[nodiscard]] std::string verifyDatabaseConnection(std::string_view params);

    // Query execution operations
    [[nodiscard]] std::string executeSQL(std::string_view params);
    [[nodiscard]] std::string cancelRunningQuery(std::string_view params);

    // Schema retrieval operations
    [[nodiscard]] std::string fetchTableList(std::string_view params);
    [[nodiscard]] std::string fetchColumnDefinitions(std::string_view params);
    [[nodiscard]] std::string fetchDatabaseList(std::string_view params);

    // Transaction control operations
    [[nodiscard]] std::string startTransaction(std::string_view params);
    [[nodiscard]] std::string commitTransaction(std::string_view params);
    [[nodiscard]] std::string rollbackTransaction(std::string_view params);

    // Export operations
    [[nodiscard]] std::string exportToCSV(std::string_view params);
    [[nodiscard]] std::string exportToJSON(std::string_view params);
    [[nodiscard]] std::string exportToExcel(std::string_view params);

    // Utility operations
    [[nodiscard]] std::string formatSQLQuery(std::string_view params);
    [[nodiscard]] std::string parseA5ERFile(std::string_view params);
    [[nodiscard]] std::string retrieveQueryHistory(std::string_view params);

    std::unique_ptr<ConnectionPool> m_connectionPool;
    std::unique_ptr<SchemaInspector> m_schemaInspector;
    std::unique_ptr<TransactionManager> m_transactionManager;
    std::unique_ptr<QueryHistory> m_queryHistory;
    std::unique_ptr<SQLFormatter> m_sqlFormatter;
    std::unique_ptr<A5ERParser> m_a5erParser;

    std::unordered_map<std::string, std::unique_ptr<SQLServerDriver>> m_activeConnections;
    int m_connectionIdCounter = 1;
};

}  // namespace predategrip
