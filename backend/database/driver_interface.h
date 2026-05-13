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
    /// Values reference memory owned by ResultSet::storage (driver-specific
    /// backing such as a PGresult buffer or a string arena). The string_view
    /// itself is cheap (pointer + length) and avoids per-cell std::string
    /// allocation on the hot path (1M rows x 10 cols = 10M cells for the
    /// SELECT 100万行 bench, issue #553).
    std::vector<std::string_view> values;
    std::vector<bool> nullFlags;  // true = SQL NULL

    [[nodiscard]] bool isNull(size_t index) const noexcept { return index < nullFlags.size() && nullFlags[index]; }
};

struct ResultSet {
    std::vector<ColumnInfo> columns;
    std::vector<ResultRow> rows;
    int64_t affectedRows = 0;
    double executionTimeMs = 0.0;

    /// Type-erased backing for the string_views in `rows`. Held only for
    /// lifetime: shared_ptr lets ResultSet copy (e.g. result_cache) without
    /// duplicating the underlying buffer. Concrete types are driver-private
    /// (PGresult* with PQclear deleter for PostgreSQL, std::deque<std::string>
    /// arena for ODBC / synthetic results).
    std::shared_ptr<void> storage;
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

// ─── Factory ───

class DriverFactory {
public:
    [[nodiscard]] static std::unique_ptr<IDatabaseDriver> createDriver(DriverType type);

    // Dialect factories
    [[nodiscard]] static std::unique_ptr<ISchemaQueryable> createSchemaQueryable(DriverType type);
    [[nodiscard]] static std::unique_ptr<IRelationQueryable> createRelationQueryable(DriverType type);
    [[nodiscard]] static std::unique_ptr<IDDLQueryable> createDDLQueryable(DriverType type);
    [[nodiscard]] static std::unique_ptr<ISqlFormattable> createSqlFormattable(DriverType type);
    [[nodiscard]] static std::unique_ptr<IObjectSearchable> createObjectSearchable(DriverType type);
};

}  // namespace velocitydb
