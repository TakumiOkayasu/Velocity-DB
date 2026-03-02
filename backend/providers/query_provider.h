#pragma once

#include "../interfaces/providers/query_provider.h"

#include <memory>
#include <string>
#include <string_view>

namespace velocitydb {

class IConnectionProvider;
class ResultCache;
class QueryHistory;

/// Provider for query execution, cache, history, and filtering
class QueryProvider : public IQueryProvider {
public:
    QueryProvider(IConnectionProvider& connections, QueryHistory& queryHistory);
    ~QueryProvider() override;

    QueryProvider(const QueryProvider&) = delete;
    QueryProvider& operator=(const QueryProvider&) = delete;
    QueryProvider(QueryProvider&&) = delete;
    QueryProvider& operator=(QueryProvider&&) = delete;

    [[nodiscard]] std::string handleExecuteQuery(std::string_view params) override;
    [[nodiscard]] std::string handleExecuteQueryPaginated(std::string_view params) override;
    [[nodiscard]] std::string handleGetRowCount(std::string_view params) override;
    [[nodiscard]] std::string handleCancelQuery(std::string_view params) override;
    [[nodiscard]] std::string handleFilterResultSet(std::string_view params) override;
    [[nodiscard]] std::string handleGetCacheStats(std::string_view params) override;
    [[nodiscard]] std::string handleClearCache(std::string_view params) override;
    [[nodiscard]] std::string handleGetQueryHistory(std::string_view params) override;
    [[nodiscard]] std::string handleRemoveQueryHistory(std::string_view params) override;
    [[nodiscard]] std::string handleClearQueryHistory(std::string_view params) override;
    [[nodiscard]] std::string handleSetQueryHistoryFavorite(std::string_view params) override;

    // SQL builder (dialect-aware)
    [[nodiscard]] std::string handleBuildDataViewSql(std::string_view params) override;
    [[nodiscard]] std::string handleBuildWhereClause(std::string_view params) override;
    [[nodiscard]] std::string handleBuildDmlStatements(std::string_view params) override;

private:
    void recordHistory(const std::string& sql, const std::string& connectionId, double execTimeMs, bool success, std::string_view errorMsg = {}, int64_t affectedRows = 0);

    IConnectionProvider& m_connections;
    std::unique_ptr<ResultCache> m_resultCache;
    QueryHistory& m_queryHistory;
};

}  // namespace velocitydb
