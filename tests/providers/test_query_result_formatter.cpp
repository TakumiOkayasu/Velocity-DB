#include "providers/query_result_formatter.h"

#include "database/driver_interface.h"

#include <gtest/gtest.h>

namespace velocitydb {
namespace test {

namespace {

ResultSet makeSampleResultSet() {
    ResultSet rs;
    rs.columns.push_back({.name = "id", .type = "INT", .size = 4, .nullable = false, .isPrimaryKey = true});
    rs.columns.push_back({.name = "name", .type = "VARCHAR", .size = 50, .nullable = true, .isPrimaryKey = false});
    ResultRow r0;
    r0.values = {"1", "alice"};
    r0.nullFlags = {false, false};
    ResultRow r1;
    r1.values = {"2", ""};
    r1.nullFlags = {false, true};  // name = NULL
    ResultRow r2;
    r2.values = {"3", "carol"};
    r2.nullFlags = {false, false};
    rs.rows = {r0, r1, r2};
    rs.affectedRows = 0;
    rs.executionTimeMs = 1.5;
    return rs;
}

}  // namespace

// --- buildUseStatementResult ---

TEST(QueryResultFormatterTest, BuildUseStatementResult_ContainsDbNameInMessage) {
    auto rs = QueryResultFormatter::buildUseStatementResult("mydb");
    ASSERT_EQ(rs.columns.size(), 1u);
    EXPECT_EQ(rs.columns[0].name, "Message");
    ASSERT_EQ(rs.rows.size(), 1u);
    ASSERT_EQ(rs.rows[0].values.size(), 1u);
    EXPECT_NE(rs.rows[0].values[0].find("mydb"), std::string::npos);
    EXPECT_EQ(rs.rows[0].nullFlags[0], false);
    EXPECT_EQ(rs.affectedRows, 0);
    EXPECT_EQ(rs.executionTimeMs, 0.0);
}

TEST(QueryResultFormatterTest, BuildUseStatementResult_EmptyDbName_StillProducesValidShape) {
    auto rs = QueryResultFormatter::buildUseStatementResult({});
    ASSERT_EQ(rs.rows.size(), 1u);
    EXPECT_EQ(rs.columns[0].name, "Message");
    EXPECT_EQ(rs.columns[0].nullable, false);
    // 空 dbName でも "Database changed to " 接頭辞は維持される
    EXPECT_EQ(rs.rows[0].values[0], "Database changed to ");
}

TEST(QueryResultFormatterTest, BuildUseStatementResult_LeavesExecutionTimeAtZero_ForCallerToOverwrite) {
    // 呼び出し元 (executeQuery) が後段で計測値を代入する契約。
    // formatter は計測責務を持たないためデフォルト値のまま返す。
    auto rs = QueryResultFormatter::buildUseStatementResult("db");
    EXPECT_EQ(rs.executionTimeMs, 0.0);
    EXPECT_EQ(rs.affectedRows, 0);
}

// --- buildMultipleResultsJson ---

TEST(QueryResultFormatterTest, BuildMultipleResultsJson_EmptySpan_ReturnsHeaderWithEmptyArray) {
    auto json = QueryResultFormatter::buildMultipleResultsJson({});
    EXPECT_EQ(json, R"({"multipleResults":true,"results":[]})");
}

TEST(QueryResultFormatterTest, BuildMultipleResultsJson_SingleEntry_IncludesStatementAndData) {
    ResultSet rs = makeSampleResultSet();
    std::vector<NamedResult> entries = {{.statement = "SELECT *", .result = std::cref(rs)}};
    auto json = QueryResultFormatter::buildMultipleResultsJson(entries);
    EXPECT_NE(json.find(R"("multipleResults":true)"), std::string::npos);
    EXPECT_NE(json.find(R"("statement":"SELECT *")"), std::string::npos);
    EXPECT_NE(json.find(R"("data":)"), std::string::npos);
}

TEST(QueryResultFormatterTest, BuildMultipleResultsJson_TwoEntries_SeparatedByComma) {
    ResultSet rs1 = makeSampleResultSet();
    ResultSet rs2 = makeSampleResultSet();
    std::vector<NamedResult> entries = {{.statement = "SELECT a", .result = std::cref(rs1)}, {.statement = "SELECT b", .result = std::cref(rs2)}};
    auto json = QueryResultFormatter::buildMultipleResultsJson(entries);
    auto first = json.find(R"("statement":"SELECT a")");
    auto second = json.find(R"("statement":"SELECT b")");
    EXPECT_NE(first, std::string::npos);
    EXPECT_NE(second, std::string::npos);
    EXPECT_LT(first, second);  // 順序保持
}

TEST(QueryResultFormatterTest, BuildMultipleResultsJson_StatementWithQuote_IsEscaped) {
    ResultSet rs = makeSampleResultSet();
    std::vector<NamedResult> entries = {{.statement = R"(SELECT "x")", .result = std::cref(rs)}};
    auto json = QueryResultFormatter::buildMultipleResultsJson(entries);
    // statement フィールドの値全体としてエスケープ済み形が現れることを位置で確認
    EXPECT_NE(json.find(R"("statement":"SELECT \"x\"")"), std::string::npos);
}

// --- buildFilteredResultJson ---

TEST(QueryResultFormatterTest, BuildFilteredResultJson_NoMatches_EmptyRows) {
    auto rs = makeSampleResultSet();
    auto json = QueryResultFormatter::buildFilteredResultJson(rs, {});
    EXPECT_NE(json.find(R"("rows":[])"), std::string::npos);
    EXPECT_NE(json.find(R"("totalRows":3)"), std::string::npos);
    EXPECT_NE(json.find(R"("filteredRows":0)"), std::string::npos);
}

TEST(QueryResultFormatterTest, BuildFilteredResultJson_SingleMatch_ContainsRowValues) {
    auto rs = makeSampleResultSet();
    std::vector<size_t> indices = {0};
    auto json = QueryResultFormatter::buildFilteredResultJson(rs, indices);
    EXPECT_NE(json.find(R"("filteredRows":1)"), std::string::npos);
    EXPECT_NE(json.find("alice"), std::string::npos);
    EXPECT_EQ(json.find("carol"), std::string::npos);  // index 2 は含まない
}

TEST(QueryResultFormatterTest, BuildFilteredResultJson_NullValue_RenderedAsJsonNull) {
    auto rs = makeSampleResultSet();
    std::vector<size_t> indices = {1};  // id=2, name=NULL
    auto json = QueryResultFormatter::buildFilteredResultJson(rs, indices);
    // 行配列内に [<id>,null] の形で JSON null リテラルが出ることを位置で確認
    EXPECT_NE(json.find(R"(["2",null])"), std::string::npos);
}

TEST(QueryResultFormatterTest, BuildFilteredResultJson_PreservesIndexOrder) {
    auto rs = makeSampleResultSet();
    std::vector<size_t> indices = {2, 0};  // 逆順
    auto json = QueryResultFormatter::buildFilteredResultJson(rs, indices);
    auto carolPos = json.find("carol");
    auto alicePos = json.find("alice");
    EXPECT_NE(carolPos, std::string::npos);
    EXPECT_NE(alicePos, std::string::npos);
    EXPECT_LT(carolPos, alicePos);  // indices 順 (2,0) を保持
}

TEST(QueryResultFormatterTest, BuildFilteredResultJson_IncludesColumnsAndSimdFlag) {
    auto rs = makeSampleResultSet();
    auto json = QueryResultFormatter::buildFilteredResultJson(rs, {});
    EXPECT_NE(json.find(R"("columns")"), std::string::npos);
    EXPECT_NE(json.find(R"("simdAvailable")"), std::string::npos);
    // simdAvailable は true / false のいずれか (環境依存) — 文字列リテラルで埋め込まれているか確認
    bool hasFlag = json.find(R"("simdAvailable":true)") != std::string::npos
                   || json.find(R"("simdAvailable":false)") != std::string::npos;
    EXPECT_TRUE(hasFlag);
}

}  // namespace test
}  // namespace velocitydb
