#include "system_context.h"

#include "../accessors/session_accessor.h"
#include "../accessors/settings_accessor.h"
#include "../database/query_history.h"
#include "../providers/async_query_provider.h"
#include "../providers/connection_provider.h"
#include "../providers/export_provider.h"
#include "../providers/io_provider.h"
#include "../providers/lint_provider.h"
#include "../providers/query_provider.h"
#include "../providers/schema_provider.h"
#include "../providers/search_provider.h"
#include "../providers/settings_provider.h"
#include "../providers/transaction_provider.h"
#include "../providers/utility_provider.h"

#include <algorithm>

namespace velocitydb {

namespace {

[[nodiscard]] std::unique_ptr<QueryHistory> makeQueryHistory(const SettingsAccessor& settingsAccessor) {
    // 設定ファイル破損時の防御: maxQueryHistory が 0 や負値だった場合は最低 1 件にクランプして
    // QueryHistory が常に有効状態で動作するようにする。
    const auto maxItems = static_cast<size_t>(std::max(1, settingsAccessor.getSettings().general.maxQueryHistory));
    return std::make_unique<QueryHistory>(maxItems);
}

}  // namespace

SystemContext::SystemContext() {
    // accessor の load は SystemContext で先行実施する: QueryHistory が settings.general.maxQueryHistory を
    // 構築時に必要とし、その値は SettingsAccessor を load 済みでなければ取得できないため。
    auto settingsAccessor = std::make_unique<SettingsAccessor>();
    (void)settingsAccessor->load();
    auto sessionAccessor = std::make_unique<SessionAccessor>();
    (void)sessionAccessor->load();

    m_connections = std::make_unique<ConnectionProvider>();
    m_queryHistory = makeQueryHistory(*settingsAccessor);
    m_settings = std::make_unique<SettingsProvider>(std::move(settingsAccessor), std::move(sessionAccessor), m_connections.get(), *m_queryHistory);
    m_queries = std::make_unique<QueryProvider>(*m_connections, *m_queryHistory);
    m_asyncQueries = std::make_unique<AsyncQueryProvider>(*m_connections, *m_queryHistory);
    m_schema = std::make_unique<SchemaProvider>(*m_connections);
    m_transactions = std::make_unique<TransactionProvider>(*m_connections);
    m_exports = std::make_unique<ExportProvider>(*m_connections);
    m_search = std::make_unique<SearchProvider>(*m_connections);
    m_utility = std::make_unique<UtilityProvider>();
    m_io = std::make_unique<IOProvider>();
    m_lint = std::make_unique<LintProvider>();
}

SystemContext::~SystemContext() = default;

IConnectionProvider& SystemContext::connections() noexcept {
    return *m_connections;
}
IQueryProvider& SystemContext::queries() noexcept {
    return *m_queries;
}
IAsyncQueryProvider& SystemContext::async_queries() noexcept {
    return *m_asyncQueries;
}
ISchemaProvider& SystemContext::schema() noexcept {
    return *m_schema;
}
ITransactionProvider& SystemContext::transactions() noexcept {
    return *m_transactions;
}
IExportProvider& SystemContext::exports() noexcept {
    return *m_exports;
}
ISearchProvider& SystemContext::search() noexcept {
    return *m_search;
}
IUtilityProvider& SystemContext::utility() noexcept {
    return *m_utility;
}
ISettingsProvider& SystemContext::settings() noexcept {
    return *m_settings;
}
IIOProvider& SystemContext::io() noexcept {
    return *m_io;
}
ILintProvider& SystemContext::lint() noexcept {
    return *m_lint;
}

}  // namespace velocitydb
