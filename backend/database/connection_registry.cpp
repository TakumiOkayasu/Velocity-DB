#include "connection_registry.h"

#include "../network/ssh_tunnel.h"
#include "driver_interface.h"

#include <format>
#include <optional>

namespace velocitydb {

ConnectionRegistry::~ConnectionRegistry() {
    clear();
}

std::string ConnectionRegistry::add(DriverPtr queryDriver, DriverPtr metadataDriver, DriverType driverType) {
    std::lock_guard lock(m_mutex);
    auto id = std::format("conn_{}", m_counter.fetch_add(1));
    m_queryConnections[id] = std::move(queryDriver);
    m_metadataConnections[id] = std::move(metadataDriver);
    m_driverTypes[id] = driverType;
    return id;
}

void ConnectionRegistry::remove(std::string_view id) {
    std::lock_guard lock(m_mutex);
    auto idStr = std::string(id);

    // Remove driver type and connection params
    m_driverTypes.erase(idStr);
    m_connectionParams.erase(idStr);

    // Close and remove SSH tunnel first
    if (auto tunnelIt = m_tunnels.find(idStr); tunnelIt != m_tunnels.end()) {
        m_tunnels.erase(tunnelIt);
    }

    // Disconnect and remove query driver
    if (auto it = m_queryConnections.find(idStr); it != m_queryConnections.end()) {
        if (it->second && it->second->isConnected()) {
            it->second->disconnect();
        }
        m_queryConnections.erase(it);
    }

    // Disconnect and remove metadata driver
    if (auto it = m_metadataConnections.find(idStr); it != m_metadataConnections.end()) {
        if (it->second && it->second->isConnected()) {
            it->second->disconnect();
        }
        m_metadataConnections.erase(it);
    }
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::getQueryDriver(std::string_view id) const {
    std::shared_lock lock(m_mutex);

    if (auto it = m_queryConnections.find(std::string(id)); it != m_queryConnections.end()) {
        return it->second;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::getMetadataDriver(std::string_view id) const {
    std::shared_lock lock(m_mutex);

    if (auto it = m_metadataConnections.find(std::string(id)); it != m_metadataConnections.end()) {
        return it->second;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::get(std::string_view id) const {
    return getQueryDriver(id);
}

std::expected<DriverType, std::string> ConnectionRegistry::getDriverType(std::string_view id) const {
    std::shared_lock lock(m_mutex);
    if (auto it = m_driverTypes.find(std::string(id)); it != m_driverTypes.end()) {
        return it->second;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

bool ConnectionRegistry::exists(std::string_view id) const {
    std::shared_lock lock(m_mutex);
    return m_queryConnections.contains(std::string(id));
}

size_t ConnectionRegistry::count() const {
    std::shared_lock lock(m_mutex);
    return m_queryConnections.size();
}

void ConnectionRegistry::attachTunnel(std::string_view connectionId, std::unique_ptr<SshTunnel> tunnel) {
    std::lock_guard lock(m_mutex);
    m_tunnels[std::string(connectionId)] = std::move(tunnel);
}

void ConnectionRegistry::storeParams(std::string_view connectionId, const DatabaseConnectionParams& params) {
    std::lock_guard lock(m_mutex);
    m_connectionParams[std::string(connectionId)] = params;
}

std::optional<DatabaseConnectionParams> ConnectionRegistry::getParams(std::string_view connectionId) const {
    std::shared_lock lock(m_mutex);
    if (auto it = m_connectionParams.find(std::string(connectionId)); it != m_connectionParams.end()) {
        return it->second;
    }
    return std::nullopt;
}

SshTunnel* ConnectionRegistry::getTunnel(std::string_view connectionId) const {
    std::shared_lock lock(m_mutex);

    if (auto it = m_tunnels.find(std::string(connectionId)); it != m_tunnels.end()) {
        return it->second.get();
    }
    return nullptr;
}

void ConnectionRegistry::clear() {
    std::lock_guard lock(m_mutex);

    // Clear driver types and connection params
    m_driverTypes.clear();
    m_connectionParams.clear();

    // Close all tunnels
    m_tunnels.clear();

    // Disconnect all query connections
    for (auto& [id, driver] : m_queryConnections) {
        if (driver && driver->isConnected()) {
            driver->disconnect();
        }
    }
    m_queryConnections.clear();

    // Disconnect all metadata connections
    for (auto& [id, driver] : m_metadataConnections) {
        if (driver && driver->isConnected()) {
            driver->disconnect();
        }
    }
    m_metadataConnections.clear();
}

}  // namespace velocitydb
