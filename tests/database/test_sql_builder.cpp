#include "database/sql_builder.h"

#include "database/postgresql_dialect.h"
#include "simdjson.h"

#include <gtest/gtest.h>

#include <memory>

namespace velocitydb {
namespace test {

class SqlBuilderTest : public ::testing::Test {
protected:
    PostgreSqlDialect dialect;
    SqlBuilder builder{dialect};

    /// simdjson::dom::parser は **最後の parse 結果のみ有効** (再 parse で前の結果が無効化される)。
    /// 1 テスト内で複数 JSON 配列を同時に保持する必要があるため、
    /// parser を都度新規確保し、vector をオーナーとしてテスト終了まで生存させる。
    /// 単一 parser を使い回すと dangling な dom::array が DmlInput に格納される。
    std::vector<std::unique_ptr<simdjson::dom::parser>> parsers;

    simdjson::dom::array parseArray(std::string_view json) {
        auto& p = parsers.emplace_back(std::make_unique<simdjson::dom::parser>());
        auto result = p->parse(json).get_array();
        EXPECT_FALSE(result.error()) << "parseArray: invalid JSON: " << json;
        return result.value();
    }
};

// --- buildDataView ---

TEST_F(SqlBuilderTest, BuildDataView_NoWhere_ReturnsSelectAll) {
    auto sql = builder.buildDataView("users", {}, 100);
    EXPECT_NE(sql.find("SELECT *"), std::string::npos);
    EXPECT_NE(sql.find("\"users\""), std::string::npos);
    EXPECT_NE(sql.find("LIMIT 100"), std::string::npos);
    EXPECT_EQ(sql.find("WHERE"), std::string::npos);
}

TEST_F(SqlBuilderTest, BuildDataView_WithWhere_IncludesWhereClause) {
    auto sql = builder.buildDataView("users", "id = 1", 50);
    EXPECT_NE(sql.find("WHERE id = 1"), std::string::npos);
    EXPECT_NE(sql.find("LIMIT 50"), std::string::npos);
}

TEST_F(SqlBuilderTest, BuildDataView_TableNameWithSchema_QuotesEachPart) {
    auto sql = builder.buildDataView("public.users", {}, 10);
    EXPECT_NE(sql.find("\"public\".\"users\""), std::string::npos);
}

// --- buildWhere (スタンドアロン: 数値は非 quote 埋め込み) ---

TEST_F(SqlBuilderTest, BuildWhere_StringValue_QuotesLiteral) {
    auto where = builder.buildWhere(parseArray(R"([{"column":"name","value":"alice"}])"));
    EXPECT_EQ(where, "\"name\" = 'alice'");
}

TEST_F(SqlBuilderTest, BuildWhere_NullValue_UsesIsNull) {
    auto where = builder.buildWhere(parseArray(R"([{"column":"name","value":null}])"));
    EXPECT_EQ(where, "\"name\" IS NULL");
}

TEST_F(SqlBuilderTest, BuildWhere_NumericValue_EmbedsDirectly) {
    auto where = builder.buildWhere(parseArray(R"([{"column":"age","value":42}])"));
    EXPECT_EQ(where, "\"age\" = 42");
}

TEST_F(SqlBuilderTest, BuildWhere_MultipleConditions_JoinsWithAnd) {
    auto where = builder.buildWhere(parseArray(R"([{"column":"a","value":1},{"column":"b","value":"x"}])"));
    EXPECT_EQ(where, "\"a\" = 1 AND \"b\" = 'x'");
}

TEST_F(SqlBuilderTest, BuildWhere_MissingColumn_SkipsCondition) {
    auto where = builder.buildWhere(parseArray(R"([{"value":1},{"column":"b","value":2}])"));
    EXPECT_EQ(where, "\"b\" = 2");
}

TEST_F(SqlBuilderTest, BuildWhere_StringWithQuote_EscapesProperly) {
    auto where = builder.buildWhere(parseArray(R"([{"column":"name","value":"O'Brien"}])"));
    EXPECT_EQ(where, "\"name\" = 'O''Brien'");
}

// --- buildDml: INSERT (非 string 値も quoteLiteral) ---

TEST_F(SqlBuilderTest, BuildDml_Insert_BasicRow) {
    DmlInput input;
    input.table = "users";
    input.inserts = parseArray(R"([{"id":1,"name":"alice"}])");
    auto stmts = builder.buildDml(input);
    ASSERT_EQ(stmts.size(), 1u);
    EXPECT_NE(stmts[0].find("INSERT INTO \"users\""), std::string::npos);
    EXPECT_NE(stmts[0].find("\"id\""), std::string::npos);
    EXPECT_NE(stmts[0].find("\"name\""), std::string::npos);
    EXPECT_NE(stmts[0].find("'alice'"), std::string::npos);
    // 非 string 値も元実装通り quoteLiteral される (quoteLiteral(minify(1)) = '1')
    EXPECT_NE(stmts[0].find("'1'"), std::string::npos);
}

TEST_F(SqlBuilderTest, BuildDml_Insert_NullValue_EmitsNullLiteral) {
    DmlInput input;
    input.table = "t";
    input.inserts = parseArray(R"([{"a":null,"b":1}])");
    auto stmts = builder.buildDml(input);
    ASSERT_EQ(stmts.size(), 1u);
    EXPECT_NE(stmts[0].find("VALUES (NULL"), std::string::npos);
}

// --- buildDml: UPDATE ---

TEST_F(SqlBuilderTest, BuildDml_Update_WithPk_UsesPkInWhere) {
    DmlInput input;
    input.table = "users";
    input.pkColumns = {"id"};
    input.updates = parseArray(R"([{"changes":{"name":"bob"},"originalData":{"id":7,"name":"alice"}}])");
    auto stmts = builder.buildDml(input);
    ASSERT_EQ(stmts.size(), 1u);
    // 非 string は元実装通り quoteLiteral される
    EXPECT_EQ(stmts[0], "UPDATE \"users\" SET \"name\" = 'bob' WHERE \"id\" = '7';");
}

TEST_F(SqlBuilderTest, BuildDml_Update_NoPk_UsesAllOriginalColumns) {
    DmlInput input;
    input.table = "t";
    input.updates = parseArray(R"([{"changes":{"v":2},"originalData":{"a":1,"b":"x"}}])");
    auto stmts = builder.buildDml(input);
    ASSERT_EQ(stmts.size(), 1u);
    EXPECT_NE(stmts[0].find("WHERE \"a\" = '1' AND \"b\" = 'x'"), std::string::npos);
}

TEST_F(SqlBuilderTest, BuildDml_Update_MissingChanges_Skipped) {
    DmlInput input;
    input.table = "t";
    input.updates = parseArray(R"([{"originalData":{"id":1}}])");
    EXPECT_TRUE(builder.buildDml(input).empty());
}

TEST_F(SqlBuilderTest, BuildDml_Update_MissingOriginalData_Skipped) {
    DmlInput input;
    input.table = "t";
    input.pkColumns = {"id"};
    input.updates = parseArray(R"([{"changes":{"name":"x"}}])");
    EXPECT_TRUE(builder.buildDml(input).empty());
}

// --- buildDml: DELETE ---

TEST_F(SqlBuilderTest, BuildDml_Delete_WithPk_UsesPkOnly) {
    DmlInput input;
    input.table = "users";
    input.pkColumns = {"id"};
    input.deletes = parseArray(R"([{"id":3,"name":"ignored"}])");
    auto stmts = builder.buildDml(input);
    ASSERT_EQ(stmts.size(), 1u);
    EXPECT_EQ(stmts[0], "DELETE FROM \"users\" WHERE \"id\" = '3';");
}

TEST_F(SqlBuilderTest, BuildDml_Delete_NoPk_UsesAllColumns) {
    DmlInput input;
    input.table = "t";
    input.deletes = parseArray(R"([{"a":1,"b":null}])");
    auto stmts = builder.buildDml(input);
    ASSERT_EQ(stmts.size(), 1u);
    EXPECT_NE(stmts[0].find("WHERE \"a\" = '1' AND \"b\" IS NULL"), std::string::npos);
}

// --- buildDml: 統合 ---

TEST_F(SqlBuilderTest, BuildDml_AllThreeOperations_OrderedUpdateInsertDelete) {
    DmlInput input;
    input.schema = "public";
    input.table = "t";
    input.pkColumns = {"id"};
    input.updates = parseArray(R"([{"changes":{"v":1},"originalData":{"id":1}}])");
    input.inserts = parseArray(R"([{"id":2,"v":2}])");
    input.deletes = parseArray(R"([{"id":3}])");
    auto stmts = builder.buildDml(input);
    ASSERT_EQ(stmts.size(), 3u);
    EXPECT_NE(stmts[0].find("UPDATE"), std::string::npos);
    EXPECT_NE(stmts[1].find("INSERT INTO"), std::string::npos);
    EXPECT_NE(stmts[2].find("DELETE FROM"), std::string::npos);
    EXPECT_NE(stmts[0].find("\"public\".\"t\""), std::string::npos);
}

TEST_F(SqlBuilderTest, BuildDml_AllOptional_EmptyArrays_ReturnsEmpty) {
    DmlInput input;
    input.table = "t";
    EXPECT_TRUE(builder.buildDml(input).empty());
}

}  // namespace test
}  // namespace velocitydb
