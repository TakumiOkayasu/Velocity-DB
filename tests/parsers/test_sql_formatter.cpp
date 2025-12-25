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

TEST_F(SQLFormatterTest, FormatsComplexSelectWithJoins) {
    std::string sql = "SELECT u.id, u.name, o.order_date, o.total FROM users u "
                      "JOIN orders o ON u.id=o.user_id "
                      "LEFT JOIN order_items oi ON o.id=oi.order_id "
                      "WHERE u.active=1 AND o.total>100 "
                      "ORDER BY o.order_date DESC";
    std::string formatted = formatter.format(sql);

    // Check SELECT clause formatting
    EXPECT_NE(formatted.find("SELECT"), std::string::npos);
    EXPECT_NE(formatted.find("u.id"), std::string::npos);

    // Check JOIN indentation
    EXPECT_NE(formatted.find("  JOIN"), std::string::npos);
    EXPECT_NE(formatted.find("  LEFT JOIN"), std::string::npos);

    // Check WHERE clause
    EXPECT_NE(formatted.find("WHERE"), std::string::npos);
    EXPECT_NE(formatted.find("AND"), std::string::npos);

    // Check ORDER BY clause
    EXPECT_NE(formatted.find("ORDER BY"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsWhereClauseWithMultipleConditions) {
    std::string sql = "SELECT * FROM users WHERE active=1 AND age>=18 AND country='US' OR country='CA'";
    std::string formatted = formatter.format(sql);

    // WHERE should be on its own line
    EXPECT_NE(formatted.find("WHERE"), std::string::npos);

    // AND/OR should be present
    EXPECT_NE(formatted.find("AND"), std::string::npos);
    EXPECT_NE(formatted.find("OR"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsSelectWithCaseExpression) {
    std::string sql = "SELECT id, CASE WHEN status='active' THEN 1 WHEN status='pending' THEN 2 ELSE 0 END as status_code FROM users";
    std::string formatted = formatter.format(sql);

    // Check CASE expression keywords
    EXPECT_NE(formatted.find("CASE"), std::string::npos);
    EXPECT_NE(formatted.find("WHEN"), std::string::npos);
    EXPECT_NE(formatted.find("THEN"), std::string::npos);
    EXPECT_NE(formatted.find("ELSE"), std::string::npos);
    EXPECT_NE(formatted.find("END"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsGroupByWithHaving) {
    std::string sql = "SELECT department, COUNT(*) as emp_count FROM employees "
                      "GROUP BY department HAVING COUNT(*)>10 ORDER BY emp_count DESC";
    std::string formatted = formatter.format(sql);

    // Check GROUP BY clause
    EXPECT_NE(formatted.find("GROUP BY"), std::string::npos);
    EXPECT_NE(formatted.find("department"), std::string::npos);

    // Check HAVING clause
    EXPECT_NE(formatted.find("HAVING"), std::string::npos);
    // Note: Formatter adds spaces around operators
    EXPECT_NE(formatted.find("COUNT(*)"), std::string::npos);

    // Check ORDER BY clause
    EXPECT_NE(formatted.find("ORDER BY"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsNestedSubquery) {
    std::string sql = "SELECT * FROM (SELECT id, name FROM users WHERE active=1) AS active_users WHERE id>100";
    std::string formatted = formatter.format(sql);

    // Should handle nested SELECT
    EXPECT_GT(std::count(formatted.begin(), formatted.end(), '('), 0);
    EXPECT_GT(std::count(formatted.begin(), formatted.end(), ')'), 0);

    // Should preserve AS alias
    EXPECT_NE(formatted.find("AS"), std::string::npos);
    EXPECT_NE(formatted.find("active_users"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsMultipleJoinTypes) {
    std::string sql = "SELECT * FROM t1 "
                      "INNER JOIN t2 ON t1.id=t2.id "
                      "LEFT JOIN t3 ON t2.id=t3.id "
                      "RIGHT JOIN t4 ON t3.id=t4.id "
                      "FULL OUTER JOIN t5 ON t4.id=t5.id";
    std::string formatted = formatter.format(sql);

    // Check all JOIN types are present
    EXPECT_NE(formatted.find("INNER JOIN"), std::string::npos);
    EXPECT_NE(formatted.find("LEFT JOIN"), std::string::npos);
    EXPECT_NE(formatted.find("RIGHT JOIN"), std::string::npos);
    EXPECT_NE(formatted.find("FULL OUTER JOIN"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsSelectWithAggregates) {
    std::string sql = "SELECT COUNT(*), SUM(amount), AVG(price), MAX(quantity), MIN(cost) FROM orders";
    std::string formatted = formatter.format(sql);

    // Check aggregate functions
    EXPECT_NE(formatted.find("COUNT(*)"), std::string::npos);
    EXPECT_NE(formatted.find("SUM("), std::string::npos);
    EXPECT_NE(formatted.find("AVG("), std::string::npos);
    EXPECT_NE(formatted.find("MAX("), std::string::npos);
    EXPECT_NE(formatted.find("MIN("), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsComplexWhereWithParentheses) {
    std::string sql = "SELECT * FROM users WHERE (age>18 AND country='US') OR (age>21 AND country='EU')";
    std::string formatted = formatter.format(sql);

    // Should preserve parentheses for grouping
    EXPECT_GT(std::count(formatted.begin(), formatted.end(), '('), 0);
    EXPECT_GT(std::count(formatted.begin(), formatted.end(), ')'), 0);

    // Should have AND and OR
    EXPECT_NE(formatted.find("AND"), std::string::npos);
    EXPECT_NE(formatted.find("OR"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsInClause) {
    std::string sql = "SELECT * FROM users WHERE id IN (1,2,3,4,5)";
    std::string formatted = formatter.format(sql);

    // Should have IN keyword
    EXPECT_NE(formatted.find("IN"), std::string::npos);

    // Should preserve parentheses and values
    EXPECT_NE(formatted.find("(1"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsBetweenClause) {
    std::string sql = "SELECT * FROM orders WHERE order_date BETWEEN '2024-01-01' AND '2024-12-31'";
    std::string formatted = formatter.format(sql);

    // Should have BETWEEN keyword
    EXPECT_NE(formatted.find("BETWEEN"), std::string::npos);

    // Should preserve date literals
    EXPECT_NE(formatted.find("'2024-01-01'"), std::string::npos);
    EXPECT_NE(formatted.find("'2024-12-31'"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsLikeClause) {
    std::string sql = "SELECT * FROM users WHERE name LIKE 'John%' OR email LIKE '%@example.com'";
    std::string formatted = formatter.format(sql);

    // Should have LIKE keyword
    EXPECT_NE(formatted.find("LIKE"), std::string::npos);

    // Should preserve pattern literals
    EXPECT_NE(formatted.find("'John%'"), std::string::npos);
    EXPECT_NE(formatted.find("'%@example.com'"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsDistinct) {
    std::string sql = "SELECT DISTINCT country FROM users ORDER BY country";
    std::string formatted = formatter.format(sql);

    // Should have DISTINCT keyword
    EXPECT_NE(formatted.find("DISTINCT"), std::string::npos);
    EXPECT_NE(formatted.find("country"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsUnion) {
    std::string sql = "SELECT id FROM users UNION SELECT id FROM customers";
    std::string formatted = formatter.format(sql);

    // Should have UNION keyword
    EXPECT_NE(formatted.find("UNION"), std::string::npos);

    // Should have two SELECT statements
    size_t firstSelect = formatted.find("SELECT");
    EXPECT_NE(firstSelect, std::string::npos);

    size_t secondSelect = formatted.find("SELECT", firstSelect + 1);
    EXPECT_NE(secondSelect, std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsOrderByMultipleColumns) {
    std::string sql = "SELECT * FROM orders ORDER BY order_date DESC, customer_id ASC, total DESC";
    std::string formatted = formatter.format(sql);

    // Check ORDER BY clause
    EXPECT_NE(formatted.find("ORDER BY"), std::string::npos);

    // Check DESC and ASC keywords
    EXPECT_NE(formatted.find("DESC"), std::string::npos);
    EXPECT_NE(formatted.find("ASC"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsLowercaseKeywords) {
    SQLFormatter::FormatOptions options;
    options.keywordCase = KeywordCase::Lower;

    std::string sql = "SELECT id, name FROM users WHERE active=1";
    std::string formatted = formatter.format(sql, options);

    // Keywords should be lowercase
    EXPECT_NE(formatted.find("select"), std::string::npos);
    EXPECT_NE(formatted.find("from"), std::string::npos);
    EXPECT_NE(formatted.find("where"), std::string::npos);
}

TEST_F(SQLFormatterTest, PreservesNumericLiterals) {
    std::string sql = "SELECT * FROM products WHERE price=19.99 AND quantity>100";
    std::string formatted = formatter.format(sql);

    // Should preserve numeric values
    EXPECT_NE(formatted.find("19.99"), std::string::npos);
    EXPECT_NE(formatted.find("100"), std::string::npos);
}

TEST_F(SQLFormatterTest, UppercasesKeywords) {
    std::string sql = "select o.order_id from dbo.orders o where o.deleted_at is null";
    std::string uppercased = formatter.uppercaseKeywords(sql);

    // Keywords should be uppercased
    EXPECT_NE(uppercased.find("SELECT"), std::string::npos);
    EXPECT_NE(uppercased.find("FROM"), std::string::npos);
    EXPECT_NE(uppercased.find("WHERE"), std::string::npos);
    EXPECT_NE(uppercased.find("IS"), std::string::npos);
    EXPECT_NE(uppercased.find("NULL"), std::string::npos);

    // Identifiers should remain lowercase
    EXPECT_NE(uppercased.find("o.order_id"), std::string::npos);
    EXPECT_NE(uppercased.find("dbo.orders"), std::string::npos);
}

TEST_F(SQLFormatterTest, UppercaseFollowedByFormat) {
    std::string sql = "select o.order_id from dbo.orders o where o.deleted_at is null";

    // First uppercase
    auto uppercased = formatter.uppercaseKeywords(sql);

    // Then format
    SQLFormatter::FormatOptions options;
    auto formatted = formatter.format(uppercased, options);

    // Should have both uppercase keywords AND formatting preserved
    EXPECT_NE(formatted.find("SELECT"), std::string::npos);
    EXPECT_NE(formatted.find("FROM"), std::string::npos);
    EXPECT_NE(formatted.find("WHERE"), std::string::npos);
    EXPECT_NE(formatted.find("IS"), std::string::npos);
    EXPECT_NE(formatted.find("NULL"), std::string::npos);

    // Identifiers should remain lowercase
    EXPECT_NE(formatted.find("o.order_id"), std::string::npos);
    EXPECT_NE(formatted.find("dbo.orders"), std::string::npos);
}

TEST_F(SQLFormatterTest, FormatsWithUppercaseKeywordsAndProperStructure) {
    std::string sql = "select o.order_id,o.factory_id,f.name as factory_name from dbo.orders o "
                      "inner join dbo.factories f on f.id=o.factory_id where o.deleted_at is null "
                      "and o.status in('pending','processing')";

    SQLFormatter::FormatOptions options;
    std::string formatted = formatter.format(sql, options);

    // Print for manual inspection
    std::cout << "\n=== Formatted SQL Output ===\n" << formatted << "\n=== End ===\n" << std::endl;

    // Verify uppercase keywords
    EXPECT_NE(formatted.find("SELECT"), std::string::npos);
    EXPECT_NE(formatted.find("FROM"), std::string::npos);
    EXPECT_NE(formatted.find("INNER JOIN"), std::string::npos);
    EXPECT_NE(formatted.find("WHERE"), std::string::npos);
    EXPECT_NE(formatted.find("AND"), std::string::npos);
    EXPECT_NE(formatted.find("IS NULL"), std::string::npos);
    EXPECT_NE(formatted.find("IN"), std::string::npos);

    // Verify identifiers remain lowercase
    EXPECT_NE(formatted.find("o.order_id"), std::string::npos);
    EXPECT_NE(formatted.find("dbo.orders"), std::string::npos);
    EXPECT_NE(formatted.find("f.name"), std::string::npos);

    // Verify structure: JOIN should be indented
    EXPECT_NE(formatted.find("  INNER JOIN"), std::string::npos) << "JOIN should be indented with 2 spaces";

    // Verify line breaks exist (major clauses on separate lines)
    size_t selectPos = formatted.find("SELECT");
    size_t fromPos = formatted.find("FROM");
    size_t wherePos = formatted.find("WHERE");

    ASSERT_NE(selectPos, std::string::npos);
    ASSERT_NE(fromPos, std::string::npos);
    ASSERT_NE(wherePos, std::string::npos);

    // There should be newlines between major clauses
    std::string selectToFrom = formatted.substr(selectPos, fromPos - selectPos);
    std::string fromToWhere = formatted.substr(fromPos, wherePos - fromPos);

    EXPECT_NE(selectToFrom.find('\n'), std::string::npos) << "Should have newline between SELECT and FROM";
    EXPECT_NE(fromToWhere.find('\n'), std::string::npos) << "Should have newline between FROM and WHERE";
}

TEST_F(SQLFormatterTest, FormatsVeryComplexQuery) {
    std::string sql =
        "select u.user_id,u.username,u.email,u.created_at,"
        "case when u.status='active' then 'Active' when u.status='pending' then 'Pending' else 'Inactive' end as status_label,"
        "o.order_id,o.order_date,o.total_amount,oi.product_name,oi.quantity,oi.unit_price,"
        "(select count(*) from reviews r where r.user_id=u.user_id) as review_count "
        "from users u "
        "inner join orders o on u.user_id=o.user_id "
        "left join order_items oi on o.order_id=oi.order_id "
        "left join products p on oi.product_id=p.product_id "
        "where u.created_at>='2024-01-01' and u.status in ('active','pending') "
        "and (o.total_amount>10000 or u.premium_member=1) "
        "and p.category_id in (select category_id from categories where parent_id=5) "
        "group by u.user_id,u.username,u.email,u.created_at,u.status,o.order_id,o.order_date,o.total_amount,oi.product_name,oi.quantity,oi.unit_price "
        "having sum(oi.quantity*oi.unit_price)>5000 "
        "order by o.order_date desc,u.username asc";

    std::string formatted = formatter.format(sql);

    // Print the formatted SQL for manual inspection
    std::cout << "\n=== Formatted Complex SQL ===\n" << formatted << "\n=== End ===\n" << std::endl;

    // Basic checks
    EXPECT_NE(formatted.find("SELECT"), std::string::npos);
    EXPECT_NE(formatted.find("FROM"), std::string::npos);
    EXPECT_NE(formatted.find("INNER JOIN"), std::string::npos);
    EXPECT_NE(formatted.find("LEFT JOIN"), std::string::npos);
    EXPECT_NE(formatted.find("WHERE"), std::string::npos);
    EXPECT_NE(formatted.find("GROUP BY"), std::string::npos);
    EXPECT_NE(formatted.find("HAVING"), std::string::npos);
    EXPECT_NE(formatted.find("ORDER BY"), std::string::npos);
    EXPECT_NE(formatted.find("CASE"), std::string::npos);
}

}  // namespace test
}  // namespace predategrip
