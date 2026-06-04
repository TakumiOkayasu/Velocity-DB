#include "ipc_handler.h"

#include "database/profile_gate.h"
#include "interfaces/providers/async_query_provider.h"
#include "interfaces/providers/connection_provider.h"
#include "interfaces/providers/export_provider.h"
#include "interfaces/providers/io_provider.h"
#include "interfaces/providers/lint_provider.h"
#include "interfaces/providers/query_provider.h"
#include "interfaces/providers/schema_provider.h"
#include "interfaces/providers/search_provider.h"
#include "interfaces/providers/settings_provider.h"
#include "interfaces/providers/transaction_provider.h"
#include "interfaces/providers/utility_provider.h"
#include "interfaces/system_context.h"
#include "simdjson.h"
#include "utils/json_utils.h"

#include <chrono>
#include <format>

namespace velocitydb {

/// Env var name as a NUL-terminated literal with external linkage, so it can be
/// passed as a template NTTP to profile::isEnabledOnce without relying on the
/// C++20 P1907 relaxation for internal-linkage pointer NTTPs.
/// Set VELOCITYDB_IPC_PROFILE to a non-empty, non-"0" value to log per-handler
/// dispatch timing to log/backend.log. Default OFF: zero hot-path overhead.
inline constexpr char kIpcProfileEnv[] = "VELOCITYDB_IPC_PROFILE";

IPCHandler::IPCHandler(ISystemContext& ctx) : m_ctx(ctx) {
    registerRoutes();
}

IPCHandler::~IPCHandler() = default;

void IPCHandler::registerRoutes() {
    // Connection lifecycle
    m_routes["connectAsync"] = [this](auto p) { return m_ctx.connections().connectAsync(p); };
    m_routes["getConnectResult"] = [this](auto p) { return m_ctx.connections().getConnectResult(p); };
    m_routes["cancelConnect"] = [this](auto p) { return m_ctx.connections().cancelConnect(p); };
    m_routes["disconnect"] = [this](auto p) {
        m_ctx.transactions().cleanupConnection(p);
        return m_ctx.connections().disconnect(p);
    };
    m_routes["testConnection"] = [this](auto p) { return m_ctx.connections().testConnection(p); };

    // Query execution
    m_routes["executeQuery"] = [this](auto p) { return m_ctx.queries().executeQuery(p); };
    m_routes["executeQueryPaginated"] = [this](auto p) { return m_ctx.queries().executeQueryPaginated(p); };
    m_routes["getRowCount"] = [this](auto p) { return m_ctx.queries().getRowCount(p); };
    m_routes["cancelQuery"] = [this](auto p) { return m_ctx.queries().cancelQuery(p); };

    // Async queries
    m_routes["executeAsyncQuery"] = [this](auto p) { return m_ctx.async_queries().executeAsyncQuery(p); };
    m_routes["getAsyncQueryResult"] = [this](auto p) { return m_ctx.async_queries().getAsyncQueryResult(p); };
    m_routes["cancelAsyncQuery"] = [this](auto p) { return m_ctx.async_queries().cancelAsyncQuery(p); };
    m_routes["getActiveQueries"] = [this](auto p) { return m_ctx.async_queries().getActiveQueries(p); };
    m_routes["removeAsyncQuery"] = [this](auto p) { return m_ctx.async_queries().removeAsyncQuery(p); };

    // Schema
    m_routes["getDatabases"] = [this](auto p) { return m_ctx.schema().getDatabases(p); };
    m_routes["getTables"] = [this](auto p) { return m_ctx.schema().getTables(p); };
    m_routes["getColumns"] = [this](auto p) { return m_ctx.schema().getColumns(p); };
    m_routes["getIndexes"] = [this](auto p) { return m_ctx.schema().getIndexes(p); };
    m_routes["getConstraints"] = [this](auto p) { return m_ctx.schema().getConstraints(p); };
    m_routes["getForeignKeys"] = [this](auto p) { return m_ctx.schema().getForeignKeys(p); };
    m_routes["getReferencingForeignKeys"] = [this](auto p) { return m_ctx.schema().getReferencingForeignKeys(p); };
    m_routes["getTriggers"] = [this](auto p) { return m_ctx.schema().getTriggers(p); };
    m_routes["getTableMetadata"] = [this](auto p) { return m_ctx.schema().getTableMetadata(p); };
    m_routes["getTableDDL"] = [this](auto p) { return m_ctx.schema().getTableDDL(p); };
    m_routes["getExecutionPlan"] = [this](auto p) { return m_ctx.schema().getExecutionPlan(p); };
    m_routes["clearSchemaCache"] = [this](auto p) { return m_ctx.schema().clearSchemaCache(p); };

    // Transactions
    m_routes["beginTransaction"] = [this](auto p) { return m_ctx.transactions().beginTransaction(p); };
    m_routes["commit"] = [this](auto p) { return m_ctx.transactions().commitTransaction(p); };
    m_routes["rollback"] = [this](auto p) { return m_ctx.transactions().rollbackTransaction(p); };

    // Cache & History
    m_routes["getCacheStats"] = [this](auto p) { return m_ctx.queries().getCacheStats(p); };
    m_routes["clearCache"] = [this](auto p) { return m_ctx.queries().clearCache(p); };
    m_routes["getQueryHistory"] = [this](auto p) { return m_ctx.queries().getQueryHistory(p); };
    m_routes["removeQueryHistory"] = [this](auto p) { return m_ctx.queries().removeQueryHistory(p); };
    m_routes["clearQueryHistory"] = [this](auto p) { return m_ctx.queries().clearQueryHistory(p); };
    m_routes["setQueryHistoryFavorite"] = [this](auto p) { return m_ctx.queries().setQueryHistoryFavorite(p); };

    // Filter
    m_routes["filterResultSet"] = [this](auto p) { return m_ctx.queries().filterResultSet(p); };

    // SQL builder (dialect-aware)
    m_routes["buildDataViewSql"] = [this](auto p) { return m_ctx.queries().buildDataViewSql(p); };
    m_routes["buildWhereClause"] = [this](auto p) { return m_ctx.queries().buildWhereClause(p); };
    m_routes["buildDmlStatements"] = [this](auto p) { return m_ctx.queries().buildDmlStatements(p); };

    // Export
    m_routes["exportCSV"] = [this](auto p) { return m_ctx.exports().exportCSV(p); };
    m_routes["exportJSON"] = [this](auto p) { return m_ctx.exports().exportJSON(p); };
    m_routes["exportExcel"] = [this](auto p) { return m_ctx.exports().exportExcel(p); };

    // Utility
    m_routes["uppercaseKeywords"] = [this](auto p) { return m_ctx.utility().uppercaseKeywords(p); };
    m_routes["parseERDiagram"] = [this](auto p) { return m_ctx.utility().parseERDiagram(p); };

    // Search
    m_routes["searchObjects"] = [this](auto p) { return m_ctx.search().searchObjects(p); };
    m_routes["quickSearch"] = [this](auto p) { return m_ctx.search().quickSearch(p); };

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
    m_routes["writeFrontendLog"] = [this](auto p) { return m_ctx.io().writeFrontendLog(p); };
    m_routes["saveQueryToFile"] = [this](auto p) { return m_ctx.io().saveQueryToFile(p); };
    m_routes["loadQueryFromFile"] = [this](auto p) { return m_ctx.io().loadQueryFromFile(p); };
    m_routes["browseFile"] = [this](auto p) { return m_ctx.io().browseFile(p); };
    m_routes["getBookmarks"] = [this](auto p) { return m_ctx.io().getBookmarks(p); };
    m_routes["saveBookmark"] = [this](auto p) { return m_ctx.io().saveBookmark(p); };
    m_routes["deleteBookmark"] = [this](auto p) { return m_ctx.io().deleteBookmark(p); };

    // Lint (static SQL check via sqruff)
    m_routes["lintSql"] = [this](auto p) { return m_ctx.lint().lintSql(p); };
}

std::string IPCHandler::dispatchRequest(std::string_view request) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(request);

        auto methodResult = doc["method"].get_string();
        if (methodResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing method field");
        }
        auto method = methodResult.value();

        std::string_view params;
        if (auto paramsResult = doc["params"].get_string(); !paramsResult.error()) {
            params = paramsResult.value();
        }

        if (auto route = m_routes.find(method); route != m_routes.end()) [[likely]] {
            if (!profile::isEnabledOnce<kIpcProfileEnv>()) [[likely]] {
                return route->second(params);
            }
            const auto dispatchStart = std::chrono::steady_clock::now();
            auto response = route->second(params);
            const auto elapsedUs = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - dispatchStart).count();
            profile::emit("[ipc-prof] method={} {:.3f}ms", method, static_cast<double>(elapsedUs) / 1000.0);
            return response;
        }

        return JsonUtils::errorResponse(std::format("Unknown method: {}", method));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
