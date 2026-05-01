#include "driver_interface.h"
#include "postgresql_dialect.h"
#include "postgresql_driver.h"
#include "sqlserver_dialect.h"
#include "sqlserver_driver.h"

#include <stdexcept>

namespace velocitydb {

namespace {

/// Creates a dialect instance cast to the requested ISP interface.
/// Both SqlServerDialect and PostgreSqlDialect implement all 5 ISP interfaces,
/// so this single helper eliminates duplication across the 5 factory methods.
template <typename T>
std::unique_ptr<T> createDialectAs(DriverType type) {
    switch (type) {
        case DriverType::SQLServer:
            return std::make_unique<SqlServerDialect>();
        case DriverType::PostgreSQL:
            return std::make_unique<PostgreSqlDialect>();
        case DriverType::MySQL:
            throw std::runtime_error("MySQL dialect not yet implemented");
    }
    throw std::runtime_error("Unknown driver type");
}

}  // namespace

std::unique_ptr<IDatabaseDriver> DriverFactory::createDriver(DriverType type) {
    switch (type) {
        case DriverType::SQLServer:
            return std::make_unique<SQLServerDriver>();
        case DriverType::PostgreSQL:
            return std::make_unique<PostgreSqlDriver>();
        case DriverType::MySQL:
            throw std::runtime_error("MySQL driver not yet implemented");
    }
    throw std::runtime_error("Unknown driver type");
}

std::unique_ptr<ISchemaQueryable> DriverFactory::createSchemaQueryable(DriverType type) {
    return createDialectAs<ISchemaQueryable>(type);
}

std::unique_ptr<IRelationQueryable> DriverFactory::createRelationQueryable(DriverType type) {
    return createDialectAs<IRelationQueryable>(type);
}

std::unique_ptr<IDDLQueryable> DriverFactory::createDDLQueryable(DriverType type) {
    return createDialectAs<IDDLQueryable>(type);
}

std::unique_ptr<ISqlFormattable> DriverFactory::createSqlFormattable(DriverType type) {
    return createDialectAs<ISqlFormattable>(type);
}

std::unique_ptr<IObjectSearchable> DriverFactory::createObjectSearchable(DriverType type) {
    return createDialectAs<IObjectSearchable>(type);
}

}  // namespace velocitydb
