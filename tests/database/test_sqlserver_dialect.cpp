#include "database/sqlserver_dialect.h"

#include <gtest/gtest.h>

#include <string>

using velocitydb::SqlServerDialect;

// 注: 以下は getColumnsQuery が生成する SQL 文字列の部分一致検証であり、SQL の意味論
// (PK 判定の正確性等) までは検証しない。SchemaProvider のキャッシュ動作テストは
// IConnectionProvider/IDatabaseDriver の mock 基盤を要するため別途対応する (W5/W7)。

// #512: getColumns の PK 判定が c.object_id 相関で当該テーブルに絞られることを保証する。
// 相関が外れると sys.indexes 全体 (DB 内全テーブルの PK) スキャンに戻り初回スキーマ取得が
// 重くなる回帰を防ぐ。OBJECT_ID を使わないため ' を含む識別子でも PK 判定が壊れない。
TEST(SqlServerDialectTest, ColumnsQueryScopesPrimaryKeySubqueryToTable) {
    SqlServerDialect dialect;

    const auto sql = dialect.getColumnsQuery("dbo", "Users");

    EXPECT_NE(sql.find("ic.object_id = c.object_id"), std::string::npos);
    EXPECT_EQ(sql.find("OBJECT_ID("), std::string::npos);
}

// #512 の最適化が表示列 (型 / PK / comment) を削っていないことの回帰防止。
TEST(SqlServerDialectTest, ColumnsQueryRetainsCommentAndPrimaryKeyColumns) {
    SqlServerDialect dialect;

    const auto sql = dialect.getColumnsQuery("dbo", "Users");

    EXPECT_NE(sql.find("AS data_type"), std::string::npos);
    EXPECT_NE(sql.find("AS is_primary_key"), std::string::npos);
    EXPECT_NE(sql.find("AS comment"), std::string::npos);
    EXPECT_NE(sql.find("sys.extended_properties"), std::string::npos);
}
