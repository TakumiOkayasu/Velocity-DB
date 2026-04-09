#pragma once

#include "../interfaces/providers/schema_provider.h"

#include <chrono>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_map>

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
    [[nodiscard]] std::string clearSchemaCache(std::string_view params) override;

private:
    IConnectionProvider& m_connections;

    struct SchemaCacheEntry {
        std::string response;
        std::chrono::steady_clock::time_point timestamp;
    };

    static constexpr auto SCHEMA_CACHE_TTL = std::chrono::minutes(5);
    std::unordered_map<std::string, SchemaCacheEntry> m_schemaCache;
    mutable std::mutex m_cacheMutex;

    [[nodiscard]] std::optional<std::string> getCached(const std::string& key);
    void putCache(const std::string& key, const std::string& response);
};

}  // namespace velocitydb
