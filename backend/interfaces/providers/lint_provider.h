#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for static SQL linting via sqruff (parse errors only).
class ILintProvider {
public:
    virtual ~ILintProvider() = default;

    /// Lint a SQL string. params JSON: {"sql":"...","dbType":"sqlserver|postgresql|mysql"}
    /// Response JSON: {"success":true,"data":{"diagnostics":[{"line":N,"column":N,"code":"PRS...","message":"..."}]}}
    /// On infrastructure failure (binary missing, timeout, etc.) the response carries success:true with an empty diagnostics array and a "lintUnavailable":true flag, so the caller never blocks query
    /// execution over lint infra issues.
    [[nodiscard]] virtual std::string lintSql(std::string_view params) = 0;
};

}  // namespace velocitydb
