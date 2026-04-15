#pragma once

#include "../interfaces/providers/lint_provider.h"

#include <string>
#include <string_view>

namespace velocitydb {

/// Concrete provider delegating to parsers/sql_linter for sqruff-based parse-error detection.
class LintProvider : public ILintProvider {
public:
    LintProvider();
    ~LintProvider() override = default;

    LintProvider(const LintProvider&) = delete;
    LintProvider& operator=(const LintProvider&) = delete;
    LintProvider(LintProvider&&) = delete;
    LintProvider& operator=(LintProvider&&) = delete;

    [[nodiscard]] std::string lintSql(std::string_view params) override;
};

}  // namespace velocitydb
