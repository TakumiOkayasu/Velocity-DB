#pragma once

#include <condition_variable>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <string_view>
#include <vector>

namespace predategrip {

class SQLServerDriver;

struct ConnectionInfo {
    std::string id;
    std::string name;
    std::string server;
    std::string database;
    std::string username;
    std::string password;
    bool useWindowsAuth = true;
};

class ConnectionPool {
public:
    explicit ConnectionPool(size_t poolSize = 5) : m_poolSize(poolSize) {}
    ~ConnectionPool();

    ConnectionPool(const ConnectionPool&) = delete;
    ConnectionPool& operator=(const ConnectionPool&) = delete;

    [[nodiscard]] bool addConnection(const ConnectionInfo& info);
    void removeConnection(std::string_view id);

    [[nodiscard]] std::shared_ptr<SQLServerDriver> acquire(std::string_view connectionId);
    void release(std::shared_ptr<SQLServerDriver> connection);

    [[nodiscard]] std::vector<ConnectionInfo> getConnections() const;
    [[nodiscard]] bool testConnection(const ConnectionInfo& info);

private:
    [[nodiscard]] std::string buildConnectionString(const ConnectionInfo& info) const;

    size_t m_poolSize;
    mutable std::mutex m_mutex;
    std::condition_variable m_condition;
    std::vector<ConnectionInfo> m_connections;
    std::queue<std::shared_ptr<SQLServerDriver>> m_available;
};

}  // namespace predategrip
