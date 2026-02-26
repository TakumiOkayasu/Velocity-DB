#include "copy_block_detector.h"

#include "../utils/string_utils.h"

#include <ranges>

namespace velocitydb {

bool CopyBlockDetector::startsBlock(std::string_view statement) const {
    auto trimmed = trim(statement);
    if (trimmed.ends_with(";"))
        trimmed.remove_suffix(1);
    trimmed = trim(trimmed);

    // For compound statements (with data), check only the first line
    auto firstNewline = trimmed.find('\n');
    if (firstNewline != std::string_view::npos)
        trimmed = trim(trimmed.substr(0, firstNewline));
    if (trimmed.ends_with(";"))
        trimmed.remove_suffix(1);
    trimmed = trim(trimmed);

    // Single toUpper after all string_view narrowing
    auto upper = toUpper(trimmed);

    if (!upper.starts_with("COPY"))
        return false;
    if (upper.find("FROM") == std::string::npos)
        return false;
    if (upper.find("STDIN") == std::string::npos)
        return false;
    return true;
}

bool CopyBlockDetector::terminatesBlock(std::string_view line) const {
    return trim(line) == "\\.";
}

CopyParts CopyBlockDetector::extractParts(std::string_view compoundStatement) {
    CopyParts parts;

    auto firstNewline = compoundStatement.find('\n');
    if (firstNewline == std::string_view::npos) {
        parts.command = std::string(trim(compoundStatement));
        return parts;
    }

    parts.command = std::string(trim(compoundStatement.substr(0, firstNewline)));
    if (!parts.command.ends_with(";"))
        parts.command.push_back(';');

    auto rest = compoundStatement.substr(firstNewline + 1);

    std::string data;
    for (auto lineRange : rest | std::views::split('\n')) {
        std::string_view lineView{lineRange.begin(), lineRange.end()};
        if (trim(lineView) == "\\.")
            break;
        data.append(lineView);
        data.push_back('\n');
    }

    parts.data = std::move(data);
    return parts;
}

}  // namespace velocitydb
