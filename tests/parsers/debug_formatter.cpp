#include <iostream>
#include "parsers/sql_formatter.h"

int main() {
    predategrip::SQLFormatter formatter;

    // Test 1: Lowercase keywords
    std::cout << "=== Test 1: Lowercase Keywords ===" << std::endl;
    predategrip::SQLFormatter::FormatOptions options1;
    options1.keywordCase = predategrip::KeywordCase::Lower;
    std::string sql1 = "SELECT id, name FROM users WHERE active=1";
    std::string formatted1 = formatter.format(sql1, options1);
    std::cout << "Input:  " << sql1 << std::endl;
    std::cout << "Output: " << formatted1 << std::endl;
    std::cout << "Has 'select': " << (formatted1.find("select") != std::string::npos ? "YES" : "NO") << std::endl;
    std::cout << "Has 'from': " << (formatted1.find("from") != std::string::npos ? "YES" : "NO") << std::endl;
    std::cout << std::endl;

    // Test 2: COUNT(*)
    std::cout << "=== Test 2: COUNT(*) ===" << std::endl;
    std::string sql2 = "SELECT COUNT(*), SUM(amount) FROM orders";
    std::string formatted2 = formatter.format(sql2);
    std::cout << "Input:  " << sql2 << std::endl;
    std::cout << "Output: " << formatted2 << std::endl;
    std::cout << "Has 'COUNT(*)': " << (formatted2.find("COUNT(*)") != std::string::npos ? "YES" : "NO") << std::endl;
    std::cout << std::endl;

    // Test 3: Complex query
    std::cout << "=== Test 3: Complex Query ===" << std::endl;
    std::string sql3 =
        "select u.user_id,u.username from users u "
        "inner join orders o on u.id=o.user_id "
        "where u.active=1 and o.total>100 "
        "order by o.order_date desc";
    std::string formatted3 = formatter.format(sql3);
    std::cout << formatted3 << std::endl;

    return 0;
}
