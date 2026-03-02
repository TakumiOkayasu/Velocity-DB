#pragma once

#include "../interfaces/connectable.h"
#include "../interfaces/error_reportable.h"

#include <chrono>
#include <cstdint>
#include <expected>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

// Forward declarations (schema types defined in schema_inspector.h)
struct TableInfo;
struct IndexInfo;
struct ForeignKeyInfo;
struct StoredProcedureInfo;
struct FunctionInfo;

// Forward declarations (Dialect ISP interfaces)
class ISchemaQueryable;
class IRelationQueryable;
class IDDLQueryable;
class ISqlFormattable;
class IObjectSearchable;

// ─── Driver type enumeration ───

enum class DriverType { SQLServer, PostgreSQL, MySQL };

[[nodiscard]] inline constexpr std::string_view beginTransactionSQL(DriverType type) noexcept {
    return type == DriverType::SQLServer ? "BEGIN TRANSACTION" : "BEGIN";
}

[[nodiscard]] constexpr std::string_view driverTypeToString(DriverType type) noexcept {
    switch (type) {
        case DriverType::SQLServer:
            return "SQL Server";
        case DriverType::PostgreSQL:
            return "PostgreSQL";
        case DriverType::MySQL:
            return "MySQL";
    }
    return "Unknown";
}

// ─── Result types (moved from sqlserver_driver.h) ───

struct ColumnInfo {
    std::string name;
    std::string type;
    int size = 0;
    bool nullable = true;
    bool isPrimaryKey = false;
    std::string comment;
};

struct ResultRow {
    std::vector<std::string> values;
};

struct ResultSet {
    std::vector<ColumnInfo> columns;
    std::vector<ResultRow> rows;
    int64_t affectedRows = 0;
    double executionTimeMs = 0.0;
};

// ─── ISP: Query execution interface ───

class IQueryExecutable {
public:
    static constexpr std::chrono::seconds kDefaultQueryTimeout{300};

    virtual ~IQueryExecutable() = default;

    IQueryExecutable(const IQueryExecutable&) = delete;
    IQueryExecutable& operator=(const IQueryExecutable&) = delete;

    [[nodiscard]] virtual ResultSet execute(std::string_view sql) = 0;

    /// Thread-safe: execute() がブロック中でもロックなしで呼び出し可能であること。
    virtual void cancel() = 0;

    /// execute() と排他的に実行されること（実装側で m_executeMutex 等で保護）。
    virtual void setQueryTimeout(std::chrono::seconds timeout) = 0;
    [[nodiscard]] virtual std::chrono::seconds queryTimeout() const noexcept = 0;

protected:
    IQueryExecutable() = default;
};

// ─── Composite: IDatabaseDriver (IConnectable + IQueryExecutable + IErrorReportable) ───

class IDatabaseDriver
    : public IConnectable
    , public IQueryExecutable
    , public IErrorReportable {
public:
    ~IDatabaseDriver() override = default;

    [[nodiscard]] virtual DriverType getType() const noexcept = 0;

protected:
    IDatabaseDriver() = default;
};

// ─── Schema inspector interface ───

class ISchemaInspector {
public:
    virtual ~ISchemaInspector() = default;

    ISchemaInspector(const ISchemaInspector&) = delete;
    ISchemaInspector& operator=(const ISchemaInspector&) = delete;

    [[nodiscard]] virtual std::vector<std::string> getDatabases() = 0;
    [[nodiscard]] virtual std::vector<TableInfo> getTables(std::string_view database) = 0;
    [[nodiscard]] virtual std::vector<ColumnInfo> getColumns(std::string_view table) = 0;
    [[nodiscard]] virtual std::vector<IndexInfo> getIndexes(std::string_view table) = 0;
    [[nodiscard]] virtual std::vector<ForeignKeyInfo> getForeignKeys(std::string_view table) = 0;
    [[nodiscard]] virtual std::vector<StoredProcedureInfo> getStoredProcedures(std::string_view database) = 0;
    [[nodiscard]] virtual std::vector<FunctionInfo> getFunctions(std::string_view database) = 0;

    [[nodiscard]] virtual std::string generateDDL(std::string_view table) = 0;
    [[nodiscard]] virtual std::string generateSelectStatement(std::string_view table) = 0;
    [[nodiscard]] virtual std::string generateInsertStatement(std::string_view table) = 0;
    [[nodiscard]] virtual std::string generateUpdateStatement(std::string_view table) = 0;
    [[nodiscard]] virtual std::string generateDeleteStatement(std::string_view table) = 0;

protected:
    ISchemaInspector() = default;
};

// ─── Factory ───

class DriverFactory {
public:
    [[nodiscard]] static std::unique_ptr<IDatabaseDriver> createDriver(DriverType type);

    [[nodiscard]] static std::unique_ptr<ISchemaInspector> createSchemaInspector(DriverType type, std::shared_ptr<IDatabaseDriver> driver);

    // Dialect factories
    [[nodiscard]] static std::unique_ptr<ISchemaQueryable> createSchemaQueryable(DriverType type);
    [[nodiscard]] static std::unique_ptr<IRelationQueryable> createRelationQueryable(DriverType type);
    [[nodiscard]] static std::unique_ptr<IDDLQueryable> createDDLQueryable(DriverType type);
    [[nodiscard]] static std::unique_ptr<ISqlFormattable> createSqlFormattable(DriverType type);
    [[nodiscard]] static std::unique_ptr<IObjectSearchable> createObjectSearchable(DriverType type);
};

}  // namespace velocitydb
