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
class ResultCache;

/// Provider for asynchronous query execution
class AsyncQueryProvider : public IAsyncQueryProvider {
public:
    /// resultCache は QueryProvider と共有される (#511)。nullptr の場合キャッシュ無効 (テスト用)
    AsyncQueryProvider(IConnectionProvider& connections, QueryHistory& queryHistory, std::shared_ptr<ResultCache> resultCache = nullptr);
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
        std::string cacheKey;      // 空でなければ完了時に結果をキャッシュへ格納する (#511)
        bool skipHistory = false;  // キャッシュヒット由来の完了は履歴に記録しない (同期経路と整合)
    };

    IConnectionProvider& m_connections;
    QueryHistory& m_queryHistory;
    std::shared_ptr<ResultCache> m_resultCache;
    std::unique_ptr<AsyncQueryExecutor> m_asyncExecutor;
    // Accessed only from WebView2 UI thread (IPC calls are serialized). No mutex needed.
    std::unordered_map<std::string, QueryMeta> m_queryMeta;
};

}  // namespace velocitydb
