#include "ipc_handler.h"

#include "interfaces/providers/async_query_provider.h"
#include "interfaces/providers/connection_provider.h"
#include "interfaces/providers/export_provider.h"
#include "interfaces/providers/io_provider.h"
#include "interfaces/providers/query_provider.h"
#include "interfaces/providers/schema_provider.h"
#include "interfaces/providers/search_provider.h"
#include "interfaces/providers/settings_provider.h"
#include "interfaces/providers/transaction_provider.h"
#include "interfaces/providers/utility_provider.h"
#include "interfaces/system_context.h"
#include "simdjson.h"
#include "utils/json_utils.h"

#include <format>

namespace velocitydb {

IPCHandler::IPCHandler(ISystemContext& ctx) : m_ctx(ctx) {
    registerRoutes();
}

IPCHandler::~IPCHandler() = default;

void IPCHandler::registerRoutes() {
    // Connection lifecycle
    m_routes["connectAsync"] = [this](auto p) { return m_ctx.connections().handleConnectAsync(p); };
    m_routes["getConnectResult"] = [this](auto p) { return m_ctx.connections().handleGetConnectResult(p); };
    m_routes["cancelConnect"] = [this](auto p) { return m_ctx.connections().handleCancelConnect(p); };
    m_routes["disconnect"] = [this](auto p) {
        m_ctx.transactions().cleanupConnection(p);
        return m_ctx.connections().handleDisconnect(p);
    };
    m_routes["testConnection"] = [this](auto p) { return m_ctx.connections().handleTestConnection(p); };

    // Query execution
    m_routes["executeQuery"] = [this](auto p) { return m_ctx.queries().handleExecuteQuery(p); };
    m_routes["executeQueryPaginated"] = [this](auto p) { return m_ctx.queries().handleExecuteQueryPaginated(p); };
    m_routes["getRowCount"] = [this](auto p) { return m_ctx.queries().handleGetRowCount(p); };
    m_routes["cancelQuery"] = [this](auto p) { return m_ctx.queries().handleCancelQuery(p); };

    // Async queries
    m_routes["executeAsyncQuery"] = [this](auto p) { return m_ctx.async_queries().handleExecuteAsyncQuery(p); };
    m_routes["getAsyncQueryResult"] = [this](auto p) { return m_ctx.async_queries().handleGetAsyncQueryResult(p); };
    m_routes["cancelAsyncQuery"] = [this](auto p) { return m_ctx.async_queries().handleCancelAsyncQuery(p); };
    m_routes["getActiveQueries"] = [this](auto p) { return m_ctx.async_queries().handleGetActiveQueries(p); };
    m_routes["removeAsyncQuery"] = [this](auto p) { return m_ctx.async_queries().handleRemoveAsyncQuery(p); };

    // Schema
    m_routes["getDatabases"] = [this](auto p) { return m_ctx.schema().handleGetDatabases(p); };
    m_routes["getTables"] = [this](auto p) { return m_ctx.schema().handleGetTables(p); };
    m_routes["getColumns"] = [this](auto p) { return m_ctx.schema().handleGetColumns(p); };
    m_routes["getIndexes"] = [this](auto p) { return m_ctx.schema().handleGetIndexes(p); };
    m_routes["getConstraints"] = [this](auto p) { return m_ctx.schema().handleGetConstraints(p); };
    m_routes["getForeignKeys"] = [this](auto p) { return m_ctx.schema().handleGetForeignKeys(p); };
    m_routes["getReferencingForeignKeys"] = [this](auto p) { return m_ctx.schema().handleGetReferencingForeignKeys(p); };
    m_routes["getTriggers"] = [this](auto p) { return m_ctx.schema().handleGetTriggers(p); };
    m_routes["getTableMetadata"] = [this](auto p) { return m_ctx.schema().handleGetTableMetadata(p); };
    m_routes["getTableDDL"] = [this](auto p) { return m_ctx.schema().handleGetTableDDL(p); };
    m_routes["getExecutionPlan"] = [this](auto p) { return m_ctx.schema().handleGetExecutionPlan(p); };

    // Transactions
    m_routes["beginTransaction"] = [this](auto p) { return m_ctx.transactions().handleBeginTransaction(p); };
    m_routes["commit"] = [this](auto p) { return m_ctx.transactions().handleCommitTransaction(p); };
    m_routes["rollback"] = [this](auto p) { return m_ctx.transactions().handleRollbackTransaction(p); };

    // Cache & History
    m_routes["getCacheStats"] = [this](auto p) { return m_ctx.queries().handleGetCacheStats(p); };
    m_routes["clearCache"] = [this](auto p) { return m_ctx.queries().handleClearCache(p); };
    m_routes["getQueryHistory"] = [this](auto p) { return m_ctx.queries().handleGetQueryHistory(p); };
    m_routes["removeQueryHistory"] = [this](auto p) { return m_ctx.queries().handleRemoveQueryHistory(p); };
    m_routes["clearQueryHistory"] = [this](auto p) { return m_ctx.queries().handleClearQueryHistory(p); };
    m_routes["setQueryHistoryFavorite"] = [this](auto p) { return m_ctx.queries().handleSetQueryHistoryFavorite(p); };

    // Filter
    m_routes["filterResultSet"] = [this](auto p) { return m_ctx.queries().handleFilterResultSet(p); };

    // SQL builder (dialect-aware)
    m_routes["buildDataViewSql"] = [this](auto p) { return m_ctx.queries().handleBuildDataViewSql(p); };
    m_routes["buildWhereClause"] = [this](auto p) { return m_ctx.queries().handleBuildWhereClause(p); };
    m_routes["buildDmlStatements"] = [this](auto p) { return m_ctx.queries().handleBuildDmlStatements(p); };

    // Export
    m_routes["exportCSV"] = [this](auto p) { return m_ctx.exports().handleExportCSV(p); };
    m_routes["exportJSON"] = [this](auto p) { return m_ctx.exports().handleExportJSON(p); };
    m_routes["exportExcel"] = [this](auto p) { return m_ctx.exports().handleExportExcel(p); };

    // Utility
    m_routes["uppercaseKeywords"] = [this](auto p) { return m_ctx.utility().uppercaseKeywords(p); };
    m_routes["parseERDiagram"] = [this](auto p) { return m_ctx.utility().parseERDiagram(p); };

    // Search
    m_routes["searchObjects"] = [this](auto p) { return m_ctx.search().handleSearchObjects(p); };
    m_routes["quickSearch"] = [this](auto p) { return m_ctx.search().handleQuickSearch(p); };

    // Settings
    m_routes["getSettings"] = [this](auto) { return m_ctx.settings().getSettings(); };
    m_routes["updateSettings"] = [this](auto p) { return m_ctx.settings().updateSettings(p); };
    m_routes["getConnectionProfiles"] = [this](auto) { return m_ctx.settings().getConnectionProfiles(); };
    m_routes["saveConnectionProfile"] = [this](auto p) { return m_ctx.settings().saveConnectionProfile(p); };
    m_routes["deleteConnectionProfile"] = [this](auto p) { return m_ctx.settings().deleteConnectionProfile(p); };
    m_routes["getProfilePassword"] = [this](auto p) { return m_ctx.settings().getProfilePassword(p); };
    m_routes["getSshPassword"] = [this](auto p) { return m_ctx.settings().getSshPassword(p); };
    m_routes["getSshKeyPassphrase"] = [this](auto p) { return m_ctx.settings().getSshKeyPassphrase(p); };
    m_routes["getSessionState"] = [this](auto) { return m_ctx.settings().getSessionState(); };
    m_routes["saveSessionState"] = [this](auto p) { return m_ctx.settings().saveSessionState(p); };

    // IO
    m_routes["writeFrontendLog"] = [this](auto p) { return m_ctx.io().handleWriteFrontendLog(p); };
    m_routes["saveQueryToFile"] = [this](auto p) { return m_ctx.io().handleSaveQueryToFile(p); };
    m_routes["loadQueryFromFile"] = [this](auto p) { return m_ctx.io().handleLoadQueryFromFile(p); };
    m_routes["browseFile"] = [this](auto p) { return m_ctx.io().handleBrowseFile(p); };
    m_routes["getBookmarks"] = [this](auto p) { return m_ctx.io().handleGetBookmarks(p); };
    m_routes["saveBookmark"] = [this](auto p) { return m_ctx.io().handleSaveBookmark(p); };
    m_routes["deleteBookmark"] = [this](auto p) { return m_ctx.io().handleDeleteBookmark(p); };
}

std::string IPCHandler::dispatchRequest(std::string_view request) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(request);

        auto methodResult = doc["method"].get_string();
        if (methodResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing method field");
        }
        auto method = methodResult.value();

        std::string params;
        if (auto paramsResult = doc["params"].get_string(); !paramsResult.error()) {
            params = std::string(paramsResult.value());
        }

        if (auto route = m_routes.find(std::string(method)); route != m_routes.end()) [[likely]] {
            return route->second(params);
        }

        return JsonUtils::errorResponse(std::format("Unknown method: {}", method));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
