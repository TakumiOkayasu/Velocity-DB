#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for query execution, cache, history, and filtering
class IQueryProvider {
public:
    virtual ~IQueryProvider() = default;

    [[nodiscard]] virtual std::string executeQuery(std::string_view params) = 0;
    [[nodiscard]] virtual std::string executeQueryPaginated(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getRowCount(std::string_view params) = 0;
    [[nodiscard]] virtual std::string cancelQuery(std::string_view params) = 0;
    [[nodiscard]] virtual std::string filterResultSet(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getCacheStats(std::string_view params) = 0;
    [[nodiscard]] virtual std::string clearCache(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string removeQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string clearQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string setQueryHistoryFavorite(std::string_view params) = 0;

    // SQL builder (dialect-aware)
    [[nodiscard]] virtual std::string buildDataViewSql(std::string_view params) = 0;
    [[nodiscard]] virtual std::string buildWhereClause(std::string_view params) = 0;
    [[nodiscard]] virtual std::string buildDmlStatements(std::string_view params) = 0;
};

}  // namespace velocitydb
