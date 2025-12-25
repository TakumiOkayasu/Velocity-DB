#pragma once

#include <string>
#include <string_view>
#include <unordered_set>

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

    SQLFormatter();
    ~SQLFormatter() = default;

    [[nodiscard]] std::string format(std::string_view sql, const FormatOptions& options = FormatOptions{});
    [[nodiscard]] std::string uppercaseKeywords(std::string_view sql);

    // Load keywords from external file (returns true on success)
    bool loadKeywordsFromFile(const std::string& filePath);

private:
    [[nodiscard]] std::string applyKeywordCase(std::string_view word, KeywordCase keywordCase) const;
    [[nodiscard]] bool isKeyword(std::string_view word) const;
    [[nodiscard]] static std::string getIndent(int level, const FormatOptions& options);
    void loadDefaultKeywords();

    std::unordered_set<std::string> m_keywords;
    std::unordered_set<std::string> m_majorClauses;
    std::unordered_set<std::string> m_joinKeywords;
};  // class SQLFormatter

}  // namespace predategrip
