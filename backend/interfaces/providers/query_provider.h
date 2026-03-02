#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for query execution, cache, history, and filtering
class IQueryProvider {
public:
    virtual ~IQueryProvider() = default;

    [[nodiscard]] virtual std::string handleExecuteQuery(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleExecuteQueryPaginated(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleGetRowCount(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleCancelQuery(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleFilterResultSet(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleGetCacheStats(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleClearCache(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleGetQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleRemoveQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleClearQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleSetQueryHistoryFavorite(std::string_view params) = 0;

    // SQL builder (dialect-aware)
    [[nodiscard]] virtual std::string handleBuildDataViewSql(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleBuildWhereClause(std::string_view params) = 0;
    [[nodiscard]] virtual std::string handleBuildDmlStatements(std::string_view params) = 0;
};

}  // namespace velocitydb
