#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// ISP: DDL generation and execution plan query interface.
/// getExecutionPlanQuery is included here as it shares the DDL/metadata concern
/// (both are non-DML read-only operations against the database structure).
class IDDLQueryable {
public:
    virtual ~IDDLQueryable() = default;

    IDDLQueryable(const IDDLQueryable&) = delete;
    IDDLQueryable& operator=(const IDDLQueryable&) = delete;

    [[nodiscard]] virtual std::string getDDLColumnsQuery(std::string_view schema, std::string_view table) const = 0;
    [[nodiscard]] virtual std::string getDDLPrimaryKeyQuery(std::string_view schema, std::string_view table) const = 0;
    [[nodiscard]] virtual std::string getExecutionPlanQuery(std::string_view sql, bool actual) const = 0;

protected:
    IDDLQueryable() = default;
};

}  // namespace velocitydb
