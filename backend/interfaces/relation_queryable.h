#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// ISP: Relation introspection query interface
class IRelationQueryable {
public:
    virtual ~IRelationQueryable() = default;

    IRelationQueryable(const IRelationQueryable&) = delete;
    IRelationQueryable& operator=(const IRelationQueryable&) = delete;

    [[nodiscard]] virtual std::string getIndexesQuery(std::string_view schema, std::string_view table) const = 0;
    [[nodiscard]] virtual std::string getConstraintsQuery(std::string_view schema, std::string_view table) const = 0;
    [[nodiscard]] virtual std::string getForeignKeysQuery(std::string_view schema, std::string_view table) const = 0;
    [[nodiscard]] virtual std::string getReferencingForeignKeysQuery(std::string_view schema, std::string_view table) const = 0;
    [[nodiscard]] virtual std::string getTriggersQuery(std::string_view schema, std::string_view table) const = 0;

protected:
    IRelationQueryable() = default;
};

}  // namespace velocitydb
