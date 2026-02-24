#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// ISP: Schema introspection query interface
class ISchemaQueryable {
public:
    virtual ~ISchemaQueryable() = default;

    ISchemaQueryable(const ISchemaQueryable&) = delete;
    ISchemaQueryable& operator=(const ISchemaQueryable&) = delete;

    [[nodiscard]] virtual std::string getDatabasesQuery() const = 0;
    [[nodiscard]] virtual std::string getTablesQuery() const = 0;
    [[nodiscard]] virtual std::string getColumnsQuery(std::string_view schema, std::string_view table) const = 0;
    [[nodiscard]] virtual std::string getTableMetadataQuery(std::string_view schema, std::string_view table) const = 0;

protected:
    ISchemaQueryable() = default;
};

}  // namespace velocitydb
