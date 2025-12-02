#include "sql_formatter.h"
#include <sstream>
#include <algorithm>
#include <cctype>
#include <unordered_set>

namespace predategrip {

namespace {
    const std::unordered_set<std::string> SQL_KEYWORDS = {
        "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "EXISTS",
        "JOIN", "INNER", "LEFT", "RIGHT", "OUTER", "FULL", "CROSS", "ON",
        "GROUP", "BY", "HAVING", "ORDER", "ASC", "DESC", "NULLS", "FIRST", "LAST",
        "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
        "CREATE", "TABLE", "INDEX", "VIEW", "DROP", "ALTER", "ADD", "COLUMN",
        "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "CHECK", "DEFAULT",
        "NULL", "NOT", "CONSTRAINT", "CASCADE", "RESTRICT",
        "UNION", "ALL", "INTERSECT", "EXCEPT",
        "CASE", "WHEN", "THEN", "ELSE", "END",
        "AS", "DISTINCT", "TOP", "LIMIT", "OFFSET", "FETCH", "NEXT", "ROWS", "ONLY",
        "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION", "SAVEPOINT",
        "DECLARE", "CURSOR", "OPEN", "CLOSE", "DEALLOCATE",
        "IF", "WHILE", "RETURN", "EXEC", "EXECUTE", "PROCEDURE", "FUNCTION",
        "WITH", "RECURSIVE", "CTE",
        "LIKE", "BETWEEN", "IS", "SOME", "ANY",
        "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF",
        "CAST", "CONVERT", "OVER", "PARTITION", "ROW_NUMBER", "RANK", "DENSE_RANK"
    };

    const std::unordered_set<std::string> BLOCK_START_KEYWORDS = {
        "SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER",
        "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
        "SET", "VALUES"
    };
}

std::string SQLFormatter::format(const std::string& sql, const FormatOptions& options) {
    std::ostringstream result;
    std::string token;
    int indentLevel = 0;
    bool newLine = true;
    bool inString = false;
    char stringChar = 0;

    auto flushToken = [&]() {
        if (token.empty()) return;

        std::string upperToken = token;
        std::transform(upperToken.begin(), upperToken.end(), upperToken.begin(), ::toupper);

        if (isKeyword(upperToken)) {
            // Check if we need a new line before this keyword
            if (BLOCK_START_KEYWORDS.count(upperToken) && !newLine) {
                result << "\n" << getIndent(indentLevel, options);
                newLine = true;
            }

            result << applyKeywordCase(token, options.keywordCase);
        } else {
            result << token;
        }

        result << " ";
        token.clear();
        newLine = false;
    };

    for (size_t i = 0; i < sql.length(); ++i) {
        char c = sql[i];

        // Handle strings
        if ((c == '\'' || c == '"') && !inString) {
            flushToken();
            inString = true;
            stringChar = c;
            result << c;
            continue;
        }

        if (inString) {
            result << c;
            if (c == stringChar) {
                // Check for escaped quote
                if (i + 1 < sql.length() && sql[i + 1] == stringChar) {
                    result << sql[++i];
                } else {
                    inString = false;
                }
            }
            continue;
        }

        // Handle parentheses
        if (c == '(') {
            flushToken();
            result << c;
            indentLevel++;
            continue;
        }

        if (c == ')') {
            flushToken();
            indentLevel = std::max(0, indentLevel - 1);
            result << c;
            continue;
        }

        // Handle commas
        if (c == ',') {
            flushToken();
            if (options.breakBeforeComma) {
                result << "\n" << getIndent(indentLevel, options) << c << " ";
            } else if (options.breakAfterComma) {
                result << c << "\n" << getIndent(indentLevel, options);
            } else {
                result << c << " ";
            }
            newLine = options.breakAfterComma;
            continue;
        }

        // Handle whitespace
        if (std::isspace(c)) {
            if (!token.empty()) {
                flushToken();
            }
            continue;
        }

        // Handle operators
        if (c == '=' || c == '<' || c == '>' || c == '+' || c == '-' || c == '*' || c == '/') {
            flushToken();
            result << " " << c;

            // Handle multi-character operators
            if (i + 1 < sql.length()) {
                char next = sql[i + 1];
                if ((c == '<' && (next == '=' || next == '>')) ||
                    (c == '>' && next == '=') ||
                    (c == '!' && next == '=')) {
                    result << next;
                    ++i;
                }
            }

            result << " ";
            continue;
        }

        // Handle semicolon
        if (c == ';') {
            flushToken();
            result << c << "\n\n";
            indentLevel = 0;
            newLine = true;
            continue;
        }

        token += c;
    }

    flushToken();

    // Trim trailing whitespace
    std::string formatted = result.str();
    while (!formatted.empty() && std::isspace(formatted.back())) {
        formatted.pop_back();
    }

    return formatted;
}

std::string SQLFormatter::applyKeywordCase(const std::string& word, KeywordCase keywordCase) const {
    std::string result = word;

    switch (keywordCase) {
        case KeywordCase::Upper:
            std::transform(result.begin(), result.end(), result.begin(), ::toupper);
            break;
        case KeywordCase::Lower:
            std::transform(result.begin(), result.end(), result.begin(), ::tolower);
            break;
        case KeywordCase::Unchanged:
            break;
    }

    return result;
}

bool SQLFormatter::isKeyword(const std::string& word) const {
    std::string upper = word;
    std::transform(upper.begin(), upper.end(), upper.begin(), ::toupper);
    return SQL_KEYWORDS.count(upper) > 0;
}

std::string SQLFormatter::getIndent(int level, const FormatOptions& options) const {
    if (options.useTab) {
        return std::string(level, '\t');
    }
    return std::string(level * options.indentSize, ' ');
}

}  // namespace predategrip
