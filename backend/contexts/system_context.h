#pragma once

#include "../interfaces/system_context.h"

#include <memory>

namespace velocitydb {

class QueryHistory;

/// Concrete implementation of ISystemContext, owning all provider instances.
class SystemContext : public ISystemContext {
public:
    SystemContext();
    ~SystemContext() override;

    SystemContext(const SystemContext&) = delete;
    SystemContext& operator=(const SystemContext&) = delete;
    SystemContext(SystemContext&&) = delete;
    SystemContext& operator=(SystemContext&&) = delete;

    [[nodiscard]] IConnectionProvider& connections() noexcept override;
    [[nodiscard]] IQueryProvider& queries() noexcept override;
    [[nodiscard]] IAsyncQueryProvider& async_queries() noexcept override;
    [[nodiscard]] ISchemaProvider& schema() noexcept override;
    [[nodiscard]] ITransactionProvider& transactions() noexcept override;
    [[nodiscard]] IExportProvider& exports() noexcept override;
    [[nodiscard]] ISearchProvider& search() noexcept override;
    [[nodiscard]] IUtilityProvider& utility() noexcept override;
    [[nodiscard]] ISettingsProvider& settings() noexcept override;
    [[nodiscard]] IIOProvider& io() noexcept override;

private:
    std::unique_ptr<IConnectionProvider> m_connections;
    std::unique_ptr<QueryHistory> m_queryHistory;
    std::unique_ptr<IQueryProvider> m_queries;
    std::unique_ptr<IAsyncQueryProvider> m_asyncQueries;
    std::unique_ptr<ISchemaProvider> m_schema;
    std::unique_ptr<ITransactionProvider> m_transactions;
    std::unique_ptr<IExportProvider> m_exports;
    std::unique_ptr<ISearchProvider> m_search;
    std::unique_ptr<IUtilityProvider> m_utility;
    std::unique_ptr<ISettingsProvider> m_settings;
    std::unique_ptr<IIOProvider> m_io;
};

}  // namespace velocitydb
