#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for database schema inspection
class ISchemaProvider {
public:
    virtual ~ISchemaProvider() = default;

    [[nodiscard]] virtual std::string getDatabases(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getTables(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getColumns(std::string_view params) = 0;
    /// 全テーブル/ビューの列定義を 1 回の IPC で返す (#512: ER 図読込等の N+1 解消)
    [[nodiscard]] virtual std::string getAllColumns(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getIndexes(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getConstraints(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getForeignKeys(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getReferencingForeignKeys(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getTriggers(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getTableMetadata(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getTableDDL(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getExecutionPlan(std::string_view params) = 0;

    [[nodiscard]] virtual std::string clearSchemaCache(std::string_view params) { return R"({"success":true})"; }
};

}  // namespace velocitydb
