#pragma once

#include "driver_interface.h"

#include <libpq-fe.h>

#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <string_view>

namespace velocitydb {

class PostgreSqlDriver : public IDatabaseDriver {
public:
    PostgreSqlDriver() = default;
    ~PostgreSqlDriver() override;

    PostgreSqlDriver(const PostgreSqlDriver&) = delete;
    PostgreSqlDriver& operator=(const PostgreSqlDriver&) = delete;
    PostgreSqlDriver(PostgreSqlDriver&&) = delete;
    PostgreSqlDriver& operator=(PostgreSqlDriver&&) = delete;

    // IDatabaseDriver interface
    [[nodiscard]] bool connect(std::string_view connectionString) override;
    void disconnect() override;
    [[nodiscard]] bool isConnected() const noexcept override { return m_connected.load(std::memory_order_acquire); }

    [[nodiscard]] ResultSet execute(std::string_view sql) override;
    void cancel() override;
    void setQueryTimeout(std::chrono::seconds timeout) override;
    [[nodiscard]] std::chrono::seconds queryTimeout() const noexcept override;

    [[nodiscard]] std::string getLastError() const override;
    [[nodiscard]] DriverType getType() const noexcept override { return DriverType::PostgreSQL; }

private:
    std::atomic<PGconn*> m_conn{nullptr};
    std::atomic<bool> m_connected{false};
    std::string m_lastError;
    std::chrono::seconds m_queryTimeout{kDefaultQueryTimeout};
    mutable std::mutex m_executeMutex;
};

}  // namespace velocitydb
