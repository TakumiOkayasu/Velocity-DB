#include "sql_formatter.h"

#include <algorithm>
#include <cctype>
#include <ranges>
#include <sstream>
#include <unordered_set>
#include <vector>

namespace predategrip {

namespace {

const std::unordered_set<std::string> SQL_KEYWORDS = {
    "SELECT", "FROM",  "WHERE",  "AND",     "OR",    "NOT",     "IN",     "EXISTS", "JOIN",    "INNER",   "LEFT",   "RIGHT",    "OUTER",  "FULL",   "CROSS",  "ON",    "GROUP", "BY",
    "HAVING", "ORDER", "ASC",    "DESC",    "NULLS", "FIRST",   "LAST",   "INSERT", "INTO",    "VALUES",  "UPDATE", "SET",      "DELETE", "CREATE", "TABLE",  "INDEX", "VIEW",  "DROP",
    "ALTER",  "ADD",   "COLUMN", "PRIMARY", "KEY",   "FOREIGN", "UNIQUE", "CHECK",  "DEFAULT", "NULL",    "AS",     "DISTINCT", "TOP",    "LIMIT",  "OFFSET", "FETCH", "NEXT",  "ROWS",
    "ONLY",   "UNION", "ALL",    "CASE",    "WHEN",  "THEN",    "ELSE",   "END",    "LIKE",    "BETWEEN", "IS",     "COUNT",    "SUM",    "AVG",    "MIN",    "MAX",   "OVER",  "PARTITION"};

const std::unordered_set<std::string> MAJOR_CLAUSES = {"SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "UNION", "INTERSECT", "EXCEPT"};

const std::unordered_set<std::string> JOIN_KEYWORDS = {"JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER"};

enum class TokenType { Keyword, Identifier, Operator, Comma, OpenParen, CloseParen, Semicolon, String, Number };

struct Token {
    TokenType type;
    std::string value;
    std::string upperValue;
};

class Tokenizer {
public:
    explicit Tokenizer(std::string_view sql) : m_sql(sql), m_pos(0) {}

    std::vector<Token> tokenize() {
        std::vector<Token> tokens;
        while (m_pos < m_sql.length()) {
            skipWhitespace();
            if (m_pos >= m_sql.length())
                break;

            char c = m_sql[m_pos];

            if (c == '\'' || c == '"') {
                tokens.push_back(readString());
            } else if (c == '(') {
                tokens.push_back({TokenType::OpenParen, "(", "("});
                ++m_pos;
            } else if (c == ')') {
                tokens.push_back({TokenType::CloseParen, ")", ")"});
                ++m_pos;
            } else if (c == ',') {
                tokens.push_back({TokenType::Comma, ",", ","});
                ++m_pos;
            } else if (c == ';') {
                tokens.push_back({TokenType::Semicolon, ";", ";"});
                ++m_pos;
            } else if (isOperatorChar(c)) {
                tokens.push_back(readOperator());
            } else if (std::isdigit(static_cast<unsigned char>(c))) {
                tokens.push_back(readNumber());
            } else {
                tokens.push_back(readWord());
            }
        }
        return tokens;
    }

private:
    std::string_view m_sql;
    size_t m_pos;

    void skipWhitespace() {
        while (m_pos < m_sql.length() && std::isspace(static_cast<unsigned char>(m_sql[m_pos]))) {
            ++m_pos;
        }
    }

    Token readString() {
        char quote = m_sql[m_pos];
        std::string value;
        value += quote;
        ++m_pos;

        while (m_pos < m_sql.length()) {
            char c = m_sql[m_pos];
            value += c;
            ++m_pos;

            if (c == quote) {
                if (m_pos < m_sql.length() && m_sql[m_pos] == quote) {
                    value += quote;
                    ++m_pos;
                } else {
                    break;
                }
            }
        }

        return {TokenType::String, value, value};
    }

    Token readNumber() {
        std::string value;
        while (m_pos < m_sql.length() && (std::isdigit(static_cast<unsigned char>(m_sql[m_pos])) || m_sql[m_pos] == '.')) {
            value += m_sql[m_pos];
            ++m_pos;
        }
        return {TokenType::Number, value, value};
    }

    Token readWord() {
        std::string value;
        while (m_pos < m_sql.length() && (std::isalnum(static_cast<unsigned char>(m_sql[m_pos])) || m_sql[m_pos] == '_' || m_sql[m_pos] == '.')) {
            value += m_sql[m_pos];
            ++m_pos;
        }

        std::string upper = value;
        std::ranges::transform(upper, upper.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });

        TokenType type = SQL_KEYWORDS.contains(upper) ? TokenType::Keyword : TokenType::Identifier;
        return {type, value, upper};
    }

    bool isOperatorChar(char c) const { return c == '=' || c == '<' || c == '>' || c == '+' || c == '-' || c == '*' || c == '/' || c == '!'; }

    Token readOperator() {
        std::string value;
        value += m_sql[m_pos];
        ++m_pos;

        if (m_pos < m_sql.length()) {
            char next = m_sql[m_pos];
            if ((value[0] == '<' && (next == '=' || next == '>')) || (value[0] == '>' && next == '=') || (value[0] == '!' && next == '=')) {
                value += next;
                ++m_pos;
            }
        }

        return {TokenType::Operator, value, value};
    }
};

class SQLFormatterImpl {
public:
    explicit SQLFormatterImpl(const SQLFormatter::FormatOptions& options) : m_options(options) {}

    std::string format(const std::vector<Token>& tokens) {
        m_result.clear();
        m_indentLevel = 0;
        m_pos = 0;
        m_tokens = tokens;

        while (m_pos < m_tokens.size()) {
            formatStatement();
        }

        // Trim trailing whitespace
        while (!m_result.empty() && std::isspace(static_cast<unsigned char>(m_result.back()))) {
            m_result.pop_back();
        }

        return m_result;
    }

private:
    const SQLFormatter::FormatOptions& m_options;
    std::string m_result;
    int m_indentLevel;
    size_t m_pos;
    std::vector<Token> m_tokens;

    void formatStatement() {
        if (m_pos >= m_tokens.size())
            return;

        const auto& token = m_tokens[m_pos];

        if (token.type == TokenType::Keyword && token.upperValue == "SELECT") {
            formatSelectStatement();
        } else {
            // Fallback: just output the token
            appendToken(token);
            ++m_pos;
        }

        // Handle semicolon
        if (m_pos < m_tokens.size() && m_tokens[m_pos].type == TokenType::Semicolon) {
            m_result += ";\n\n";
            ++m_pos;
        }
    }

    void formatSelectStatement() {
        formatSelectClause();
        formatFromClause();
        formatWhereClause();
        formatGroupByClause();
        formatHavingClause();
        formatOrderByClause();
    }

    void formatSelectClause() {
        if (m_pos >= m_tokens.size() || m_tokens[m_pos].upperValue != "SELECT")
            return;

        appendToken(m_tokens[m_pos]);
        m_result += ' ';
        ++m_pos;

        // Handle DISTINCT
        if (m_pos < m_tokens.size() && m_tokens[m_pos].upperValue == "DISTINCT") {
            appendToken(m_tokens[m_pos]);
            m_result += ' ';
            ++m_pos;
        }

        // Collect all select items until FROM/WHERE/GROUP/ORDER
        std::vector<std::string> selectItems;
        std::string currentItem;
        int parenDepth = 0;

        while (m_pos < m_tokens.size()) {
            const auto& token = m_tokens[m_pos];

            if (parenDepth == 0 && token.type == TokenType::Keyword && MAJOR_CLAUSES.contains(token.upperValue)) {
                break;
            }

            if (token.type == TokenType::OpenParen) {
                ++parenDepth;
                currentItem += token.value;
            } else if (token.type == TokenType::CloseParen) {
                --parenDepth;
                currentItem += token.value;
            } else if (parenDepth == 0 && token.type == TokenType::Comma) {
                selectItems.push_back(currentItem);
                currentItem.clear();
            } else {
                // Add space before token if needed (not after '(' or at the start)
                if (!currentItem.empty() && !std::isspace(static_cast<unsigned char>(currentItem.back())) && currentItem.back() != '(') {
                    currentItem += ' ';
                }
                currentItem += formatToken(token);
            }

            ++m_pos;
        }

        if (!currentItem.empty()) {
            selectItems.push_back(currentItem);
        }

        // Output select items with alignment
        for (size_t i = 0; i < selectItems.size(); ++i) {
            if (i > 0) {
                m_result += ",\n" + getIndent(1);
            }
            m_result += trim(selectItems[i]);
        }
        m_result += '\n';
    }

    void formatFromClause() {
        if (m_pos >= m_tokens.size() || m_tokens[m_pos].upperValue != "FROM")
            return;

        appendToken(m_tokens[m_pos]);
        m_result += ' ';
        ++m_pos;

        // First table
        while (m_pos < m_tokens.size()) {
            const auto& token = m_tokens[m_pos];

            if (token.type == TokenType::Keyword && (JOIN_KEYWORDS.contains(token.upperValue) || MAJOR_CLAUSES.contains(token.upperValue))) {
                break;
            }

            m_result += formatToken(token);
            m_result += ' ';
            ++m_pos;
        }

        m_result += '\n';

        // JOINs
        while (m_pos < m_tokens.size() && m_tokens[m_pos].type == TokenType::Keyword) {
            const auto& token = m_tokens[m_pos];

            if (!JOIN_KEYWORDS.contains(token.upperValue))
                break;

            m_result += getIndent(1);

            // JOIN keywords (INNER JOIN, LEFT JOIN, etc.)
            while (m_pos < m_tokens.size() && JOIN_KEYWORDS.contains(m_tokens[m_pos].upperValue)) {
                m_result += formatToken(m_tokens[m_pos]);
                m_result += ' ';
                ++m_pos;
            }

            // Table name and alias
            while (m_pos < m_tokens.size()) {
                const auto& t = m_tokens[m_pos];

                if (t.type == TokenType::Keyword && (t.upperValue == "ON" || JOIN_KEYWORDS.contains(t.upperValue) || MAJOR_CLAUSES.contains(t.upperValue))) {
                    break;
                }

                m_result += formatToken(t);
                m_result += ' ';
                ++m_pos;
            }

            // ON condition
            if (m_pos < m_tokens.size() && m_tokens[m_pos].upperValue == "ON") {
                appendToken(m_tokens[m_pos]);
                m_result += ' ';
                ++m_pos;

                while (m_pos < m_tokens.size()) {
                    const auto& t = m_tokens[m_pos];

                    if (t.type == TokenType::Keyword && (JOIN_KEYWORDS.contains(t.upperValue) || MAJOR_CLAUSES.contains(t.upperValue))) {
                        break;
                    }

                    m_result += formatToken(t);
                    m_result += ' ';
                    ++m_pos;
                }
            }

            m_result += '\n';
        }
    }

    void formatWhereClause() {
        if (m_pos >= m_tokens.size() || m_tokens[m_pos].upperValue != "WHERE")
            return;

        appendToken(m_tokens[m_pos]);
        m_result += ' ';
        ++m_pos;

        bool firstCondition = true;
        int parenDepth = 0;

        while (m_pos < m_tokens.size()) {
            const auto& token = m_tokens[m_pos];

            if (parenDepth == 0 && token.type == TokenType::Keyword && MAJOR_CLAUSES.contains(token.upperValue)) {
                break;
            }

            if (token.type == TokenType::OpenParen) {
                ++parenDepth;
                m_result += token.value;
            } else if (token.type == TokenType::CloseParen) {
                --parenDepth;
                m_result += token.value;
            } else if (parenDepth == 0 && token.type == TokenType::Keyword && (token.upperValue == "AND" || token.upperValue == "OR")) {
                m_result += "\n  " + formatToken(token) + ' ';
                firstCondition = false;
            } else {
                m_result += formatToken(token);
                m_result += ' ';
            }

            ++m_pos;
        }

        m_result += '\n';
    }

    void formatGroupByClause() {
        if (m_pos >= m_tokens.size() || m_tokens[m_pos].upperValue != "GROUP")
            return;

        appendToken(m_tokens[m_pos]);
        m_result += ' ';
        ++m_pos;

        // Skip BY
        if (m_pos < m_tokens.size() && m_tokens[m_pos].upperValue == "BY") {
            appendToken(m_tokens[m_pos]);
            m_result += ' ';
            ++m_pos;
        }

        while (m_pos < m_tokens.size()) {
            const auto& token = m_tokens[m_pos];

            if (token.type == TokenType::Keyword && MAJOR_CLAUSES.contains(token.upperValue)) {
                break;
            }

            appendTokenWithSpace(token);
            ++m_pos;
        }

        m_result += '\n';
    }

    void formatHavingClause() {
        if (m_pos >= m_tokens.size() || m_tokens[m_pos].upperValue != "HAVING")
            return;

        appendToken(m_tokens[m_pos]);
        m_result += ' ';
        ++m_pos;

        while (m_pos < m_tokens.size()) {
            const auto& token = m_tokens[m_pos];

            if (token.type == TokenType::Keyword && MAJOR_CLAUSES.contains(token.upperValue)) {
                break;
            }

            appendTokenWithSpace(token);
            ++m_pos;
        }

        m_result += '\n';
    }

    void formatOrderByClause() {
        if (m_pos >= m_tokens.size() || m_tokens[m_pos].upperValue != "ORDER")
            return;

        appendToken(m_tokens[m_pos]);
        m_result += ' ';
        ++m_pos;

        // Skip BY
        if (m_pos < m_tokens.size() && m_tokens[m_pos].upperValue == "BY") {
            appendToken(m_tokens[m_pos]);
            m_result += ' ';
            ++m_pos;
        }

        while (m_pos < m_tokens.size()) {
            const auto& token = m_tokens[m_pos];

            if (token.type == TokenType::Keyword && MAJOR_CLAUSES.contains(token.upperValue)) {
                break;
            }

            appendTokenWithSpace(token);
            ++m_pos;
        }

        m_result += '\n';
    }

    std::string formatToken(const Token& token) const {
        if (token.type == TokenType::Keyword) {
            return applyKeywordCase(token.value);
        }
        return token.value;
    }

    void appendToken(const Token& token) { m_result += formatToken(token); }

    bool needsSpaceAfter(const Token& token) const {
        // Don't add space after open paren or before close paren
        return token.type != TokenType::OpenParen;
    }

    bool needsSpaceBefore(const Token& token) const {
        // Don't add space before close paren or comma
        return token.type != TokenType::CloseParen && token.type != TokenType::Comma;
    }

    void appendTokenWithSpace(const Token& token, bool addSpaceAfter = true) {
        m_result += formatToken(token);
        if (addSpaceAfter && needsSpaceAfter(token)) {
            m_result += ' ';
        }
    }

    std::string applyKeywordCase(std::string_view word) const {
        std::string result(word);
        switch (m_options.keywordCase) {
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

    std::string getIndent(int level) const {
        if (m_options.useTab) {
            return std::string(static_cast<size_t>(level), '\t');
        }
        return std::string(static_cast<size_t>(level * m_options.indentSize), ' ');
    }

    std::string trim(const std::string& str) const {
        auto start = str.find_first_not_of(" \t\n\r");
        if (start == std::string::npos)
            return "";
        auto end = str.find_last_not_of(" \t\n\r");
        return str.substr(start, end - start + 1);
    }
};

}  // namespace

std::string SQLFormatter::format(std::string_view sql, const FormatOptions& options) {
    Tokenizer tokenizer(sql);
    auto tokens = tokenizer.tokenize();

    SQLFormatterImpl formatter(options);
    return formatter.format(tokens);
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
