#pragma once

#include "../interfaces/ddl_queryable.h"
#include "../interfaces/object_searchable.h"
#include "../interfaces/relation_queryable.h"
#include "../interfaces/schema_queryable.h"
#include "../interfaces/sql_formattable.h"

#include <cstdint>
#include <string>
#include <string_view>

namespace velocitydb {

class PostgreSqlDialect
    : public ISchemaQueryable
    , public IRelationQueryable
    , public IDDLQueryable
    , public ISqlFormattable
    , public IObjectSearchable {
public:
    PostgreSqlDialect() = default;
    ~PostgreSqlDialect() override = default;

    // ISchemaQueryable
    [[nodiscard]] std::string getDatabasesQuery() const override;
    [[nodiscard]] std::string getTablesQuery() const override;
    [[nodiscard]] std::string getColumnsQuery(std::string_view schema, std::string_view table) const override;
    [[nodiscard]] std::string getTableMetadataQuery(std::string_view schema, std::string_view table) const override;

    // IRelationQueryable
    [[nodiscard]] std::string getIndexesQuery(std::string_view schema, std::string_view table) const override;
    [[nodiscard]] std::string getConstraintsQuery(std::string_view schema, std::string_view table) const override;
    [[nodiscard]] std::string getForeignKeysQuery(std::string_view schema, std::string_view table) const override;
    [[nodiscard]] std::string getReferencingForeignKeysQuery(std::string_view schema, std::string_view table) const override;
    [[nodiscard]] std::string getTriggersQuery(std::string_view schema, std::string_view table) const override;

    // IDDLQueryable
    [[nodiscard]] std::string getDDLColumnsQuery(std::string_view schema, std::string_view table) const override;
    [[nodiscard]] std::string getDDLPrimaryKeyQuery(std::string_view schema, std::string_view table) const override;
    [[nodiscard]] std::string getExecutionPlanQuery(std::string_view sql, bool actual) const override;

    // ISqlFormattable
    [[nodiscard]] std::string quoteIdentifier(std::string_view id) const override;
    [[nodiscard]] std::string_view defaultSchema() const noexcept override;
    [[nodiscard]] std::string paginateQuery(std::string_view sql, int64_t offset, int64_t limit) const override;
    [[nodiscard]] std::string rowCountQuery(std::string_view sql) const override;

    // IObjectSearchable
    [[nodiscard]] std::string searchObjectsQuery(std::string_view pattern, bool caseSensitive, int maxResults, uint8_t categories = SearchCategory::All) const override;
    [[nodiscard]] std::string quickSearchQuery(std::string_view prefix, int limit) const override;
};

}  // namespace velocitydb
