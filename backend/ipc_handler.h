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
class ResultCache;
class AsyncQueryExecutor;
class SIMDFilter;
class SettingsManager;
class SessionManager;
class GlobalSearch;
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
    [[nodiscard]] std::string executeSQLPaginated(std::string_view params);
    [[nodiscard]] std::string getRowCount(std::string_view params);
    [[nodiscard]] std::string cancelRunningQuery(std::string_view params);

    // Async query operations
    [[nodiscard]] std::string executeAsyncQuery(std::string_view params);
    [[nodiscard]] std::string getAsyncQueryResult(std::string_view params);
    [[nodiscard]] std::string cancelAsyncQuery(std::string_view params);
    [[nodiscard]] std::string getActiveQueries(std::string_view params);

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
    [[nodiscard]] std::string uppercaseKeywords(std::string_view params);
    [[nodiscard]] std::string parseA5ERFile(std::string_view params);
    [[nodiscard]] std::string retrieveQueryHistory(std::string_view params);
    [[nodiscard]] std::string getExecutionPlan(std::string_view params);
    [[nodiscard]] std::string writeFrontendLog(std::string_view params);

    // Cache operations
    [[nodiscard]] std::string getCacheStats(std::string_view params);
    [[nodiscard]] std::string clearCache(std::string_view params);

    // Filter operations
    [[nodiscard]] std::string filterResultSet(std::string_view params);

    // Settings operations
    [[nodiscard]] std::string getSettings(std::string_view params);
    [[nodiscard]] std::string updateSettings(std::string_view params);
    [[nodiscard]] std::string getConnectionProfiles(std::string_view params);
    [[nodiscard]] std::string saveConnectionProfile(std::string_view params);
    [[nodiscard]] std::string deleteConnectionProfile(std::string_view params);
    [[nodiscard]] std::string getProfilePassword(std::string_view params);

    // Session operations
    [[nodiscard]] std::string getSessionState(std::string_view params);
    [[nodiscard]] std::string saveSessionState(std::string_view params);

    // Search operations
    [[nodiscard]] std::string searchObjects(std::string_view params);
    [[nodiscard]] std::string quickSearch(std::string_view params);

    // Table metadata operations
    [[nodiscard]] std::string fetchIndexes(std::string_view params);
    [[nodiscard]] std::string fetchConstraints(std::string_view params);
    [[nodiscard]] std::string fetchForeignKeys(std::string_view params);
    [[nodiscard]] std::string fetchReferencingForeignKeys(std::string_view params);
    [[nodiscard]] std::string fetchTriggers(std::string_view params);
    [[nodiscard]] std::string fetchTableMetadata(std::string_view params);
    [[nodiscard]] std::string fetchTableDDL(std::string_view params);

    // File operations
    [[nodiscard]] std::string saveQueryToFile(std::string_view params);
    [[nodiscard]] std::string loadQueryFromFile(std::string_view params);

    // Bookmark operations
    [[nodiscard]] std::string getBookmarks(std::string_view params);
    [[nodiscard]] std::string saveBookmark(std::string_view params);
    [[nodiscard]] std::string deleteBookmark(std::string_view params);

    std::unique_ptr<ConnectionPool> m_connectionPool;
    std::unique_ptr<SchemaInspector> m_schemaInspector;
    std::unordered_map<std::string, std::unique_ptr<TransactionManager>> m_transactionManagers;
    std::unique_ptr<QueryHistory> m_queryHistory;
    std::unique_ptr<ResultCache> m_resultCache;
    std::unique_ptr<AsyncQueryExecutor> m_asyncExecutor;
    std::unique_ptr<SIMDFilter> m_simdFilter;
    std::unique_ptr<SettingsManager> m_settingsManager;
    std::unique_ptr<SessionManager> m_sessionManager;
    std::unique_ptr<GlobalSearch> m_globalSearch;
    std::unique_ptr<SQLFormatter> m_sqlFormatter;
    std::unique_ptr<A5ERParser> m_a5erParser;

    std::unordered_map<std::string, std::shared_ptr<SQLServerDriver>> m_activeConnections;
    int m_connectionIdCounter = 1;
};

}  // namespace predategrip
