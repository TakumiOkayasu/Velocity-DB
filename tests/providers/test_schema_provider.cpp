#include "providers/schema_provider.h"

#include "database/connection_types.h"
#include "database/driver_interface.h"
#include "interfaces/providers/connection_provider.h"

#include <gmock/gmock.h>
#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

using velocitydb::DatabaseConnectionParams;
using velocitydb::DriverType;
using velocitydb::IConnectionProvider;
using velocitydb::IDatabaseDriver;
using velocitydb::ResultRow;
using velocitydb::ResultSet;
using velocitydb::SchemaProvider;

// #512: SchemaProvider のキャッシュ動作 (2 回目命中・clear で無効化・error 非キャッシュ) を
// driver->execute の呼び出し回数で検証する。実 DB を要さず、IConnectionProvider /
// IDatabaseDriver を gmock 化して注入する。withCache リファクタ (W5) の振る舞い同等性を守る
// 特性テストでもある。

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

// ResultSet の string_view は ResultSet::storage が所有するメモリを指す。テスト用にセル文字列を
// arena (storage) に保持し、その string を string_view で参照させて寿命を保証する。
ResultSet makeResultSet(std::vector<std::vector<std::string>> cells) {
    auto arena = std::make_shared<std::vector<std::vector<std::string>>>(std::move(cells));
    ResultSet result;
    result.storage = arena;
    result.rows.reserve(arena->size());
    for (const auto& row : *arena) {
        ResultRow resultRow;
        resultRow.values.reserve(row.size());
        for (const auto& cell : row) {
            resultRow.values.emplace_back(cell);
        }
        result.rows.push_back(std::move(resultRow));
    }
    return result;
}

// getIndexes が要求する 5 列 (name/type/isUnique/isPrimaryKey/columns) を持つ 1 行。
ResultSet singleIndexRow() {
    return makeResultSet({{"PK_Users", "CLUSTERED", "1", "1", "Id"}});
}

}  // namespace

class SchemaProviderCacheTest : public ::testing::Test {
protected:
    ::testing::NiceMock<MockConnectionProvider> connections;
    std::shared_ptr<::testing::NiceMock<MockDatabaseDriver>> driver =
        std::make_shared<::testing::NiceMock<MockDatabaseDriver>>();

    void resolveDriverByDefault() {
        ON_CALL(connections, getMetadataDriver(::testing::_)).WillByDefault(::testing::Return(driver));
        ON_CALL(connections, getDriverType(::testing::_)).WillByDefault(::testing::Return(DriverType::SQLServer));
    }
};

// 同一 params の 2 回目呼び出しはキャッシュ命中し、driver->execute は 1 回しか呼ばれない。
TEST_F(SchemaProviderCacheTest, GetIndexesSecondCallHitsCacheWithoutReExecuting) {
    resolveDriverByDefault();
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(singleIndexRow()));

    SchemaProvider provider(connections);
    const std::string params = R"({"connectionId":"db_1","table":"Users"})";

    const auto first = provider.getIndexes(params);
    const auto second = provider.getIndexes(params);

    EXPECT_EQ(first, second);
    EXPECT_NE(first.find("PK_Users"), std::string::npos);
}

// clearSchemaCache 後はキャッシュが無効化され、driver->execute が再度呼ばれる。
TEST_F(SchemaProviderCacheTest, ClearSchemaCacheForcesReExecute) {
    resolveDriverByDefault();
    EXPECT_CALL(*driver, execute(::testing::_)).Times(2).WillRepeatedly(::testing::Return(singleIndexRow()));

    SchemaProvider provider(connections);
    const std::string params = R"({"connectionId":"db_1","table":"Users"})";

    provider.getIndexes(params);
    provider.clearSchemaCache("");
    provider.getIndexes(params);
}

// エラー応答はキャッシュされない。1 回目で driver 解決に失敗してエラーを返しても、2 回目で driver が
// 解決できれば execute が走り正しい結果が返る (errorResponse 非キャッシュの不変条件)。
TEST_F(SchemaProviderCacheTest, ErrorResponseIsNotCached) {
    EXPECT_CALL(connections, getMetadataDriver(::testing::_))
        .WillOnce(::testing::Return(nullptr))
        .WillRepeatedly(::testing::Return(driver));
    ON_CALL(connections, getDriverType(::testing::_)).WillByDefault(::testing::Return(DriverType::SQLServer));
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(singleIndexRow()));

    SchemaProvider provider(connections);
    const std::string params = R"({"connectionId":"db_1","table":"Users"})";

    const auto firstError = provider.getIndexes(params);
    const auto secondOk = provider.getIndexes(params);

    EXPECT_NE(firstError.find("Connection not found"), std::string::npos);
    EXPECT_NE(secondOk.find("PK_Users"), std::string::npos);
}
