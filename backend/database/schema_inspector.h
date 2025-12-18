#pragma once

#include "sqlserver_driver.h"

#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace predategrip {

struct TableInfo {
    std::string schema;
    std::string name;
    std::string type;
    std::string comment;
};

struct IndexInfo {
    std::string name;
    std::string type;
    std::vector<std::string> columns;
    bool isUnique = false;
    bool isPrimaryKey = false;
};

struct ForeignKeyInfo {
    std::string name;
    std::string column;
    std::string referencedTable;
    std::string referencedColumn;
};

struct StoredProcedureInfo {
    std::string schema;
    std::string name;
    std::string definition;
};

struct FunctionInfo {
    std::string schema;
    std::string name;
    std::string returnType;
    std::string definition;
};

class SchemaInspector {
public:
    SchemaInspector() = default;
    ~SchemaInspector() = default;

    void setDriver(std::shared_ptr<SQLServerDriver> driver) { m_driver = std::move(driver); }

    [[nodiscard]] std::vector<std::string> getDatabases();
    [[nodiscard]] std::vector<TableInfo> getTables(std::string_view database);
    [[nodiscard]] std::vector<ColumnInfo> getColumns(std::string_view table);
    [[nodiscard]] std::vector<IndexInfo> getIndexes(std::string_view table);
    [[nodiscard]] std::vector<ForeignKeyInfo> getForeignKeys(std::string_view table);
    [[nodiscard]] std::vector<StoredProcedureInfo> getStoredProcedures(std::string_view database);
    [[nodiscard]] std::vector<FunctionInfo> getFunctions(std::string_view database);

    [[nodiscard]] std::string generateDDL(std::string_view table);
    [[nodiscard]] std::string generateSelectStatement(std::string_view table);
    [[nodiscard]] std::string generateInsertStatement(std::string_view table);
    [[nodiscard]] std::string generateUpdateStatement(std::string_view table);
    [[nodiscard]] std::string generateDeleteStatement(std::string_view table);

private:
    std::shared_ptr<SQLServerDriver> m_driver;
};

}  // namespace predategrip
