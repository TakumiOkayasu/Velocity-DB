#pragma once

#include <expected>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

// Forward declarations
struct ColumnInfo;
struct ResultSet;
struct TableInfo;
struct IndexInfo;
struct ForeignKeyInfo;
struct StoredProcedureInfo;
struct FunctionInfo;

// Database driver type enumeration
enum class DriverType {
    SQLServer,
    PostgreSQL,  // Future support
    MySQL        // Future support
};

// Convert driver type to string
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

// Abstract interface for database drivers
class IDatabaseDriver {
public:
    virtual ~IDatabaseDriver() = default;

    // Non-copyable
    IDatabaseDriver(const IDatabaseDriver&) = delete;
    IDatabaseDriver& operator=(const IDatabaseDriver&) = delete;

    // Connection management
    [[nodiscard]] virtual bool connect(std::string_view connectionString) = 0;
    virtual void disconnect() = 0;
    [[nodiscard]] virtual bool isConnected() const noexcept = 0;

    // Query execution
    [[nodiscard]] virtual ResultSet execute(std::string_view sql) = 0;
    virtual void cancel() = 0;

    // Error handling
    [[nodiscard]] virtual std::string_view getLastError() const noexcept = 0;

    // Driver identification
    [[nodiscard]] virtual DriverType getType() const noexcept = 0;

protected:
    IDatabaseDriver() = default;
};

// Abstract interface for schema inspection
class ISchemaProvider {
public:
    virtual ~ISchemaProvider() = default;

    // Non-copyable
    ISchemaProvider(const ISchemaProvider&) = delete;
    ISchemaProvider& operator=(const ISchemaProvider&) = delete;

    // Schema inspection
    [[nodiscard]] virtual std::vector<std::string> getDatabases() = 0;
    [[nodiscard]] virtual std::vector<TableInfo> getTables(std::string_view database) = 0;
    [[nodiscard]] virtual std::vector<ColumnInfo> getColumns(std::string_view table) = 0;
    [[nodiscard]] virtual std::vector<IndexInfo> getIndexes(std::string_view table) = 0;
    [[nodiscard]] virtual std::vector<ForeignKeyInfo> getForeignKeys(std::string_view table) = 0;
    [[nodiscard]] virtual std::vector<StoredProcedureInfo> getStoredProcedures(std::string_view database) = 0;
    [[nodiscard]] virtual std::vector<FunctionInfo> getFunctions(std::string_view database) = 0;

    // SQL generation
    [[nodiscard]] virtual std::string generateDDL(std::string_view table) = 0;
    [[nodiscard]] virtual std::string generateSelectStatement(std::string_view table) = 0;
    [[nodiscard]] virtual std::string generateInsertStatement(std::string_view table) = 0;
    [[nodiscard]] virtual std::string generateUpdateStatement(std::string_view table) = 0;
    [[nodiscard]] virtual std::string generateDeleteStatement(std::string_view table) = 0;

protected:
    ISchemaProvider() = default;
};

// Factory for creating database drivers and schema providers
class DriverFactory {
public:
    // Create a database driver for the specified type
    [[nodiscard]] static std::unique_ptr<IDatabaseDriver> createDriver(DriverType type);

    // Create a schema provider for the specified driver
    [[nodiscard]] static std::unique_ptr<ISchemaProvider> createSchemaProvider(DriverType type, std::shared_ptr<IDatabaseDriver> driver);
};

}  // namespace velocitydb
