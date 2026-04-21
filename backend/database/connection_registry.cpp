#include "connection_registry.h"

#include "../network/ssh_tunnel.h"
#include "../utils/logger.h"
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

    m_connections[id] = ConnectionEntry{
        .queryDriver = std::move(queryDriver),
        .metadataDriver = std::move(metadataDriver),
        .driverType = driverType,
        .tunnel = nullptr,
        .params = {},
    };
    return id;
}

void ConnectionRegistry::remove(std::string_view id) {
    std::lock_guard lock(m_mutex);

    auto it = m_connections.find(id);
    if (it == m_connections.end()) {
        return;
    }

    auto& entry = it->second;
    if (entry.queryDriver && entry.queryDriver->isConnected()) {
        entry.queryDriver->disconnect();
    }
    if (entry.metadataDriver && entry.metadataDriver->isConnected()) {
        entry.metadataDriver->disconnect();
    }
    if (entry.tunnel) {
        entry.tunnel->disconnect();
    }
    m_connections.erase(it);
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::getQueryDriver(std::string_view id) {
    std::lock_guard lock(m_mutex);

    auto it = m_connections.find(id);
    if (it != m_connections.end()) {
        return it->second.queryDriver;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::getMetadataDriver(std::string_view id) {
    std::lock_guard lock(m_mutex);

    auto it = m_connections.find(id);
    if (it != m_connections.end()) {
        return it->second.metadataDriver;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::get(std::string_view id) {
    return getQueryDriver(id);
}

std::expected<DriverType, std::string> ConnectionRegistry::getDriverType(std::string_view id) const {
    std::shared_lock lock(m_mutex);
    auto it = m_connections.find(id);
    if (it != m_connections.end()) {
        return it->second.driverType;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

bool ConnectionRegistry::exists(std::string_view id) const {
    std::shared_lock lock(m_mutex);
    return m_connections.contains(id);
}

size_t ConnectionRegistry::count() const {
    std::shared_lock lock(m_mutex);
    return m_connections.size();
}

void ConnectionRegistry::attachTunnel(std::string_view connectionId, std::unique_ptr<SshTunnel> tunnel) {
    std::lock_guard lock(m_mutex);
    auto it = m_connections.find(connectionId);
    if (it != m_connections.end()) {
        it->second.tunnel = std::move(tunnel);
    }
}

void ConnectionRegistry::storeParams(std::string_view connectionId, const DatabaseConnectionParams& params) {
    std::lock_guard lock(m_mutex);
    auto it = m_connections.find(connectionId);
    if (it != m_connections.end()) {
        it->second.params = params;
    }
}

std::optional<DatabaseConnectionParams> ConnectionRegistry::getParams(std::string_view connectionId) const {
    std::shared_lock lock(m_mutex);
    auto it = m_connections.find(connectionId);
    if (it != m_connections.end()) {
        return it->second.params;
    }
    return std::nullopt;
}

SshTunnel* ConnectionRegistry::getTunnel(std::string_view connectionId) const {
    std::shared_lock lock(m_mutex);
    auto it = m_connections.find(connectionId);
    if (it != m_connections.end()) {
        return it->second.tunnel.get();
    }
    return nullptr;
}

void ConnectionRegistry::clear() {
    std::lock_guard lock(m_mutex);

    for (auto& [id, entry] : m_connections) {
        if (entry.queryDriver && entry.queryDriver->isConnected()) {
            entry.queryDriver->disconnect();
        }
        if (entry.metadataDriver && entry.metadataDriver->isConnected()) {
            entry.metadataDriver->disconnect();
        }
        if (entry.tunnel) {
            entry.tunnel->disconnect();
        }
    }
    m_connections.clear();
}

}  // namespace velocitydb
