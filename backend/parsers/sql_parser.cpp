#include "sql_parser.h"

#include "../utils/string_utils.h"

#include <ranges>
#include <regex>

namespace velocitydb {

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
    auto upper = toUpper(trimmed);
    constexpr std::string_view dmlKeywords[] = {"INSERT", "UPDATE", "DELETE", "MERGE"};
    return std::ranges::none_of(dmlKeywords, [&](auto kw) { return upper.find(kw) != std::string::npos; });
}

// Backward-compatible: no block detection
std::vector<std::string> SQLParser::splitStatements(std::string_view sql) {
    return splitStatements(sql, {});
}

// OCP: block detection delegated to injected detectors
std::vector<std::string> SQLParser::splitStatements(std::string_view sql, std::span<const IBlockDetector* const> detectors) {
    std::vector<std::string> statements;
    std::string buffer;
    bool inBlockMode = false;
    const IBlockDetector* activeDetector = nullptr;

    for (auto lineRange : sql | std::views::split('\n')) {
        std::string_view lineView{lineRange.begin(), lineRange.end()};
        auto trimmedLine = trim(lineView);

        if (inBlockMode) {
            buffer.append(lineView);
            buffer.push_back('\n');
            if (activeDetector->terminatesBlock(trimmedLine)) {
                auto trimmed = trim(buffer);
                if (!trimmed.empty())
                    statements.emplace_back(trimmed);
                buffer.clear();
                inBlockMode = false;
                activeDetector = nullptr;
            }
            continue;
        }

        // psql meta-commands (\-prefixed lines) are filtered out
        if (!trimmedLine.empty() && trimmedLine.front() == '\\') {
            continue;
        }

        buffer.append(lineView);
        buffer.push_back('\n');

        if (trimmedLine.ends_with(";")) {
            std::string currentBuffer = std::move(buffer);
            buffer.clear();

            for (auto part : std::string_view{currentBuffer} | std::views::split(';')) {
                auto partTrimmed = trim({part.begin(), part.end()});
                if (partTrimmed.empty())
                    continue;

                // Check detectors for block start
                bool blockStarted = false;
                for (auto* detector : detectors) {
                    if (detector->startsBlock(partTrimmed)) {
                        inBlockMode = true;
                        activeDetector = detector;
                        buffer = std::string(partTrimmed) + ";\n";
                        blockStarted = true;
                        break;
                    }
                }
                if (!blockStarted) {
                    statements.emplace_back(partTrimmed);
                }
            }
        }
    }

    auto remaining = trim(buffer);
    if (!remaining.empty())
        statements.emplace_back(remaining);

    return statements;
}

}  // namespace velocitydb
