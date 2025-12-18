#pragma once

#include <string>
#include <string_view>

namespace predategrip {

enum class KeywordCase { Upper, Lower, Unchanged };

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

    [[nodiscard]] std::string format(std::string_view sql, const FormatOptions& options = FormatOptions{});

private:
    [[nodiscard]] std::string applyKeywordCase(std::string_view word, KeywordCase keywordCase) const;
    [[nodiscard]] static bool isKeyword(std::string_view word);
    [[nodiscard]] static std::string getIndent(int level, const FormatOptions& options);
};

}  // namespace predategrip
