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
    auto now = std::chrono::steady_clock::now();

    m_connections[id] = ConnectionEntry{
        .queryDriver = std::move(queryDriver),
        .metadataDriver = std::move(metadataDriver),
        .driverType = driverType,
        .tunnel = nullptr,
        .params = {},
        .lastUsed = now,
        .createdAt = now,
    };
    return id;
}

void ConnectionRegistry::remove(std::string_view id) {
    std::lock_guard lock(m_mutex);
    auto idStr = std::string(id);

    auto it = m_connections.find(idStr);
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
    // tunnel is destroyed automatically via unique_ptr
    m_connections.erase(it);
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::getQueryDriver(std::string_view id) {
    std::lock_guard lock(m_mutex);

    auto it = m_connections.find(std::string(id));
    if (it != m_connections.end()) {
        it->second.lastUsed = std::chrono::steady_clock::now();
        return it->second.queryDriver;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::getMetadataDriver(std::string_view id) {
    std::lock_guard lock(m_mutex);

    auto it = m_connections.find(std::string(id));
    if (it != m_connections.end()) {
        it->second.lastUsed = std::chrono::steady_clock::now();
        return it->second.metadataDriver;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::get(std::string_view id) {
    return getQueryDriver(id);
}

std::expected<ConnectionRegistry::DriverPtr, std::string> ConnectionRegistry::getQueryDriverChecked(std::string_view id) {
    std::lock_guard lock(m_mutex);

    auto it = m_connections.find(std::string(id));
    if (it == m_connections.end()) {
        return std::unexpected(std::format("Connection '{}' not found", id));
    }

    auto& entry = it->second;
    if (!entry.queryDriver || !entry.queryDriver->isConnected()) {
        log<LogLevel::WARNING>(std::format("[DB] Health check failed for connection '{}': not connected", id));
        // Disconnect metadata driver too
        if (entry.metadataDriver && entry.metadataDriver->isConnected()) {
            entry.metadataDriver->disconnect();
        }
        m_connections.erase(it);
        return std::unexpected(std::format("Connection '{}' is no longer active", id));
    }

    // Lightweight health check: SELECT 1
    try {
        [[maybe_unused]] auto _ = entry.queryDriver->execute("SELECT 1");
    } catch (const std::exception& e) {
        log<LogLevel::WARNING>(std::format("[DB] Health check failed for connection '{}': {}", id, e.what()));
        if (entry.queryDriver->isConnected()) {
            entry.queryDriver->disconnect();
        }
        if (entry.metadataDriver && entry.metadataDriver->isConnected()) {
            entry.metadataDriver->disconnect();
        }
        m_connections.erase(it);
        return std::unexpected(std::format("Connection '{}' health check failed: {}", id, e.what()));
    }

    entry.lastUsed = std::chrono::steady_clock::now();
    return entry.queryDriver;
}

std::expected<DriverType, std::string> ConnectionRegistry::getDriverType(std::string_view id) const {
    std::shared_lock lock(m_mutex);
    auto it = m_connections.find(std::string(id));
    if (it != m_connections.end()) {
        return it->second.driverType;
    }
    return std::unexpected(std::format("Connection '{}' not found", id));
}

bool ConnectionRegistry::exists(std::string_view id) const {
    std::shared_lock lock(m_mutex);
    return m_connections.contains(std::string(id));
}

size_t ConnectionRegistry::count() const {
    std::shared_lock lock(m_mutex);
    return m_connections.size();
}

void ConnectionRegistry::attachTunnel(std::string_view connectionId, std::unique_ptr<SshTunnel> tunnel) {
    std::lock_guard lock(m_mutex);
    auto it = m_connections.find(std::string(connectionId));
    if (it != m_connections.end()) {
        it->second.tunnel = std::move(tunnel);
    }
}

void ConnectionRegistry::storeParams(std::string_view connectionId, const DatabaseConnectionParams& params) {
    std::lock_guard lock(m_mutex);
    auto it = m_connections.find(std::string(connectionId));
    if (it != m_connections.end()) {
        it->second.params = params;
    }
}

std::optional<DatabaseConnectionParams> ConnectionRegistry::getParams(std::string_view connectionId) const {
    std::shared_lock lock(m_mutex);
    auto it = m_connections.find(std::string(connectionId));
    if (it != m_connections.end()) {
        return it->second.params;
    }
    return std::nullopt;
}

SshTunnel* ConnectionRegistry::getTunnel(std::string_view connectionId) const {
    std::shared_lock lock(m_mutex);
    auto it = m_connections.find(std::string(connectionId));
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
    }
    m_connections.clear();
}

size_t ConnectionRegistry::evictIdleConnections(std::chrono::minutes maxIdleDuration) {
    std::lock_guard lock(m_mutex);
    if (m_connections.empty()) {
        return 0;
    }

    auto now = std::chrono::steady_clock::now();
    size_t evicted = 0;

    std::erase_if(m_connections, [&](auto& pair) {
        auto& entry = pair.second;
        if ((now - entry.lastUsed) > maxIdleDuration) {
            log<LogLevel::INFO>(std::format("[DB] Evicting idle connection '{}'", pair.first));
            if (entry.queryDriver && entry.queryDriver->isConnected()) {
                entry.queryDriver->disconnect();
            }
            if (entry.metadataDriver && entry.metadataDriver->isConnected()) {
                entry.metadataDriver->disconnect();
            }
            ++evicted;
            return true;
        }
        return false;
    });

    return evicted;
}

}  // namespace velocitydb
