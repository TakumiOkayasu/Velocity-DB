#include <gtest/gtest.h>

#include <set>
#include <string>

#include "parsers/sql_linter.h"

namespace velocitydb {
namespace {

// ===== mapDialectToSqruff =====

TEST(MapDialectToSqruffTest, SqlServerToTsql) {
    EXPECT_EQ(mapDialectToSqruff("sqlserver"), "tsql");
}

TEST(MapDialectToSqruffTest, PostgresqlToPostgres) {
    EXPECT_EQ(mapDialectToSqruff("postgresql"), "postgres");
}

TEST(MapDialectToSqruffTest, MysqlToMysql) {
    EXPECT_EQ(mapDialectToSqruff("mysql"), "mysql");
}

TEST(MapDialectToSqruffTest, UnknownReturnsEmpty) {
    EXPECT_EQ(mapDialectToSqruff("oracle"), "");
    EXPECT_EQ(mapDialectToSqruff(""), "");
}

// ===== parseSqruffJson =====

TEST(ParseSqruffJsonTest, EmptyStringReturnsEmpty) {
    auto result = parseSqruffJson("");
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->empty());
}

TEST(ParseSqruffJsonTest, WhitespaceOnlyReturnsEmpty) {
    auto result = parseSqruffJson("   \n\t  ");
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->empty());
}

TEST(ParseSqruffJsonTest, EmptyObjectReturnsEmpty) {
    auto result = parseSqruffJson("{}");
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->empty());
}

TEST(ParseSqruffJsonTest, ParsesPrsDiagnostic) {
    std::string json = R"({"stdin":[{"code":"PRS","message":"unexpected token","range":{"start":{"line":3,"character":5}},"severity":1,"source":"sqruff"}]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 1u);
    EXPECT_EQ((*result)[0].line, 3);
    EXPECT_EQ((*result)[0].column, 5);
    EXPECT_EQ((*result)[0].code, "PRS");
    EXPECT_EQ((*result)[0].message, "unexpected token");
}

TEST(ParseSqruffJsonTest, FiltersNonPrsCodes) {
    std::string json = R"({"stdin":[
        {"code":"L001","message":"style","range":{"start":{"line":1,"character":1}}},
        {"code":"PRS","message":"parse error","range":{"start":{"line":2,"character":1}}},
        {"code":"CP01","message":"capitalization","range":{"start":{"line":3,"character":1}}}
    ]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 1u);
    EXPECT_EQ((*result)[0].code, "PRS");
}

TEST(ParseSqruffJsonTest, AcceptsPrsPrefixedCodes) {
    std::string json = R"({"stdin":[
        {"code":"PRS001","message":"a","range":{"start":{"line":1,"character":1}}},
        {"code":"PRS_UNEXPECTED","message":"b","range":{"start":{"line":2,"character":1}}}
    ]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->size(), 2u);
}

TEST(ParseSqruffJsonTest, MultipleFilesFlattened) {
    // JSON object key iteration order is not guaranteed; assert on the set of messages.
    std::string json = R"({
        "a.sql":[{"code":"PRS","message":"m1","range":{"start":{"line":1,"character":1}}}],
        "b.sql":[{"code":"PRS","message":"m2","range":{"start":{"line":2,"character":2}}}]
    })";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 2u);
    std::set<std::string> msgs{(*result)[0].message, (*result)[1].message};
    EXPECT_EQ(msgs, (std::set<std::string>{"m1", "m2"}));
}

TEST(ParseSqruffJsonTest, MissingCodeWithUnparsableMessageIsAccepted) {
    // sqruff (Rust移植版) は parse error に rule code を付けず "Unparsable section" message で出力する。
    // code フィールド欠損でも message が一致すれば parse error として採用する。
    std::string json = R"({"stdin":[{"message":"Unparsable section","range":{"start":{"line":1,"character":1}}}]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 1u);
    EXPECT_EQ((*result)[0].message, "Unparsable section");
}

TEST(ParseSqruffJsonTest, MissingCodeWithOtherMessageIsDiscarded) {
    // code 欠損でも message が "Unparsable section" 以外なら lint warning として扱い捨てる。
    std::string json = R"({"stdin":[{"message":"some style warning","range":{"start":{"line":1,"character":1}}}]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->empty());
}

TEST(ParseSqruffJsonTest, NullCodeWithUnparsableMessageIsAccepted) {
    // sqruff 0.38 の現実出力: code:null + message:"Unparsable section" を採用する。
    std::string json = R"({"<string>":[{"range":{"start":{"line":1,"character":1},"end":{"line":1,"character":1}},"message":"Unparsable section","severity":"Warning","source":"sqruff","code":null}]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 1u);
    EXPECT_EQ((*result)[0].message, "Unparsable section");
    EXPECT_EQ((*result)[0].line, 1);
    EXPECT_EQ((*result)[0].column, 1);
}

TEST(ParseSqruffJsonTest, NullCodeNonUnparsableIsDiscarded) {
    // code:null だが message が Unparsable section でないものは parse error 判定しない (誤検出防止)。
    std::string json = R"({"stdin":[{"range":{"start":{"line":1,"character":1}},"message":"random warning","severity":"Warning","code":null}]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->empty());
}

TEST(ParseSqruffJsonTest, RealSqruff038OutputMixedLintAndParseError) {
    // sqruff 0.38.0 実機出力 (printf 'SELECT *\nFROM users\nWHRE id = 1\n' | sqruff lint - --dialect postgres --format json --parsing-errors)
    // lint warning (LT02/AL05/CP02) は捨て、line:3,character:6 の parse error 1 件のみ採用。
    std::string json = R"({"<string>":[
        {"range":{"start":{"line":2,"character":5},"end":{"line":2,"character":5}},"message":"Expected line break and indent of 4 spaces before \"users\".","severity":"Warning","source":"sqruff","code":"LT02"},
        {"range":{"start":{"line":3,"character":1},"end":{"line":3,"character":1}},"message":"Alias 'WHRE' is never used in SELECT statement.","severity":"Warning","source":"sqruff","code":"AL05"},
        {"range":{"start":{"line":3,"character":1},"end":{"line":3,"character":1}},"message":"Unquoted identifiers must be consistently lower case.","severity":"Warning","source":"sqruff","code":"CP02"},
        {"range":{"start":{"line":3,"character":1},"end":{"line":3,"character":1}},"message":"Expected indent of 4 spaces","severity":"Warning","source":"sqruff","code":"LT02"},
        {"range":{"start":{"line":3,"character":5},"end":{"line":3,"character":5}},"message":"Expected line break and no indent before \"id\".","severity":"Warning","source":"sqruff","code":"LT02"},
        {"range":{"start":{"line":3,"character":6},"end":{"line":3,"character":6}},"message":"Unparsable section","severity":"Warning","source":"sqruff","code":null}
    ]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 1u);
    EXPECT_EQ((*result)[0].line, 3);
    EXPECT_EQ((*result)[0].column, 6);
    EXPECT_EQ((*result)[0].message, "Unparsable section");
}

TEST(ParseSqruffJsonTest, MalformedJsonReturnsError) {
    auto result = parseSqruffJson("{not valid json");
    EXPECT_FALSE(result.has_value());
}

TEST(ParseSqruffJsonTest, ClampsLineColumnToOne) {
    std::string json = R"({"stdin":[{"code":"PRS","message":"m","range":{"start":{"line":0,"character":0}}}]})";
    auto result = parseSqruffJson(json);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 1u);
    EXPECT_EQ((*result)[0].line, 1);
    EXPECT_EQ((*result)[0].column, 1);
}

// ===== lintSqlForParseErrors (BinaryNotFound path) =====

TEST(LintSqlForParseErrorsTest, BinaryNotFoundReturnsError) {
    SqlLinterConfig cfg{
        .binary = "C:/nonexistent/path/sqruff.exe",
        .configFile = {},
        .timeout = std::chrono::milliseconds{1000},
    };
    auto result = lintSqlForParseErrors(cfg, "SELECT 1", "tsql");
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().kind, LintErrorKind::BinaryNotFound);
}

}  // namespace
}  // namespace velocitydb
