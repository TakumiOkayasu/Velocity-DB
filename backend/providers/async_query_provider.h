#pragma once

#include "../interfaces/providers/async_query_provider.h"

#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>

namespace velocitydb {

class IConnectionProvider;
class AsyncQueryExecutor;
class QueryHistory;

/// Provider for asynchronous query execution
class AsyncQueryProvider : public IAsyncQueryProvider {
public:
    AsyncQueryProvider(IConnectionProvider& connections, QueryHistory& queryHistory);
    ~AsyncQueryProvider() override;

    AsyncQueryProvider(const AsyncQueryProvider&) = delete;
    AsyncQueryProvider& operator=(const AsyncQueryProvider&) = delete;
    AsyncQueryProvider(AsyncQueryProvider&&) = delete;
    AsyncQueryProvider& operator=(AsyncQueryProvider&&) = delete;

    [[nodiscard]] std::string executeAsyncQuery(std::string_view params) override;
    [[nodiscard]] std::string getAsyncQueryResult(std::string_view params) override;
    [[nodiscard]] std::string cancelAsyncQuery(std::string_view params) override;
    [[nodiscard]] std::string getActiveQueries(std::string_view params) override;
    [[nodiscard]] std::string removeAsyncQuery(std::string_view params) override;

private:
    struct QueryMeta {
        std::string connectionId;
        std::string sql;
    };

    IConnectionProvider& m_connections;
    QueryHistory& m_queryHistory;
    std::unique_ptr<AsyncQueryExecutor> m_asyncExecutor;
    // Accessed only from WebView2 UI thread (IPC calls are serialized). No mutex needed.
    std::unordered_map<std::string, QueryMeta> m_queryMeta;
};

}  // namespace velocitydb
