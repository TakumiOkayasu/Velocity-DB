#pragma once

#include "../interfaces/providers/schema_provider.h"

#include <chrono>
#include <expected>
#include <functional>
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
    // キャッシュエントリ数の上限。接続数 × テーブル数 × メソッド数で無制限に増えるのを防ぐ (#512)。
    static constexpr size_t MAX_SCHEMA_CACHE_ENTRIES = 1024;
    std::unordered_map<std::string, SchemaCacheEntry> m_schemaCache;
    mutable std::mutex m_cacheMutex;

    [[nodiscard]] std::optional<std::string> getCached(const std::string& key);
    void putCache(const std::string& key, const std::string& response);
    void evictIfFullLocked();  // m_cacheMutex を保持した状態で呼ぶ

    // getCached → produce → 成功なら successResponse + putCache、失敗 (unexpected) なら errorResponse で
    // キャッシュせず返す。produce 内の例外も errorResponse 化する。スキーマ取得メソッドの共通キャッシュ
    // 制御を集約する (#512)。
    [[nodiscard]] std::string withCache(const std::string& key, const std::function<std::expected<std::string, std::string>()>& produce);
};

}  // namespace velocitydb
