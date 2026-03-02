#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace velocitydb {

/// ISP: SQL formatting and dialect-specific syntax interface
class ISqlFormattable {
public:
    virtual ~ISqlFormattable() = default;

    ISqlFormattable(const ISqlFormattable&) = delete;
    ISqlFormattable& operator=(const ISqlFormattable&) = delete;

    [[nodiscard]] virtual std::string quoteIdentifier(std::string_view id) const = 0;
    [[nodiscard]] virtual std::string quoteLiteral(std::string_view value) const = 0;
    [[nodiscard]] virtual std::string buildSelectAll(std::string_view quotedTable, int64_t limit) const = 0;
    [[nodiscard]] virtual std::string buildSelectAllWhere(std::string_view quotedTable, std::string_view whereClause, int64_t limit) const = 0;
    [[nodiscard]] virtual std::string_view defaultSchema() const noexcept = 0;
    [[nodiscard]] virtual std::string paginateQuery(std::string_view sql, int64_t offset, int64_t limit) const = 0;
    [[nodiscard]] virtual std::string rowCountQuery(std::string_view sql) const = 0;

protected:
    ISqlFormattable() = default;
};

}  // namespace velocitydb
