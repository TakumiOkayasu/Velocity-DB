#pragma once

#include "connection_types.h"
#include "driver_interface.h"

#include <Windows.h>
#include <sql.h>
#include <sqlext.h>

#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <string_view>

namespace velocitydb {

class SQLServerDriver : public IDatabaseDriver {
public:
    SQLServerDriver();
    ~SQLServerDriver() override;

    SQLServerDriver(const SQLServerDriver&) = delete;
    SQLServerDriver& operator=(const SQLServerDriver&) = delete;
    SQLServerDriver(SQLServerDriver&&) = delete;
    SQLServerDriver& operator=(SQLServerDriver&&) = delete;

    // IDatabaseDriver interface
    [[nodiscard]] bool connect(std::string_view connectionString) override;
    void disconnect() override;
    [[nodiscard]] bool isConnected() const noexcept override { return m_connected.load(std::memory_order_acquire); }
    void setConnectionTimeout(unsigned int seconds) override;

    [[nodiscard]] ResultSet execute(std::string_view sql) override;
    void cancel() override;
    void setQueryTimeout(std::chrono::seconds timeout) override;
    [[nodiscard]] std::chrono::seconds queryTimeout() const noexcept override;

    [[nodiscard]] std::string getLastError() const override;
    [[nodiscard]] DriverType getType() const noexcept override { return DriverType::SQLServer; }

private:
    SQLHENV m_env = SQL_NULL_HENV;
    SQLHDBC m_dbc = SQL_NULL_HDBC;
    std::atomic<SQLHSTMT> m_stmt{SQL_NULL_HSTMT};
    std::atomic<bool> m_connected{false};
    std::string m_lastError;
    std::chrono::seconds m_queryTimeout{kDefaultQueryTimeout};
    unsigned int m_connectionTimeout{kDefaultConnectionTimeoutSeconds};
    mutable std::mutex m_executeMutex;  // Serializes concurrent execute()/disconnect()/getLastError() calls
};

}  // namespace velocitydb
