#pragma once

namespace velocitydb {

class IConnectionProvider;
class IQueryProvider;
class IAsyncQueryProvider;
class ISchemaProvider;
class ITransactionProvider;
class IExportProvider;
class ISearchProvider;
class IUtilityProvider;
class ISettingsProvider;
class IIOProvider;
class ILintProvider;

/// Top-level interface aggregating all provider interfaces
class ISystemContext {
public:
    virtual ~ISystemContext() = default;

    [[nodiscard]] virtual IConnectionProvider& connections() noexcept = 0;
    [[nodiscard]] virtual IQueryProvider& queries() noexcept = 0;
    [[nodiscard]] virtual IAsyncQueryProvider& async_queries() noexcept = 0;
    [[nodiscard]] virtual ISchemaProvider& schema() noexcept = 0;
    [[nodiscard]] virtual ITransactionProvider& transactions() noexcept = 0;
    [[nodiscard]] virtual IExportProvider& exports() noexcept = 0;
    [[nodiscard]] virtual ISearchProvider& search() noexcept = 0;
    [[nodiscard]] virtual IUtilityProvider& utility() noexcept = 0;
    [[nodiscard]] virtual ISettingsProvider& settings() noexcept = 0;
    [[nodiscard]] virtual IIOProvider& io() noexcept = 0;
    [[nodiscard]] virtual ILintProvider& lint() noexcept = 0;
};

}  // namespace velocitydb
