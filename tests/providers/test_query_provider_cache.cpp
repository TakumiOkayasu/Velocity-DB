#include "providers/query_provider.h"

#include "database/connection_types.h"
#include "database/driver_interface.h"
#include "database/query_history.h"
#include "database/result_cache.h"
#include "interfaces/providers/connection_provider.h"

#include <gmock/gmock.h>
#include <gtest/gtest.h>

#include <chrono>
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

using velocitydb::DatabaseConnectionParams;
using velocitydb::DriverType;
using velocitydb::IConnectionProvider;
using velocitydb::IDatabaseDriver;
using velocitydb::QueryHistory;
using velocitydb::QueryProvider;
using velocitydb::ResultCache;
using velocitydb::ResultRow;
using velocitydb::ResultSet;

// #511: executeQueryPaginated / getRowCount のキャッシュと、DML/USE による接続単位
// 無効化を driver->execute の呼び出し回数で検証する (実 DB 不要)。

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

ResultSet makeSingleValueResult(std::string value) {
    auto arena = std::make_shared<std::deque<std::string>>();
    arena->emplace_back(std::move(value));
    ResultSet rs;
    rs.columns.push_back({.name = "value", .type = "INT"});
    ResultRow row;
    row.values.emplace_back(arena->back());
    row.nullFlags.push_back(false);
    rs.rows.push_back(std::move(row));
    rs.storage = std::move(arena);
    return rs;
}

}  // namespace

class QueryProviderCacheTest : public ::testing::Test {
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

    static constexpr std::string_view kPaginatedParams = R"({"connectionId":"c1","sql":"SELECT * FROM t","startRow":0,"endRow":100})";
    static constexpr std::string_view kRowCountParams = R"({"connectionId":"c1","sql":"SELECT * FROM t"})";
};

// 同一パラメータのページ取得 2 回目はキャッシュ命中し、driver->execute は 1 回
TEST_F(QueryProviderCacheTest, PaginatedSecondCallHitsCache) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(makeSingleValueResult("v1")));
    QueryProvider provider(connections, history, cache);

    auto first = provider.executeQueryPaginated(kPaginatedParams);
    auto second = provider.executeQueryPaginated(kPaginatedParams);

    EXPECT_EQ(first, second);
    EXPECT_NE(first.find("v1"), std::string::npos);
}

// ページ範囲が違えば別エントリとして実行される
TEST_F(QueryProviderCacheTest, DifferentPageRangeMisses) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(2).WillRepeatedly(::testing::Invoke([](std::string_view) { return makeSingleValueResult("v1"); }));
    QueryProvider provider(connections, history, cache);

    (void)provider.executeQueryPaginated(kPaginatedParams);
    (void)provider.executeQueryPaginated(R"({"connectionId":"c1","sql":"SELECT * FROM t","startRow":100,"endRow":200})");
}

// ソート条件が違えば別エントリとして実行される
TEST_F(QueryProviderCacheTest, DifferentSortModelMisses) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(2).WillRepeatedly(::testing::Invoke([](std::string_view) { return makeSingleValueResult("v1"); }));
    QueryProvider provider(connections, history, cache);

    (void)provider.executeQueryPaginated(kPaginatedParams);
    (void)provider.executeQueryPaginated(R"({"connectionId":"c1","sql":"SELECT * FROM t","startRow":0,"endRow":100,"sortModel":[{"colId":"id","sort":"asc"}]})");
}

// getRowCount の 2 回目はキャッシュ命中し、driver->execute は 1 回
TEST_F(QueryProviderCacheTest, RowCountSecondCallHitsCache) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(makeSingleValueResult("42")));
    QueryProvider provider(connections, history, cache);

    auto first = provider.getRowCount(kRowCountParams);
    auto second = provider.getRowCount(kRowCountParams);

    EXPECT_NE(first.find(R"("rowCount":42)"), std::string::npos);
    EXPECT_EQ(first, second);
}

// DML (executeQuery) 成功後は同一接続のページ/行数キャッシュが無効化され再実行される
TEST_F(QueryProviderCacheTest, DmlInvalidatesPaginatedAndRowCountCache) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(5).WillRepeatedly(::testing::Invoke([](std::string_view) { return makeSingleValueResult("42"); }));
    QueryProvider provider(connections, history, cache);

    (void)provider.executeQueryPaginated(kPaginatedParams);                                       // 1: miss → put
    (void)provider.getRowCount(kRowCountParams);                                                  // 2: miss → put
    (void)provider.executeQuery(R"({"connectionId":"c1","sql":"DELETE FROM t WHERE id = 1"})");   // 3: DML → 無効化
    (void)provider.executeQueryPaginated(kPaginatedParams);                                       // 4: 再実行
    (void)provider.getRowCount(kRowCountParams);                                                  // 5: 再実行
}

// 別接続の DML は他接続のキャッシュに影響しない
TEST_F(QueryProviderCacheTest, DmlOnOtherConnectionKeepsCache) {
    EXPECT_CALL(*driver, execute(::testing::_)).Times(2).WillRepeatedly(::testing::Invoke([](std::string_view) { return makeSingleValueResult("42"); }));
    QueryProvider provider(connections, history, cache);

    (void)provider.executeQueryPaginated(kPaginatedParams);                                       // 1: miss → put (c1)
    (void)provider.executeQuery(R"({"connectionId":"c2","sql":"DELETE FROM t WHERE id = 1"})");   // 2: c2 の DML
    (void)provider.executeQueryPaginated(kPaginatedParams);                                       // c1 はキャッシュ命中
}
