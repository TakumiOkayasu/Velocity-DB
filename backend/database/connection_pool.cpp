#include "connection_pool.h"

#include "odbc_driver_detector.h"
#include "sqlserver_driver.h"

#include <algorithm>
#include <format>
#include <ranges>

namespace predategrip {

namespace {
/// Escapes special characters in ODBC connection string values.
/// Wraps value in braces and escapes any closing braces by doubling them.
/// This prevents connection string injection attacks with special characters.
std::string escapeOdbcValue(std::string_view value) {
    std::string result = "{";
    for (auto c : value) {
        if (c == '}') {
            result += "}}";  // Escape closing brace by doubling
        } else {
            result += c;
        }
    }
    result += "}";
    return result;
}
}  // namespace

ConnectionPool::~ConnectionPool() {
    std::lock_guard lock(m_mutex);
    while (!m_available.empty()) {
        m_available.pop();
    }
}

bool ConnectionPool::addConnection(const ConnectionInfo& info) {
    std::lock_guard lock(m_mutex);

    auto driver = std::make_shared<SQLServerDriver>();
    std::string connStr = buildConnectionString(info);

    if (!driver->connect(connStr)) [[unlikely]] {
        return false;
    }

    driver->disconnect();
    m_connections.push_back(info);
    return true;
}

void ConnectionPool::removeConnection(std::string_view id) {
    std::lock_guard lock(m_mutex);
    std::erase_if(m_connections, [id](const ConnectionInfo& info) { return info.id == id; });
}

std::shared_ptr<SQLServerDriver> ConnectionPool::acquire(std::string_view connectionId) {
    std::unique_lock lock(m_mutex);

    auto it = std::ranges::find_if(m_connections, [connectionId](const ConnectionInfo& info) { return info.id == connectionId; });

    if (it == m_connections.end()) [[unlikely]] {
        return nullptr;
    }

    auto driver = std::make_shared<SQLServerDriver>();
    std::string connStr = buildConnectionString(*it);

    if (!driver->connect(connStr)) [[unlikely]] {
        return nullptr;
    }

    return driver;
}

void ConnectionPool::release(std::shared_ptr<SQLServerDriver> connection) {
    if (connection) {
        connection->disconnect();
    }
}

std::vector<ConnectionInfo> ConnectionPool::getConnections() const {
    std::lock_guard lock(m_mutex);
    return m_connections;
}

bool ConnectionPool::testConnection(const ConnectionInfo& info) {
    auto driver = std::make_shared<SQLServerDriver>();
    std::string connStr = buildConnectionString(info);

    bool success = driver->connect(connStr);
    if (success) {
        driver->disconnect();
    }

    return success;
}

std::string ConnectionPool::buildConnectionString(const ConnectionInfo& info) const {
    auto connStr = buildDriverConnectionPrefix(info.server, info.database);

    if (info.useWindowsAuth) {
        connStr += "Trusted_Connection=yes;";
    } else {
        // Escape username and password to prevent connection string injection
        // Special characters like ; = { } in passwords can break parsing or allow injection
        connStr += std::format("UID={};PWD={};", escapeOdbcValue(info.username), escapeOdbcValue(info.password));
    }

    return connStr;
}

}  // namespace predategrip
