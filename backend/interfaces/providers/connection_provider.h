#pragma once

#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace velocitydb {

class IDatabaseDriver;
struct DatabaseConnectionParams;
enum class DriverType;

/// Interface for database connection lifecycle and driver access
class IConnectionProvider {
public:
    virtual ~IConnectionProvider() = default;

    [[nodiscard]] virtual std::string connectAsync(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getConnectResult(std::string_view params) = 0;
    [[nodiscard]] virtual std::string cancelConnect(std::string_view params) = 0;
    [[nodiscard]] virtual std::string disconnect(std::string_view params) = 0;
    [[nodiscard]] virtual std::string testConnection(std::string_view params) = 0;

    [[nodiscard]] virtual std::shared_ptr<IDatabaseDriver> getQueryDriver(std::string_view connectionId) = 0;
    [[nodiscard]] virtual std::shared_ptr<IDatabaseDriver> getMetadataDriver(std::string_view connectionId) = 0;

    /// Get the driver type for a connection.
    /// @note Throws on failure (unlike getQueryDriver/getMetadataDriver which return nullptr).
    ///       Always called after driver existence is confirmed, so failure indicates a logic error.
    [[nodiscard]] virtual DriverType getDriverType(std::string_view connectionId) const = 0;

    /// Get stored effective connection parameters (for psql delegation)
    [[nodiscard]] virtual std::optional<DatabaseConnectionParams> getConnectionParams(std::string_view connectionId) const = 0;
};

}  // namespace velocitydb
