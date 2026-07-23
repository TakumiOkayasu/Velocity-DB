#include "providers/async_query_provider.h"

#include "database/connection_types.h"
#include "database/driver_interface.h"
#include "database/query_history.h"
#include "database/result_cache.h"
#include "interfaces/providers/connection_provider.h"

#include <gmock/gmock.h>
#include <gtest/gtest.h>

#include <chrono>
#include <deque>
#include <format>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

using velocitydb::AsyncQueryProvider;
using velocitydb::DatabaseConnectionParams;
using velocitydb::DriverType;
using velocitydb::IConnectionProvider;
using velocitydb::IDatabaseDriver;
using velocitydb::QueryHistory;
using velocitydb::ResultCache;
using velocitydb::ResultRow;
using velocitydb::ResultSet;

// #511: 非同期クエリ経路と QueryProvider の ResultCache 共有の振る舞いを、実 DB なしで
// gmock 注入により検証する。ヒット時は driver->execute が呼ばれないこと、DML で接続単位
// 無効化されること、キャッシュヒットは履歴に記録されないことが不変条件。

namespace {

class MockDatabaseDriver : public IDatabaseDriver {
public:
    MOCK_METHOD(bool, connect, (std::string_view), (override));
    MOCK_METHOD(void, disconnect, (), (override));
    MOCK_METHOD(bool, isConnected, (), (const, noexcept, override));
    MOCK_METHOD(ResultSet, execute, (std::string_view), (override));
    MOCK_METHOD(void, cancel, (), (override));
    MOCK_METHOD(void, setQueryTimeout, (std::chrono::seconds), (override));
    MOCK_METHOD(std::chrono::seconds, queryTimeout, (), (const, noexcept, override));
    MOCK_METHOD(std::string, getLastError, (), (const, override));
    MOCK_METHOD(DriverType, getType, (), (const, noexcept, override));
};

class MockConnectionProvider : public IConnectionProvider {
public:
    MOCK_METHOD(std::string, connectAsync, (std::string_view), (override));
    MOCK_METHOD(std::string, getConnectResult, (std::string_view), (override));
    MOCK_METHOD(std::string, cancelConnect, (std::string_view), (override));
    MOCK_METHOD(std::string, disconnect, (std::string_view), (override));
    MOCK_METHOD(std::string, testConnection, (std::string_view), (override));
    MOCK_METHOD(std::shared_ptr<IDatabaseDriver>, getQueryDriver, (std::string_view), (override));
    MOCK_METHOD(std::shared_ptr<IDatabaseDriver>, getMetadataDriver, (std::string_view), (override));
    MOCK_METHOD(DriverType, getDriverType, (std::string_view), (const, override));
    MOCK_METHOD(std::optional<DatabaseConnectionParams>, getConnectionParams, (std::string_view), (const, override));
    MOCK_METHOD(void, setDefaultQueryTimeoutSeconds, (int), (override));
};

ResultSet makeSelectResult() {
    auto arena = std::make_shared<std::deque<std::string>>();
    arena->emplace_back("42");
    ResultSet rs;
    rs.columns.push_back({.name = "value", .type = "INT"});
    ResultRow row;
    row.values.emplace_back(arena->back());
    row.nullFlags.push_back(false);
    rs.rows.push_back(std::move(row));
    rs.storage = std::move(arena);
    return rs;
}

std::string extractQueryId(const std::string& response) {
    auto pos = response.find(R"("queryId":")");
    if (pos == std::string::npos)
        return {};
    pos += std::string_view(R"("queryId":")").size();
    auto end = response.find('"', pos);
    return response.substr(pos, end - pos);
}

}  // namespace

class AsyncQueryProviderCacheTest : public ::testing::Test {
protected:
    ::testing::NiceMock<MockConnectionProvider> connections;
    std::shared_ptr<::testing::NiceMock<MockDatabaseDriver>> driver = std::make_shared<::testing::NiceMock<MockDatabaseDriver>>();
    QueryHistory history{100};
    std::shared_ptr<ResultCache> cache = std::make_shared<ResultCache>();

    void SetUp() override {
        ON_CALL(connections, getQueryDriver(::testing::_)).WillByDefault(::testing::Return(driver));
        ON_CALL(connections, getDriverType(::testing::_)).WillByDefault(::testing::Return(DriverType::SQLServer));
        ON_CALL(*driver, getType()).WillByDefault(::testing::Return(DriverType::SQLServer));
    }

    // 提出 → 完了までポーリングして最終レスポンス JSON を返す
    std::string submitAndAwait(AsyncQueryProvider& provider, std::string_view sql) {
        auto submitRes = provider.executeAsyncQuery(std::format(R"({{"connectionId":"c1","sql":"{}"}})", sql));
        auto queryId = extractQueryId(submitRes);
        EXPECT_FALSE(queryId.empty()) << submitRes;
        for (int i = 0; i < 1000; ++i) {
            auto res = provider.getAsyncQueryResult(std::format(R"({{"queryId":"{}"}})", queryId));
            if (res.find(R"("status":"completed")") != std::string::npos || res.find(R"("status":"failed")") != std::string::npos || res.find(R"("status":"cancelled")") != std::string::npos) {
                return res;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        ADD_FAILURE() << "query did not reach terminal status";
        return {};
    }
};

// 同一 SELECT の 2 回目はキャッシュから返り、driver->execute は 1 回しか呼ばれない
TEST_F(AsyncQueryProviderCacheTest, SecondSelectServedFromSharedCache) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(makeSelectResult()));
    AsyncQueryProvider provider(connections, history, cache);

    auto first = submitAndAwait(provider, "SELECT 1");
    auto second = submitAndAwait(provider, "SELECT 1");

    EXPECT_NE(first.find(R"("status":"completed")"), std::string::npos);
    EXPECT_NE(second.find(R"("status":"completed")"), std::string::npos);
    EXPECT_NE(second.find("42"), std::string::npos);
    auto stats = cache->getStats();
    EXPECT_EQ(stats.putCount, 1u);
    EXPECT_GE(stats.hitCount, 1u);
}

// 末尾セミコロン・空白違いの同一クエリもキー正規化で同一エントリを共有する
TEST_F(AsyncQueryProviderCacheTest, NormalizedVariantsShareCacheEntry) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(makeSelectResult()));
    AsyncQueryProvider provider(connections, history, cache);

    (void)submitAndAwait(provider, "SELECT 1");
    auto second = submitAndAwait(provider, "SELECT 1;");
    auto third = submitAndAwait(provider, "  SELECT 1  ");

    EXPECT_NE(second.find("42"), std::string::npos);
    EXPECT_NE(third.find("42"), std::string::npos);
    EXPECT_EQ(cache->getStats().putCount, 1u);
}

// DML の提出で同一接続のキャッシュが無効化され、次の SELECT は再実行される
TEST_F(AsyncQueryProviderCacheTest, DmlSubmissionInvalidatesConnectionCache) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(3).WillRepeatedly(::testing::Invoke([](std::string_view) { return makeSelectResult(); }));
    AsyncQueryProvider provider(connections, history, cache);

    (void)submitAndAwait(provider, "SELECT 1");                      // miss → put
    (void)submitAndAwait(provider, "DELETE FROM t WHERE id = 1");    // 無効化 + 実行
    auto third = submitAndAwait(provider, "SELECT 1");               // 再実行 (キャッシュ消滅済)

    EXPECT_NE(third.find(R"("status":"completed")"), std::string::npos);
    // 無効化後の再実行分で put が 2 回になっている
    EXPECT_EQ(cache->getStats().putCount, 2u);
}

// キャッシュヒットは履歴に記録されない (同期経路 executeQuery と同じ振る舞い)
TEST_F(AsyncQueryProviderCacheTest, CacheHitDoesNotRecordHistory) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(makeSelectResult()));
    AsyncQueryProvider provider(connections, history, cache);

    (void)submitAndAwait(provider, "SELECT 1");
    (void)submitAndAwait(provider, "SELECT 1");

    EXPECT_EQ(history.getAll().size(), 1u);
}

// 複文はキャッシュ対象外 (put されない)
TEST_F(AsyncQueryProviderCacheTest, MultiStatementIsNotCached) {
    EXPECT_CALL(*driver, execute(::testing::_)).WillRepeatedly(::testing::Invoke([](std::string_view) { return makeSelectResult(); }));
    AsyncQueryProvider provider(connections, history, cache);

    (void)submitAndAwait(provider, "SELECT 1; SELECT 2");

    EXPECT_EQ(cache->getStats().putCount, 0u);
}

// キャッシュ未注入 (nullptr) でも従来どおり動作する
TEST_F(AsyncQueryProviderCacheTest, WorksWithoutCache) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(2).WillRepeatedly(::testing::Invoke([](std::string_view) { return makeSelectResult(); }));
    AsyncQueryProvider provider(connections, history, nullptr);

    auto first = submitAndAwait(provider, "SELECT 1");
    auto second = submitAndAwait(provider, "SELECT 1");

    EXPECT_NE(first.find(R"("status":"completed")"), std::string::npos);
    EXPECT_NE(second.find(R"("status":"completed")"), std::string::npos);
}
