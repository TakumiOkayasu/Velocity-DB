#include "sql_formatter.h"

#include <algorithm>
#include <cctype>
#include <ranges>
#include <unordered_set>

namespace predategrip {

namespace {

const std::unordered_set<std::string> SQL_KEYWORDS = {
    "SELECT",     "FROM",        "WHERE",     "AND",     "OR",       "NOT",        "IN",         "EXISTS",     "JOIN",      "INNER", "LEFT",      "RIGHT",   "OUTER",   "FULL",
    "CROSS",      "ON",          "GROUP",     "BY",      "HAVING",   "ORDER",      "ASC",        "DESC",       "NULLS",     "FIRST", "LAST",      "INSERT",  "INTO",    "VALUES",
    "UPDATE",     "SET",         "DELETE",    "CREATE",  "TABLE",    "INDEX",      "VIEW",       "DROP",       "ALTER",     "ADD",   "COLUMN",    "PRIMARY", "KEY",     "FOREIGN",
    "REFERENCES", "UNIQUE",      "CHECK",     "DEFAULT", "NULL",     "CONSTRAINT", "CASCADE",    "RESTRICT",   "UNION",     "ALL",   "INTERSECT", "EXCEPT",  "CASE",    "WHEN",
    "THEN",       "ELSE",        "END",       "AS",      "DISTINCT", "TOP",        "LIMIT",      "OFFSET",     "FETCH",     "NEXT",  "ROWS",      "ONLY",    "BEGIN",   "COMMIT",
    "ROLLBACK",   "TRANSACTION", "SAVEPOINT", "DECLARE", "CURSOR",   "OPEN",       "CLOSE",      "DEALLOCATE", "IF",        "WHILE", "RETURN",    "EXEC",    "EXECUTE", "PROCEDURE",
    "FUNCTION",   "WITH",        "RECURSIVE", "CTE",     "LIKE",     "BETWEEN",    "IS",         "SOME",       "ANY",       "COUNT", "SUM",       "AVG",     "MIN",     "MAX",
    "COALESCE",   "NULLIF",      "CAST",      "CONVERT", "OVER",     "PARTITION",  "ROW_NUMBER", "RANK",       "DENSE_RANK"};

const std::unordered_set<std::string> BLOCK_START_KEYWORDS = {"SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "SET", "VALUES"};

}  // namespace

std::string SQLFormatter::format(std::string_view sql, const FormatOptions& options) {
    std::string result;
    result.reserve(sql.size() * 2);

    std::string token;
    int indentLevel = 0;
    bool newLine = true;
    bool inString = false;
    char stringChar = 0;

    auto flushToken = [&]() {
        if (token.empty())
            return;

        std::string upperToken = token;
        std::ranges::transform(upperToken, upperToken.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });

        if (isKeyword(upperToken)) {
            if (BLOCK_START_KEYWORDS.contains(upperToken) && !newLine) {
                result += '\n';
                result += getIndent(indentLevel, options);
                newLine = true;
            }
            result += applyKeywordCase(token, options.keywordCase);
        } else {
            result += token;
        }

        result += ' ';
        token.clear();
        newLine = false;
    };

    for (size_t i = 0; i < sql.length(); ++i) {
        char c = sql[i];

        if ((c == '\'' || c == '"') && !inString) {
            flushToken();
            inString = true;
            stringChar = c;
            result += c;
            continue;
        }

        if (inString) {
            result += c;
            if (c == stringChar) {
                if (i + 1 < sql.length() && sql[i + 1] == stringChar) {
                    result += sql[++i];
                } else {
                    inString = false;
                }
            }
            continue;
        }

        if (c == '(') {
            flushToken();
            result += c;
            ++indentLevel;
            continue;
        }

        if (c == ')') {
            flushToken();
            indentLevel = std::max(0, indentLevel - 1);
            result += c;
            continue;
        }

        if (c == ',') {
            flushToken();
            if (options.breakBeforeComma) {
                result += '\n';
                result += getIndent(indentLevel, options);
                result += ", ";
            } else if (options.breakAfterComma) {
                result += ",\n";
                result += getIndent(indentLevel, options);
            } else {
                result += ", ";
            }
            newLine = options.breakAfterComma;
            continue;
        }

        if (std::isspace(static_cast<unsigned char>(c))) {
            if (!token.empty()) {
                flushToken();
            }
            continue;
        }

        if (c == '=' || c == '<' || c == '>' || c == '+' || c == '-' || c == '*' || c == '/') {
            flushToken();
            result += ' ';
            result += c;

            if (i + 1 < sql.length()) {
                char next = sql[i + 1];
                if ((c == '<' && (next == '=' || next == '>')) || (c == '>' && next == '=') || (c == '!' && next == '=')) {
                    result += next;
                    ++i;
                }
            }

            result += ' ';
            continue;
        }

        if (c == ';') {
            flushToken();
            result += ";\n\n";
            indentLevel = 0;
            newLine = true;
            continue;
        }

        token += c;
    }

    flushToken();

    while (!result.empty() && std::isspace(static_cast<unsigned char>(result.back()))) {
        result.pop_back();
    }

    return result;
}

std::string SQLFormatter::applyKeywordCase(std::string_view word, KeywordCase keywordCase) const {
    std::string result(word);

    switch (keywordCase) {
        case KeywordCase::Upper:
            std::ranges::transform(result, result.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
            break;
        case KeywordCase::Lower:
            std::ranges::transform(result, result.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            break;
        case KeywordCase::Unchanged:
            break;
    }

    return result;
}

bool SQLFormatter::isKeyword(std::string_view word) {
    std::string upper(word);
    std::ranges::transform(upper, upper.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
    return SQL_KEYWORDS.contains(upper);
}

std::string SQLFormatter::getIndent(int level, const FormatOptions& options) {
    if (options.useTab) {
        return std::string(static_cast<size_t>(level), '\t');
    }
    return std::string(static_cast<size_t>(level * options.indentSize), ' ');
}

}  // namespace predategrip
