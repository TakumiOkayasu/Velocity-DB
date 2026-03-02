#include "copy_block_detector.h"

#include "../utils/string_utils.h"

#include <ranges>

namespace velocitydb {

bool CopyBlockDetector::startsBlock(std::string_view statement) const {
    auto remaining = trim(statement);

    // Skip leading SQL comments (-- ...) and blank lines (pg_dump injects comments before COPY)
    while (!remaining.empty()) {
        auto nl = remaining.find('\n');
        auto line = trim((nl != std::string_view::npos) ? remaining.substr(0, nl) : remaining);

        if (!line.empty() && !line.starts_with("--")) {
            if (line.ends_with(";"))
                line.remove_suffix(1);
            line = trim(line);
            auto upper = toUpper(line);
            return upper.starts_with("COPY") && upper.find("FROM") != std::string::npos && upper.find("STDIN") != std::string::npos;
        }

        if (nl == std::string_view::npos)
            break;
        remaining = remaining.substr(nl + 1);
    }
    return false;
}

bool CopyBlockDetector::terminatesBlock(std::string_view line) const {
    return trim(line) == "\\.";
}

CopyParts CopyBlockDetector::extractParts(std::string_view compoundStatement) {
    CopyParts parts;
    auto remaining = compoundStatement;

    // Skip leading comments/blank lines to find the COPY command (pg_dump format)
    while (!remaining.empty()) {
        auto nl = remaining.find('\n');
        auto line = trim((nl != std::string_view::npos) ? remaining.substr(0, nl) : remaining);

        if (!line.empty() && !line.starts_with("--")) {
            parts.command = std::string(line);
            if (!parts.command.ends_with(";"))
                parts.command.push_back(';');
            remaining = (nl != std::string_view::npos) ? remaining.substr(nl + 1) : std::string_view{};
            break;
        }

        if (nl == std::string_view::npos) {
            parts.command = std::string(trim(compoundStatement));
            return parts;
        }
        remaining = remaining.substr(nl + 1);
    }

    // Collect data lines until \.
    std::string data;
    for (auto lineRange : remaining | std::views::split('\n')) {
        std::string_view lineView{lineRange.begin(), lineRange.end()};
        if (trim(lineView) == "\\.")
            break;
        data.append(lineView);
        data.push_back('\n');
    }

    parts.data = std::move(data);
    return parts;
}

namespace {

/// Strip SQL comments and string literals, replacing their content with spaces.
/// Handles: -- line comments, /* */ block comments, 'string literals' (with '' escaping).
[[nodiscard]] std::string stripCommentsAndStrings(std::string_view sql) {
    std::string result;
    result.reserve(sql.size());

    for (size_t i = 0; i < sql.size();) {
        // Line comment: --
        if (i + 1 < sql.size() && sql[i] == '-' && sql[i + 1] == '-') {
            while (i < sql.size() && sql[i] != '\n')
                ++i;
            result.push_back(' ');
            continue;
        }
        // Block comment: /* ... */
        if (i + 1 < sql.size() && sql[i] == '/' && sql[i + 1] == '*') {
            i += 2;
            while (i + 1 < sql.size() && !(sql[i] == '*' && sql[i + 1] == '/'))
                ++i;
            if (i + 1 < sql.size())
                i += 2;
            else
                i = sql.size();  // Unclosed block comment — consume all remaining
            result.push_back(' ');
            continue;
        }
        // String literal: '...' with '' escaping
        if (sql[i] == '\'') {
            ++i;
            while (i < sql.size()) {
                if (sql[i] == '\'') {
                    ++i;
                    if (i < sql.size() && sql[i] == '\'') {
                        ++i;  // escaped ''
                    } else {
                        break;
                    }
                } else {
                    ++i;
                }
            }
            result.push_back(' ');
            continue;
        }
        result.push_back(sql[i]);
        ++i;
    }
    return result;
}

[[nodiscard]] bool isWordBoundary(char c) {
    return !std::isalnum(static_cast<unsigned char>(c)) && c != '_';
}

/// Case-insensitive whole-word search within stripped SQL
[[nodiscard]] bool findWordCI(std::string_view haystack, std::string_view needle) {
    auto it = haystack.begin();
    while (true) {
        auto match = std::ranges::search(std::ranges::subrange(it, haystack.end()), needle,
                                         [](char a, char b) { return std::toupper(static_cast<unsigned char>(a)) == std::toupper(static_cast<unsigned char>(b)); });
        // No match found — match.begin() points to haystack.end()
        if (match.begin() == haystack.end())
            return false;
        bool leftOk = match.begin() == haystack.begin() || isWordBoundary(*(match.begin() - 1));
        bool rightOk = match.end() == haystack.end() || isWordBoundary(*match.end());
        if (leftOk && rightOk)
            return true;
        // Safe: match.begin() != haystack.end() (guarded above), so +1 is valid
        it = match.begin() + 1;
    }
}

}  // namespace

bool containsCopyFromStdin(std::string_view sql) {
    auto stripped = stripCommentsAndStrings(sql);
    return findWordCI(stripped, "COPY") && findWordCI(stripped, "FROM") && findWordCI(stripped, "STDIN");
}

}  // namespace velocitydb
