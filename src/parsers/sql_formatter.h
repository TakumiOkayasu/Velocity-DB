#pragma once

#include <string>

namespace predategrip {

enum class KeywordCase {
    Upper,
    Lower,
    Unchanged
};

class SQLFormatter {
public:
    struct FormatOptions {
        int indentSize = 4;
        bool useTab = false;
        KeywordCase keywordCase = KeywordCase::Upper;
        bool breakBeforeComma = false;
        bool breakAfterComma = true;
        int maxLineLength = 120;
    };

    SQLFormatter() = default;
    ~SQLFormatter() = default;

    std::string format(const std::string& sql, const FormatOptions& options = FormatOptions());

private:
    std::string applyKeywordCase(const std::string& word, KeywordCase keywordCase) const;
    bool isKeyword(const std::string& word) const;
    std::string getIndent(int level, const FormatOptions& options) const;
};

}  // namespace predategrip
