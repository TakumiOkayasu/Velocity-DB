#pragma once

#include "../interfaces/statement_handler.h"
#include "base_driver.h"

#include <libpq-fe.h>

#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string_view>
#include <vector>

namespace velocitydb {

class PostgreSqlDriver : public BaseDriver {
public:
    PostgreSqlDriver();
    ~PostgreSqlDriver() override;

    PostgreSqlDriver(const PostgreSqlDriver&) = delete;
    PostgreSqlDriver& operator=(const PostgreSqlDriver&) = delete;
    PostgreSqlDriver(PostgreSqlDriver&&) = delete;
    PostgreSqlDriver& operator=(PostgreSqlDriver&&) = delete;

    // IDatabaseDriver interface
    [[nodiscard]] bool connect(std::string_view connectionString) override;
    void disconnect() override;

    [[nodiscard]] ResultSet execute(std::string_view sql) override;
    void cancel() override;

    /// PostgreSQL needs to push the new timeout to the live connection in
    /// addition to updating the cached value, so it overrides the base impl.
    void setQueryTimeout(std::chrono::seconds timeout) override;

    [[nodiscard]] DriverType getType() const noexcept override { return DriverType::PostgreSQL; }

private:
    std::atomic<PGconn*> m_conn{nullptr};

    /// Serializes m_conn lifetime against cancel(). cancel() must NOT take
    /// m_executeMutex (per IQueryExecutable::cancel contract: "execute() が
    /// ブロック中でもロックなしで呼び出し可能"), so a separate lightweight
    /// mutex protects PQgetCancel against concurrent PQfinish in disconnect().
    mutable std::mutex m_connLifecycleMutex;

    /// OCP: special statement protocol handlers
    std::vector<std::unique_ptr<IStatementHandler>> m_handlers;
};

}  // namespace velocitydb
