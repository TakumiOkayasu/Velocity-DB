#include "sql_parser.h"

#include "../utils/string_utils.h"

#include <algorithm>
#include <cctype>
#include <regex>

namespace velocitydb {

namespace {

enum class LexState { Normal, SingleQuote, DollarQuote, LineComment, BlockComment };

/// Extract dollar-quote tag ($$ or $identifier$) starting at pos.
/// Returns the tag or empty if not a valid dollar-quote start.
std::string_view extractDollarTag(std::string_view sql, size_t pos) {
    if (pos >= sql.size() || sql[pos] != '$')
        return {};
    size_t i = pos + 1;
    if (i < sql.size() && sql[i] == '$')
        return sql.substr(pos, 2);
    if (i >= sql.size())
        return {};
    char first = sql[i];
    if (!((first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z') || first == '_'))
        return {};
    ++i;
    while (i < sql.size() && sql[i] != '$') {
        char c = sql[i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'))
            return {};
        ++i;
    }
    if (i >= sql.size())
        return {};
    return sql.substr(pos, i - pos + 1);
}

struct LexerState {
    LexState state = LexState::Normal;
    std::string_view dollarTag;
    int blockCommentDepth = 0;
};

/// Advance lexer by one character. Returns extra chars consumed (caller does i += skip).
size_t advanceLexer(LexerState& lex, std::string_view sql, size_t i) {
    char c = sql[i];
    switch (lex.state) {
        case LexState::Normal:
            if (c == '\'') {
                lex.state = LexState::SingleQuote;
            } else if (c == '$') {
                auto tag = extractDollarTag(sql, i);
                if (!tag.empty()) {
                    lex.dollarTag = tag;
                    lex.state = LexState::DollarQuote;
                    return tag.size() - 1;
                }
            } else if (c == '-' && i + 1 < sql.size() && sql[i + 1] == '-') {
                lex.state = LexState::LineComment;
                return 1;
            } else if (c == '/' && i + 1 < sql.size() && sql[i + 1] == '*') {
                lex.state = LexState::BlockComment;
                lex.blockCommentDepth = 1;
                return 1;
            }
            break;
        case LexState::SingleQuote:
            if (c == '\'') {
                if (i + 1 < sql.size() && sql[i + 1] == '\'')
                    return 1;
                lex.state = LexState::Normal;
            }
            break;
        case LexState::DollarQuote:
            if (c == '$' && i + lex.dollarTag.size() <= sql.size() && sql.substr(i, lex.dollarTag.size()) == lex.dollarTag) {
                lex.state = LexState::Normal;
                return lex.dollarTag.size() - 1;
            }
            break;
        case LexState::LineComment:
            if (c == '\n')
                lex.state = LexState::Normal;
            break;
        case LexState::BlockComment:
            if (c == '/' && i + 1 < sql.size() && sql[i + 1] == '*') {
                ++lex.blockCommentDepth;
                return 1;
            }
            if (c == '*' && i + 1 < sql.size() && sql[i + 1] == '/') {
                --lex.blockCommentDepth;
                if (lex.blockCommentDepth == 0)
                    lex.state = LexState::Normal;
                return 1;
            }
            break;
    }
    return 0;
}

void advanceLexerThrough(LexerState& lex, std::string_view sql, size_t begin, size_t end) {
    for (size_t i = begin; i < end; ++i)
        i += advanceLexer(lex, sql, i);
}

/// True if line is a psql meta-command (lowercase \cmd), excluding \. (COPY terminator).
bool isPsqlMetaCommand(std::string_view line) {
    auto t = trim(line);
    if (t.size() < 2 || t.front() != '\\' || t == "\\.")
        return false;
    return std::islower(static_cast<unsigned char>(t[1])) != 0;
}

/// True if the entire line is a SQL line comment (-- ...).
bool isSqlLineComment(std::string_view line) {
    return trim(line).starts_with("--");
}

/// Remove psql meta-commands and standalone SQL comment lines.
/// Preserves \. (COPY terminator) and inline comments (e.g. "SELECT 1; -- ok").
/// Block-comment aware: a line starting with `--` or `\cmd` that is inside a
/// /* ... */ block is arbitrary text, not a SQL line comment, and is kept.
/// Without this, closing `*/` on a decorative line like `---- */` would be
/// dropped, leaving the block comment unterminated and corrupting statement
/// splitting.
std::string filterNonExecutableLines(std::string_view sql) {
    std::string result;
    result.reserve(sql.size());
    LexerState lex;
    size_t pos = 0;
    while (pos < sql.size()) {
        auto nl = sql.find('\n', pos);
        auto end = (nl != std::string_view::npos) ? nl + 1 : sql.size();
        auto line = sql.substr(pos, end - pos);

        const bool insideBlockComment = (lex.state == LexState::BlockComment);
        advanceLexerThrough(lex, sql, pos, end);

        const bool keepLine = insideBlockComment || (!isPsqlMetaCommand(line) && !isSqlLineComment(line));
        if (keepLine)
            result.append(line);
        pos = end;
    }
    return result;
}

/// Find the next unquoted semicolon from startPos (Normal state only).
size_t findNextUnquotedSemicolon(std::string_view sql, size_t startPos) {
    LexerState lex;
    for (size_t i = startPos; i < sql.size(); ++i) {
        if (lex.state == LexState::Normal && sql[i] == ';')
            return i;
        i += advanceLexer(lex, sql, i);
    }
    return std::string_view::npos;
}

/// True if the text contains only comments and/or whitespace (no SQL).
bool isCommentOnly(std::string_view sql) {
    LexerState lex;
    for (size_t i = 0; i < sql.size(); ++i) {
        if (lex.state == LexState::Normal) {
            if (std::isspace(static_cast<unsigned char>(sql[i])))
                continue;
            auto skip = advanceLexer(lex, sql, i);
            if (lex.state != LexState::LineComment && lex.state != LexState::BlockComment)
                return false;
            i += skip;
        } else {
            i += advanceLexer(lex, sql, i);
        }
    }
    return true;
}

}  // anonymous namespace

ParsedSQL SQLParser::parseSQL(std::string_view sql) {
    ParsedSQL result;
    result.originalSQL = std::string(sql);

    std::string_view trimmedSQL = trim(sql);
    if (trimmedSQL.empty()) {
        result.type = "EMPTY";
        return result;
    }

    auto upperSQL = toUpper(trimmedSQL);

    static const std::regex usePattern(R"(^\s*USE\s+(\[?[\w]+\]?)\s*;?\s*$)", std::regex::icase);

    std::smatch match;
    auto sqlStr = std::string(trimmedSQL);

    if (std::regex_match(sqlStr, match, usePattern)) {
        result.type = "USE";
        result.database = match[1].str();

        if (result.database.front() == '[' && result.database.back() == ']') {
            result.database = result.database.substr(1, result.database.length() - 2);
        }

        return result;
    }

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
    auto trimmed = trim(sql);
    using namespace std::string_view_literals;
    return trimmed.size() > 3 && std::ranges::starts_with(trimmed, "use"sv, {}, toLowerChar, toLowerChar) && std::isspace(static_cast<unsigned char>(trimmed[3]));
}

std::string SQLParser::extractDatabaseName(std::string_view sql) {
    auto parsed = parseSQL(sql);
    return parsed.database;
}

bool SQLParser::isReadOnlyQuery(std::string_view sql) {
    auto trimmed = trim(sql);
    using namespace std::string_view_literals;
    if (std::ranges::starts_with(trimmed, "select"sv, {}, toLowerChar, toLowerChar))
        return true;
    if (!std::ranges::starts_with(trimmed, "with"sv, {}, toLowerChar, toLowerChar))
        return false;
    constexpr std::string_view dmlKeywords[] = {"INSERT", "UPDATE", "DELETE", "MERGE"};
    return std::ranges::none_of(dmlKeywords, [&](auto kw) { return !std::ranges::search(trimmed, kw, {}, toLowerChar, toLowerChar).empty(); });
}

bool SQLParser::isTransactionControl(std::string_view sql) {
    auto trimmed = trim(sql);
    using namespace std::string_view_literals;
    constexpr std::string_view prefixes[] = {"begin"sv, "commit"sv, "rollback"sv, "start transaction"sv};
    return std::ranges::any_of(prefixes, [&](auto p) { return std::ranges::starts_with(trimmed, p, {}, toLowerChar, toLowerChar); });
}

// Backward-compatible: no block detection
std::vector<std::string> SQLParser::splitStatements(std::string_view sql) {
    return splitStatements(sql, {});
}

// OCP: block detection delegated to injected detectors
std::vector<std::string> SQLParser::splitStatements(std::string_view sql, std::span<const IBlockDetector* const> detectors) {
    auto filtered = filterNonExecutableLines(sql);
    std::string_view text(filtered);

    std::vector<std::string> result;
    bool inBlock = false;
    const IBlockDetector* activeDetector = nullptr;
    std::string blockBuffer;
    size_t pos = 0;

    while (pos < text.size()) {
        if (inBlock) {
            auto lineEnd = text.find('\n', pos);
            bool hasNewline = (lineEnd != std::string_view::npos);
            if (!hasNewline)
                lineEnd = text.size();

            auto line = text.substr(pos, lineEnd - pos);
            blockBuffer.append(line);
            if (hasNewline)
                blockBuffer.push_back('\n');

            if (activeDetector->terminatesBlock(trim(line))) {
                auto trimmed = trim(blockBuffer);
                if (!trimmed.empty())
                    result.emplace_back(trimmed);
                blockBuffer.clear();
                inBlock = false;
                activeDetector = nullptr;
            }

            pos = hasNewline ? lineEnd + 1 : text.size();
            continue;
        }

        // Normal mode: find next unquoted semicolon
        auto semicolonPos = findNextUnquotedSemicolon(text, pos);

        if (semicolonPos == std::string_view::npos) {
            auto remaining = trim(text.substr(pos));
            if (!remaining.empty() && !isCommentOnly(remaining))
                result.emplace_back(remaining);
            break;
        }

        auto segment = text.substr(pos, semicolonPos - pos);
        auto trimmed = trim(segment);
        pos = semicolonPos + 1;

        if (trimmed.empty() || isCommentOnly(trimmed))
            continue;

        // Check detectors for block start
        bool blockStarted = false;
        for (auto* detector : detectors) {
            if (detector->startsBlock(trimmed)) {
                inBlock = true;
                activeDetector = detector;
                blockBuffer = std::string(trimmed) + ";\n";
                blockStarted = true;
                break;
            }
        }

        if (blockStarted) {
            // Skip newline after semicolon to avoid empty leading line in block
            if (pos < text.size() && text[pos] == '\n')
                ++pos;
        } else {
            result.emplace_back(trimmed);
        }
    }

    // Handle unterminated block
    if (inBlock) {
        auto trimmed = trim(blockBuffer);
        if (!trimmed.empty())
            result.emplace_back(trimmed);
    }

    return result;
}

std::string_view SQLParser::normalizeForCacheKey(std::string_view sql) {
    auto normalized = trim(sql);
    while (!normalized.empty() && normalized.back() == ';') {
        normalized.remove_suffix(1);
        normalized = trim(normalized);
    }
    return normalized;
}

}  // namespace velocitydb
