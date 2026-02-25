#include "sql_parser.h"

#include <algorithm>
#include <cctype>
#include <ranges>
#include <regex>

namespace velocitydb {

std::string_view SQLParser::trim(std::string_view str) {
    constexpr auto isSpace = [](unsigned char c) { return std::isspace(c) != 0; };
    auto start = std::ranges::find_if_not(str, isSpace);
    auto end = std::ranges::find_if_not(str | std::views::reverse, isSpace).base();
    if (start >= end)
        return {};
    return str.substr(start - str.begin(), end - start);
}

std::string SQLParser::toUpper(std::string_view str) {
    std::string result(str);
    std::transform(result.begin(), result.end(), result.begin(), [](unsigned char c) { return std::toupper(c); });
    return result;
}

ParsedSQL SQLParser::parseSQL(std::string_view sql) {
    ParsedSQL result;
    result.originalSQL = std::string(sql);

    // Trim whitespace
    std::string_view trimmedSQL = trim(sql);
    if (trimmedSQL.empty()) {
        result.type = "EMPTY";
        return result;
    }

    // Convert to uppercase for case-insensitive matching
    auto upperSQL = toUpper(trimmedSQL);

    // Check for USE statement using regex
    // Pattern: USE <database_name> (with optional semicolon)
    static const std::regex usePattern(R"(^\s*USE\s+(\[?[\w]+\]?)\s*;?\s*$)", std::regex::icase);

    std::smatch match;
    auto sqlStr = std::string(trimmedSQL);

    if (std::regex_match(sqlStr, match, usePattern)) {
        result.type = "USE";
        result.database = match[1].str();

        // Remove brackets if present: [database] -> database
        if (result.database.front() == '[' && result.database.back() == ']') {
            result.database = result.database.substr(1, result.database.length() - 2);
        }

        return result;
    }

    // Detect other common statement types
    if (upperSQL.starts_with("SELECT")) {
        result.type = "SELECT";
    } else if (upperSQL.starts_with("INSERT")) {
        result.type = "INSERT";
    } else if (upperSQL.starts_with("UPDATE")) {
        result.type = "UPDATE";
    } else if (upperSQL.starts_with("DELETE")) {
        result.type = "DELETE";
    } else if (upperSQL.starts_with("CREATE")) {
        result.type = "CREATE";
    } else if (upperSQL.starts_with("ALTER")) {
        result.type = "ALTER";
    } else if (upperSQL.starts_with("DROP")) {
        result.type = "DROP";
    } else if (upperSQL.starts_with("EXEC") || upperSQL.starts_with("EXECUTE")) {
        result.type = "EXECUTE";
    } else if (upperSQL.starts_with("BEGIN")) {
        result.type = "BEGIN";
    } else if (upperSQL.starts_with("COMMIT")) {
        result.type = "COMMIT";
    } else if (upperSQL.starts_with("ROLLBACK")) {
        result.type = "ROLLBACK";
    } else {
        result.type = "OTHER";
    }

    return result;
}

bool SQLParser::isUseStatement(std::string_view sql) {
    auto parsed = parseSQL(sql);
    return parsed.type == "USE";
}

std::string SQLParser::extractDatabaseName(std::string_view sql) {
    auto parsed = parseSQL(sql);
    return parsed.database;
}

bool SQLParser::isReadOnlyQuery(std::string_view sql) {
    auto trimmed = trim(sql);
    constexpr auto ci = [](unsigned char a, unsigned char b) constexpr {
        constexpr auto lo = [](unsigned char c) constexpr -> unsigned char { return (c >= 'A' && c <= 'Z') ? static_cast<unsigned char>(c + 32) : c; };
        return lo(a) == lo(b);
    };
    using namespace std::string_view_literals;
    if (std::ranges::starts_with(trimmed, "select"sv, ci))
        return true;
    if (!std::ranges::starts_with(trimmed, "with"sv, ci))
        return false;
    // WITH ... may be CTE + DML. Check that no INSERT/UPDATE/DELETE/MERGE appears outside string literals.
    // Simple heuristic: find last top-level SELECT/INSERT/UPDATE/DELETE/MERGE keyword.
    auto upper = toUpper(trimmed);
    constexpr std::string_view dmlKeywords[] = {"INSERT", "UPDATE", "DELETE", "MERGE"};
    return std::ranges::none_of(dmlKeywords, [&](auto kw) { return upper.find(kw) != std::string::npos; });
}

std::vector<std::string> SQLParser::splitStatements(std::string_view sql) {
    // Strip psql meta-commands (lines starting with '\')
    // pg_dump output contains client-side commands like \restrict, \connect
    // that cannot be executed via ODBC
    std::string filtered;
    filtered.reserve(sql.size());
    for (auto line : sql | std::views::split('\n')) {
        std::string_view lineView{line.begin(), line.end()};
        auto trimmedLine = trim(lineView);
        if (!trimmedLine.empty() && trimmedLine.front() == '\\') {
            continue;
        }
        filtered.append(lineView);
        filtered.push_back('\n');
    }

    std::vector<std::string> statements;
    for (auto part : std::string_view{filtered} | std::views::split(';')) {
        auto trimmed = trim({part.begin(), part.end()});
        if (!trimmed.empty())
            statements.emplace_back(trimmed);
    }
    return statements;
}

}  // namespace velocitydb
