#include "sql_parser.h"

#include <algorithm>
#include <cctype>
#include <regex>

namespace predategrip {

std::string_view SQLParser::trim(std::string_view str) {
    // Trim leading whitespace
    auto start = str.begin();
    while (start != str.end() && std::isspace(static_cast<unsigned char>(*start))) {
        ++start;
    }

    // Trim trailing whitespace
    auto end = str.end();
    while (end != start && std::isspace(static_cast<unsigned char>(*(end - 1)))) {
        --end;
    }

    // Calculate offset and length
    size_t offset = start - str.begin();
    size_t length = end - start;

    return str.substr(offset, length);
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
    std::string upperSQL = toUpper(trimmedSQL);

    // Check for USE statement using regex
    // Pattern: USE <database_name> (with optional semicolon)
    static const std::regex usePattern(R"(^\s*USE\s+(\[?[\w]+\]?)\s*;?\s*$)", std::regex::icase);

    std::smatch match;
    std::string sqlStr(trimmedSQL);

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
    ParsedSQL parsed = parseSQL(sql);
    return parsed.type == "USE";
}

std::string SQLParser::extractDatabaseName(std::string_view sql) {
    ParsedSQL parsed = parseSQL(sql);
    return parsed.database;
}

std::vector<std::string> SQLParser::splitStatements(std::string_view sql) {
    std::vector<std::string> statements;
    std::string current;

    for (char ch : sql) {
        if (ch == ';') {
            // Found semicolon - end of statement
            std::string_view trimmed = trim(current);
            if (!trimmed.empty()) {
                statements.push_back(std::string(trimmed));
            }
            current.clear();
        } else {
            current += ch;
        }
    }

    // Add last statement if no trailing semicolon
    std::string_view trimmed = trim(current);
    if (!trimmed.empty()) {
        statements.push_back(std::string(trimmed));
    }

    return statements;
}

}  // namespace predategrip
