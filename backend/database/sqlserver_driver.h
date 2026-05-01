#pragma once

#include "base_driver.h"
#include "connection_types.h"

#include <Windows.h>
#include <sql.h>
#include <sqlext.h>

#include <atomic>
#include <string_view>

namespace velocitydb {

class SQLServerDriver : public BaseDriver {
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
    void setConnectionTimeout(unsigned int seconds) override;

    [[nodiscard]] ResultSet execute(std::string_view sql) override;
    void cancel() override;

    [[nodiscard]] DriverType getType() const noexcept override { return DriverType::SQLServer; }

private:
    SQLHENV m_env = SQL_NULL_HENV;
    SQLHDBC m_dbc = SQL_NULL_HDBC;
    std::atomic<SQLHSTMT> m_stmt{SQL_NULL_HSTMT};
    unsigned int m_connectionTimeout{kDefaultConnectionTimeoutSeconds};
};

}  // namespace velocitydb
