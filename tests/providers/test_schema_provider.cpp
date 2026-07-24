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

// --- getAllColumns (#512) ---

// (schema, table) ソート済み行がテーブル毎にグルーピングされ、#514 のタプル形式で出力される
TEST_F(SchemaProviderCacheTest, GetAllColumnsGroupsRowsByTable) {
    resolveDriverByDefault();
    // 行レイアウト: schema, table, column, type, size, nullable, isPk, comment
    auto rows = makeResultSet({
        {"dbo", "orders", "id", "int", "4", "0", "1", ""},
        {"dbo", "orders", "user_id", "int", "4", "1", "0", "FK"},
        {"dbo", "users", "id", "int", "4", "0", "1", ""},
    });
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(rows));

    SchemaProvider provider(connections);
    const auto json = provider.getAllColumns(R"({"connectionId":"db_1"})");

    EXPECT_NE(json.find(R"(["dbo","orders",[)"), std::string::npos);
    EXPECT_NE(json.find(R"(["dbo","users",[)"), std::string::npos);
    EXPECT_NE(json.find(R"(["user_id","int",4,true,false,"FK"])"), std::string::npos);
    // orders グループが users より先 (ソート順保持)
    EXPECT_LT(json.find(R"("orders")"), json.find(R"("users")"));
}

// --- ワイヤ形式のタプル化 (#514) ---

// getTables は [schema, name, type, comment] のタプル配列を返す
TEST_F(SchemaProviderCacheTest, GetTablesReturnsTupleRows) {
    resolveDriverByDefault();
    auto rows = makeResultSet({
        {"dbo", "Users", "TABLE", ""},
        {"dbo", "ActiveUsers", "VIEW", "抽出ビュー"},
    });
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(rows));

    SchemaProvider provider(connections);
    const auto json = provider.getTables(R"({"connectionId":"db_1"})");

    EXPECT_NE(json.find(R"(["dbo","Users","TABLE",""])"), std::string::npos);
    EXPECT_NE(json.find(R"(["dbo","ActiveUsers","VIEW","抽出ビュー"])"), std::string::npos);
    EXPECT_EQ(json.find(R"("schema":)"), std::string::npos);
}

// getColumns は [name, type, size, nullable, isPrimaryKey, comment] のタプル配列を返す
TEST_F(SchemaProviderCacheTest, GetColumnsReturnsTupleRows) {
    resolveDriverByDefault();
    // 行レイアウト: name, type, size, nullable, isPk, comment
    auto rows = makeResultSet({
        {"id", "int", "4", "0", "1", ""},
        {"name", "nvarchar", "255", "1", "0", "表示名"},
    });
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(rows));

    SchemaProvider provider(connections);
    const auto json = provider.getColumns(R"({"connectionId":"db_1","table":"Users"})");

    EXPECT_NE(json.find(R"(["id","int",4,false,true,""])"), std::string::npos);
    EXPECT_NE(json.find(R"(["name","nvarchar",255,true,false,"表示名"])"), std::string::npos);
    EXPECT_EQ(json.find(R"("isPrimaryKey":)"), std::string::npos);
}

// タプル形式は旧オブジェクト形式 (キーを全行で重複) と比べ 30% 以上小さい (#514 完了条件)
TEST_F(SchemaProviderCacheTest, TupleFormatReducesPayloadOverLegacyByThirtyPercent) {
    resolveDriverByDefault();
    // 現実的なカラム名/型で 40 テーブル x 25 カラムを生成
    std::vector<std::vector<std::string>> cells;
    for (int t = 0; t < 40; ++t) {
        for (int c = 0; c < 25; ++c) {
            cells.push_back({"dbo", std::format("table_{:02}", t), std::format("column_{:02}", c), c % 2 == 0 ? "int" : "nvarchar", c % 2 == 0 ? "4" : "255",
                             c % 3 == 0 ? "0" : "1", c == 0 ? "1" : "0", ""});
        }
    }
    auto rows = makeResultSet(cells);
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(rows));

    SchemaProvider provider(connections);
    const auto json = provider.getAllColumns(R"({"connectionId":"db_1"})");

    // 旧形式 ({"schema":..,"table":..,"columns":[{"name":..,...},...]}) を同一データから構築
    std::string legacy = "[";
    for (int t = 0; t < 40; ++t) {
        if (t > 0)
            legacy += ",";
        legacy += std::format(R"({{"schema":"dbo","table":"table_{:02}","columns":[)", t);
        for (int c = 0; c < 25; ++c) {
            if (c > 0)
                legacy += ",";
            legacy += std::format(R"({{"name":"column_{:02}","type":"{}","size":{},"nullable":{},"isPrimaryKey":{},"comment":""}})", c, c % 2 == 0 ? "int" : "nvarchar",
                                  c % 2 == 0 ? 4 : 255, c % 3 == 0 ? "false" : "true", c == 0 ? "true" : "false");
        }
        legacy += "]}";
    }
    legacy += "]";

    EXPECT_LT(static_cast<double>(json.size()), static_cast<double>(legacy.size()) * 0.7)
        << "tuple=" << json.size() << " bytes, legacy=" << legacy.size() << " bytes";
}

// 2 回目はキャッシュ命中し driver->execute は 1 回
TEST_F(SchemaProviderCacheTest, GetAllColumnsSecondCallHitsCache) {
    resolveDriverByDefault();
    auto rows = makeResultSet({{"dbo", "users", "id", "int", "4", "0", "1", ""}});
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(rows));

    SchemaProvider provider(connections);
    const auto first = provider.getAllColumns(R"({"connectionId":"db_1"})");
    const auto second = provider.getAllColumns(R"({"connectionId":"db_1"})");

    EXPECT_EQ(first, second);
}

// テーブルが 1 件もない場合は空配列
TEST_F(SchemaProviderCacheTest, GetAllColumnsEmptySchemaYieldsEmptyArray) {
    resolveDriverByDefault();
    EXPECT_CALL(*driver, execute(::testing::_)).Times(1).WillOnce(::testing::Return(ResultSet{}));

    SchemaProvider provider(connections);
    const auto json = provider.getAllColumns(R"({"connectionId":"db_1"})");

    EXPECT_NE(json.find(R"("data":[])"), std::string::npos);
}
