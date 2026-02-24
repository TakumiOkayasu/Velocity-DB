#pragma once

#include "../interfaces/providers/schema_provider.h"

#include <string>
#include <string_view>

namespace velocitydb {

class IConnectionProvider;

/// Provider for database schema inspection
class SchemaProvider : public ISchemaProvider {
public:
    explicit SchemaProvider(IConnectionProvider& connections);
    ~SchemaProvider() override;

    SchemaProvider(const SchemaProvider&) = delete;
    SchemaProvider& operator=(const SchemaProvider&) = delete;
    SchemaProvider(SchemaProvider&&) = delete;
    SchemaProvider& operator=(SchemaProvider&&) = delete;

    [[nodiscard]] std::string handleGetDatabases(std::string_view params) override;
    [[nodiscard]] std::string handleGetTables(std::string_view params) override;
    [[nodiscard]] std::string handleGetColumns(std::string_view params) override;
    [[nodiscard]] std::string handleGetIndexes(std::string_view params) override;
    [[nodiscard]] std::string handleGetConstraints(std::string_view params) override;
    [[nodiscard]] std::string handleGetForeignKeys(std::string_view params) override;
    [[nodiscard]] std::string handleGetReferencingForeignKeys(std::string_view params) override;
    [[nodiscard]] std::string handleGetTriggers(std::string_view params) override;
    [[nodiscard]] std::string handleGetTableMetadata(std::string_view params) override;
    [[nodiscard]] std::string handleGetTableDDL(std::string_view params) override;
    [[nodiscard]] std::string handleGetExecutionPlan(std::string_view params) override;

private:
    IConnectionProvider& m_connections;
};

}  // namespace velocitydb
