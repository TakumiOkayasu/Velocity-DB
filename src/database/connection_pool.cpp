#include "connection_pool.h"
#include "sqlserver_driver.h"

namespace predategrip {

ConnectionPool::ConnectionPool(size_t poolSize)
    : m_poolSize(poolSize)
{
}

ConnectionPool::~ConnectionPool() {
    std::lock_guard<std::mutex> lock(m_mutex);
    while (!m_available.empty()) {
        m_available.pop();
    }
}

bool ConnectionPool::addConnection(const ConnectionInfo& info) {
    std::lock_guard<std::mutex> lock(m_mutex);

    // Test connection first
    auto driver = std::make_shared<SQLServerDriver>();
    std::string connStr = buildConnectionString(info);

    if (!driver->connect(connStr)) {
        return false;
    }

    driver->disconnect();
    m_connections.push_back(info);
    return true;
}

void ConnectionPool::removeConnection(const std::string& id) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_connections.erase(
        std::remove_if(m_connections.begin(), m_connections.end(),
            [&id](const ConnectionInfo& info) { return info.id == id; }),
        m_connections.end()
    );
}

std::shared_ptr<SQLServerDriver> ConnectionPool::acquire(const std::string& connectionId) {
    std::unique_lock<std::mutex> lock(m_mutex);

    // Find connection info
    auto it = std::find_if(m_connections.begin(), m_connections.end(),
        [&connectionId](const ConnectionInfo& info) { return info.id == connectionId; });

    if (it == m_connections.end()) {
        return nullptr;
    }

    // Create new connection
    auto driver = std::make_shared<SQLServerDriver>();
    std::string connStr = buildConnectionString(*it);

    if (!driver->connect(connStr)) {
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
    std::lock_guard<std::mutex> lock(m_mutex);
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
    std::string connStr = "Driver={ODBC Driver 17 for SQL Server};";
    connStr += "Server=" + info.server + ";";
    connStr += "Database=" + info.database + ";";

    if (info.useWindowsAuth) {
        connStr += "Trusted_Connection=yes;";
    } else {
        connStr += "UID=" + info.username + ";";
        connStr += "PWD=" + info.password + ";";
    }

    return connStr;
}

}  // namespace predategrip
