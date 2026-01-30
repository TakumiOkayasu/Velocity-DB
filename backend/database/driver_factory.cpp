#include "driver_interface.h"
#include "schema_inspector.h"
#include "sqlserver_driver.h"

#include <stdexcept>

namespace velocitydb {

std::unique_ptr<IDatabaseDriver> DriverFactory::createDriver(DriverType type) {
    switch (type) {
        case DriverType::SQLServer:
            return std::make_unique<SQLServerDriver>();
        case DriverType::PostgreSQL:
            throw std::runtime_error("PostgreSQL driver not yet implemented");
        case DriverType::MySQL:
            throw std::runtime_error("MySQL driver not yet implemented");
    }
    throw std::runtime_error("Unknown driver type");
}

std::unique_ptr<ISchemaProvider> DriverFactory::createSchemaProvider(DriverType type, std::shared_ptr<IDatabaseDriver> driver) {
    switch (type) {
        case DriverType::SQLServer: {
            auto sqlServerDriver = std::dynamic_pointer_cast<SQLServerDriver>(std::move(driver));
            if (!sqlServerDriver) {
                throw std::runtime_error("Invalid driver type for SQL Server schema provider");
            }
            auto inspector = std::make_unique<SchemaInspector>();
            inspector->setDriver(std::move(sqlServerDriver));
            return inspector;
        }
        case DriverType::PostgreSQL:
            throw std::runtime_error("PostgreSQL schema provider not yet implemented");
        case DriverType::MySQL:
            throw std::runtime_error("MySQL schema provider not yet implemented");
    }
    throw std::runtime_error("Unknown driver type");
}

}  // namespace velocitydb
