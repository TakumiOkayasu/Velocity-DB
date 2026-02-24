#pragma once

#include "encoding.h"
#include "logger.h"
#include "sql_escape.h"

#include <ranges>
#include <string>
#include <string_view>

namespace velocitydb {

/// SQL Server の sysname 型の最大文字数 (NVARCHAR(128))
inline constexpr size_t kMaxIdentifierLength = 128;

namespace detail {

/// Unicode コードポイント基準の英数字判定 (ロケール非依存)
[[nodiscard]] inline bool isUnicodeAlphaNumeric(wchar_t ch) {
    WORD charType = 0;
    if (!GetStringTypeW(CT_CTYPE1, &ch, 1, &charType))
        return false;
    return (charType & (C1_ALPHA | C1_DIGIT)) != 0;
}

/// 単一パートの bracket 引用を解除し ]] → ] に unescape (O(n) 1パス)
[[nodiscard]] inline std::string unquoteSinglePart(std::string_view part) {
    if (!part.starts_with('[') || !part.ends_with(']'))
        return std::string(part);
    auto inner = part.substr(1, part.size() - 2);
    std::string s;
    s.reserve(inner.size());
    for (size_t i = 0; i < inner.size(); ++i) {
        s += inner[i];
        if (inner[i] == ']' && i + 1 < inner.size() && inner[i + 1] == ']')
            ++i;
    }
    return s;
}

/// 単一パートを bracket 引用し ] → ]] にエスケープ (unquoteSinglePart の逆)
[[nodiscard]] inline std::string quoteSinglePart(std::string_view part) {
    if (part.empty())
        return {};
    std::string s;
    s.reserve(part.size() + 2);
    s += '[';
    for (char c : part) {
        if (c == ']')
            s += "]]";
        else
            s += c;
    }
    s += ']';
    return s;
}

}  // namespace detail

[[nodiscard]] inline bool isValidIdentifier(std::string_view name) {
    if (name.empty())
        return false;

    auto wide = utf8ToWide(name);
    if (wide.empty()) {
        log<LogLevel::WARNING>(std::format("isValidIdentifier: UTF-8 to wide conversion failed for input ({} bytes)", name.size()));
        return false;
    }

    if (wide.size() > kMaxIdentifierLength)
        return false;

    bool insideBracket = false;
    bool bracketHasContent = false;
    for (size_t i = 0; i < wide.size(); ++i) {
        wchar_t ch = wide[i];
        if (insideBracket) {
            if (ch == L']') {
                if (i + 1 < wide.size() && wide[i + 1] == L']') {
                    ++i;  // ]] = escaped ]
                    bracketHasContent = true;
                } else {
                    if (!bracketHasContent)
                        return false;
                    insideBracket = false;
                    bracketHasContent = false;
                }
            } else {
                bracketHasContent = true;
            }
        } else if (ch == L'[') {
            insideBracket = true;
        } else if (ch != L'_' && ch != L'.' && !detail::isUnicodeAlphaNumeric(ch)) {
            return false;
        }
    }
    return !insideBracket;
}

/// bracket 引用識別子を解除し ]] → ] に unescape (マルチパート対応)
[[nodiscard]] inline std::string unquoteBracketIdentifier(std::string_view identifier) {
    std::string result;
    size_t partStart = 0;
    bool insideBracket = false;

    for (size_t i = 0; i < identifier.size(); ++i) {
        char ch = identifier[i];
        if (insideBracket) {
            if (ch == ']') {
                if (i + 1 < identifier.size() && identifier[i + 1] == ']') {
                    ++i;
                } else {
                    insideBracket = false;
                }
            }
        } else if (ch == '[') {
            insideBracket = true;
        } else if (ch == '.') {
            if (!result.empty())
                result += '.';
            result += detail::unquoteSinglePart(identifier.substr(partStart, i - partStart));
            partStart = i + 1;
        }
    }

    if (!result.empty())
        result += '.';
    result += detail::unquoteSinglePart(identifier.substr(partStart));
    return result;
}

/// 識別子を bracket 引用 (unquoteBracketIdentifier の逆、マルチパート対応)
[[nodiscard]] inline std::string quoteBracketIdentifier(std::string_view identifier) {
    if (identifier.empty())
        return {};
    std::string result;
    result.reserve(identifier.size() + 4);
    bool first = true;
    for (auto part : identifier | std::views::split('.')) {
        if (!first)
            result += '.';
        first = false;
        result += detail::quoteSinglePart({part.begin(), part.end()});
    }
    return result;
}

/// schema.table 識別子を bracket 解除して分割
struct SplitIdentifier {
    std::string schema;
    std::string name;
};

[[nodiscard]] inline SplitIdentifier splitSchemaTable(std::string_view identifier, std::string_view defaultSchema = "dbo") {
    auto unquoted = unquoteBracketIdentifier(identifier);
    if (auto dotPos = unquoted.find('.'); dotPos != std::string::npos)
        return {unquoted.substr(0, dotPos), unquoted.substr(dotPos + 1)};
    return {std::string(defaultSchema), std::move(unquoted)};
}

/// SQL文字列リテラル用エスケープ (escapeSql のエイリアス、後方互換)
[[nodiscard]] inline std::string escapeSqlString(std::string_view value) {
    return escapeSql(value);
}

/// SQL LIKE パターン用エスケープ (%, _, [ をブラケットエスケープ)
/// escapeSqlString と組み合わせて使用: escapeSqlString(escapeLikePattern(input))
[[nodiscard]] inline std::string escapeLikePattern(std::string_view value) {
    std::string result;
    result.reserve(value.size());
    for (char c : value) {
        switch (c) {
            case '%':
                result += "[%]";
                break;
            case '_':
                result += "[_]";
                break;
            case '[':
                result += "[[]";
                break;
            default:
                result += c;
                break;
        }
    }
    return result;
}

}  // namespace velocitydb
