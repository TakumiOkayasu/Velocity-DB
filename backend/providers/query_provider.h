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

    [[nodiscard]] std::string executeQuery(std::string_view params) override;
    [[nodiscard]] std::string executeQueryPaginated(std::string_view params) override;
    [[nodiscard]] std::string getRowCount(std::string_view params) override;
    [[nodiscard]] std::string cancelQuery(std::string_view params) override;
    [[nodiscard]] std::string filterResultSet(std::string_view params) override;
    [[nodiscard]] std::string getCacheStats(std::string_view params) override;
    [[nodiscard]] std::string clearCache(std::string_view params) override;
    [[nodiscard]] std::string getQueryHistory(std::string_view params) override;
    [[nodiscard]] std::string removeQueryHistory(std::string_view params) override;
    [[nodiscard]] std::string clearQueryHistory(std::string_view params) override;
    [[nodiscard]] std::string setQueryHistoryFavorite(std::string_view params) override;

    // SQL builder (dialect-aware)
    [[nodiscard]] std::string buildDataViewSql(std::string_view params) override;
    [[nodiscard]] std::string buildWhereClause(std::string_view params) override;
    [[nodiscard]] std::string buildDmlStatements(std::string_view params) override;

private:
    void recordHistory(const std::string& sql, const std::string& connectionId, double execTimeMs, bool success, std::string_view errorMsg = {}, int64_t affectedRows = 0);

    IConnectionProvider& m_connections;
    std::unique_ptr<ResultCache> m_resultCache;
    QueryHistory& m_queryHistory;
};

}  // namespace velocitydb
