#pragma once

/// Common SQL escaping utilities shared across all dialects.
/// Dialect-specific LIKE escaping remains in each dialect's anonymous namespace.

#include <string>
#include <string_view>

namespace velocitydb {

/// SQL string literal escaping: single quote doubled (' -> '')
[[nodiscard]] inline std::string escapeSql(std::string_view value) {
    std::string result;
    result.reserve(value.size());
    for (char c : value) {
        if (c == '\'')
            result += "''";
        else
            result += c;
    }
    return result;
}

/// Check if SQL contains ORDER BY outside of string literals and comments.
/// Handles: single-quoted strings (incl. escaped ''), -- line comments, /* */ block comments.
[[nodiscard]] inline bool hasOrderByOutsideQuotes(std::string_view sql) {
    std::string upper;
    upper.reserve(sql.size());
    for (size_t i = 0; i < sql.size(); ++i) {
        char c = sql[i];
        if (c == '\'') {
            // Skip single-quoted string ('' is escaped quote, not end)
            upper += ' ';
            for (++i; i < sql.size(); ++i) {
                if (sql[i] == '\'' && (i + 1 >= sql.size() || sql[i + 1] != '\''))
                    break;
                if (sql[i] == '\'')
                    ++i;  // skip escaped ''
            }
        } else if (c == '-' && i + 1 < sql.size() && sql[i + 1] == '-') {
            // Skip -- line comment
            for (i += 2; i < sql.size() && sql[i] != '\n'; ++i)
                upper += ' ';
        } else if (c == '/' && i + 1 < sql.size() && sql[i + 1] == '*') {
            // Skip /* block comment */
            for (i += 2; i < sql.size(); ++i) {
                if (sql[i] == '*' && i + 1 < sql.size() && sql[i + 1] == '/') {
                    ++i;
                    break;
                }
                upper += ' ';
            }
        } else {
            upper += static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        }
    }
    return upper.rfind("ORDER BY") != std::string::npos;
}

}  // namespace velocitydb
