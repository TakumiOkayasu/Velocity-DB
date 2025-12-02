#pragma once

#include "sqlserver_driver.h"
#include <string>
#include <vector>
#include <memory>

namespace predategrip {

struct TableInfo {
    std::string schema;
    std::string name;
    std::string type;  // TABLE, VIEW
};

struct IndexInfo {
    std::string name;
    std::string type;
    std::vector<std::string> columns;
    bool isUnique;
    bool isPrimaryKey;
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

    void setDriver(std::shared_ptr<SQLServerDriver> driver);

    std::vector<std::string> getDatabases();
    std::vector<TableInfo> getTables(const std::string& database);
    std::vector<ColumnInfo> getColumns(const std::string& table);
    std::vector<IndexInfo> getIndexes(const std::string& table);
    std::vector<ForeignKeyInfo> getForeignKeys(const std::string& table);
    std::vector<StoredProcedureInfo> getStoredProcedures(const std::string& database);
    std::vector<FunctionInfo> getFunctions(const std::string& database);

    std::string generateDDL(const std::string& table);
    std::string generateSelectStatement(const std::string& table);
    std::string generateInsertStatement(const std::string& table);
    std::string generateUpdateStatement(const std::string& table);
    std::string generateDeleteStatement(const std::string& table);

private:
    std::shared_ptr<SQLServerDriver> m_driver;
};

}  // namespace predategrip
