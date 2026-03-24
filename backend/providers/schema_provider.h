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

    [[nodiscard]] std::string getDatabases(std::string_view params) override;
    [[nodiscard]] std::string getTables(std::string_view params) override;
    [[nodiscard]] std::string getColumns(std::string_view params) override;
    [[nodiscard]] std::string getIndexes(std::string_view params) override;
    [[nodiscard]] std::string getConstraints(std::string_view params) override;
    [[nodiscard]] std::string getForeignKeys(std::string_view params) override;
    [[nodiscard]] std::string getReferencingForeignKeys(std::string_view params) override;
    [[nodiscard]] std::string getTriggers(std::string_view params) override;
    [[nodiscard]] std::string getTableMetadata(std::string_view params) override;
    [[nodiscard]] std::string getTableDDL(std::string_view params) override;
    [[nodiscard]] std::string getExecutionPlan(std::string_view params) override;

private:
    IConnectionProvider& m_connections;
};

}  // namespace velocitydb
