#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for dialect-aware SQL string construction (操作層;
/// hierarchical-architecture 命名表の許容句「責務が操作層に一致」を適用)
class IDialectSqlBuilder {
public:
    virtual ~IDialectSqlBuilder() = default;

    [[nodiscard]] virtual std::string buildDataViewSql(std::string_view params) = 0;
    [[nodiscard]] virtual std::string buildWhereClause(std::string_view params) = 0;
    [[nodiscard]] virtual std::string buildDmlStatements(std::string_view params) = 0;
};

}  // namespace velocitydb
