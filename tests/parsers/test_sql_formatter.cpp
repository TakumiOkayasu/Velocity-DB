#include <gtest/gtest.h>
#include "parsers/sql_formatter.h"

namespace predategrip {
namespace test {

class SQLFormatterTest : public ::testing::Test {
protected:
    SQLFormatter formatter;
};

TEST_F(SQLFormatterTest, FormatsSimpleSelect) {
    std::string sql = "select * from users where id=1";
    std::string formatted = formatter.format(sql);

    EXPECT_NE(formatted.find("SELECT"), std::string::npos);
    EXPECT_NE(formatted.find("FROM"), std::string::npos);
    EXPECT_NE(formatted.find("WHERE"), std::string::npos);
}

TEST_F(SQLFormatterTest, RespectsKeywordCase) {
    SQLFormatter::FormatOptions options;
    options.keywordCase = KeywordCase::Lower;

    std::string sql = "SELECT * FROM users";
    std::string formatted = formatter.format(sql, options);

    EXPECT_NE(formatted.find("select"), std::string::npos);
    EXPECT_NE(formatted.find("from"), std::string::npos);
}

TEST_F(SQLFormatterTest, PreservesStringLiterals) {
    std::string sql = "SELECT * FROM users WHERE name = 'John''s Name'";
    std::string formatted = formatter.format(sql);

    EXPECT_NE(formatted.find("'John''s Name'"), std::string::npos);
}

TEST_F(SQLFormatterTest, HandlesCommas) {
    SQLFormatter::FormatOptions options;
    options.breakAfterComma = true;

    std::string sql = "SELECT id, name, email FROM users";
    std::string formatted = formatter.format(sql, options);

    // Should have line breaks after commas
    EXPECT_NE(formatted.find(",\n"), std::string::npos);
}

TEST_F(SQLFormatterTest, HandlesSemicolons) {
    std::string sql = "SELECT 1; SELECT 2;";
    std::string formatted = formatter.format(sql);

    // Each statement should be on separate lines
    size_t firstSemicolon = formatted.find(';');
    EXPECT_NE(firstSemicolon, std::string::npos);

    size_t newlineAfterSemicolon = formatted.find('\n', firstSemicolon);
    EXPECT_NE(newlineAfterSemicolon, std::string::npos);
}

TEST_F(SQLFormatterTest, HandlesParentheses) {
    std::string sql = "SELECT * FROM users WHERE id IN (1,2,3)";
    std::string formatted = formatter.format(sql);

    EXPECT_NE(formatted.find("IN ("), std::string::npos);
}

TEST_F(SQLFormatterTest, HandlesEmptyInput) {
    std::string sql = "";
    std::string formatted = formatter.format(sql);

    EXPECT_TRUE(formatted.empty());
}

TEST_F(SQLFormatterTest, HandlesWhitespaceOnly) {
    std::string sql = "   \n\t  ";
    std::string formatted = formatter.format(sql);

    EXPECT_TRUE(formatted.empty());
}

}  // namespace test
}  // namespace predategrip
