#pragma once

#include <string>
#include <vector>
#include <memory>
#include <mutex>
#include <condition_variable>
#include <queue>

namespace predategrip {

class SQLServerDriver;

struct ConnectionInfo {
    std::string id;
    std::string name;
    std::string server;
    std::string database;
    std::string username;
    std::string password;
    bool useWindowsAuth;
};

class ConnectionPool {
public:
    ConnectionPool(size_t poolSize = 5);
    ~ConnectionPool();

    ConnectionPool(const ConnectionPool&) = delete;
    ConnectionPool& operator=(const ConnectionPool&) = delete;

    bool addConnection(const ConnectionInfo& info);
    void removeConnection(const std::string& id);

    std::shared_ptr<SQLServerDriver> acquire(const std::string& connectionId);
    void release(std::shared_ptr<SQLServerDriver> connection);

    std::vector<ConnectionInfo> getConnections() const;
    bool testConnection(const ConnectionInfo& info);

private:
    std::string buildConnectionString(const ConnectionInfo& info) const;

    size_t m_poolSize;
    mutable std::mutex m_mutex;
    std::condition_variable m_condition;
    std::vector<ConnectionInfo> m_connections;
    std::queue<std::shared_ptr<SQLServerDriver>> m_available;
};

}  // namespace predategrip
