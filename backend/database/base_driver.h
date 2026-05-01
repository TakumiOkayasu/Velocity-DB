#pragma once

#include "driver_interface.h"

#include <atomic>
#include <chrono>
#include <mutex>
#include <string>

namespace velocitydb {

/// Common state and accessor implementations shared by SQLServerDriver / PostgreSqlDriver.
///
/// Hierarchy: IDatabaseDriver <- BaseDriver <- SQLServerDriver / PostgreSqlDriver (depth 2).
/// Holds the four members that were previously duplicated across both drivers
/// (connection flag / last error / query timeout / execute mutex) and provides
/// non-virtual default implementations of the accessors that have identical
/// semantics in both drivers. Subclasses still implement protocol-specific
/// connect/disconnect/execute/cancel and may override accessors when a
/// driver-specific side effect is required (PostgreSqlDriver::setQueryTimeout
/// issues `SET statement_timeout` to the live connection).
class BaseDriver : public IDatabaseDriver {
public:
    [[nodiscard]] bool isConnected() const noexcept override { return m_connected.load(std::memory_order_acquire); }

    [[nodiscard]] std::chrono::seconds queryTimeout() const noexcept override { return m_queryTimeout; }

    void setQueryTimeout(std::chrono::seconds timeout) override;
    [[nodiscard]] std::string getLastError() const override;

protected:
    BaseDriver() = default;
    ~BaseDriver() override = default;

    /// Assign to m_queryTimeout. Caller must already hold m_executeMutex.
    /// Provided so subclasses adding side effects (e.g. PostgreSqlDriver
    /// pushing SET statement_timeout) can reuse the assignment without
    /// re-acquiring the lock.
    void setQueryTimeoutLocked(std::chrono::seconds timeout) noexcept { m_queryTimeout = timeout; }

    std::atomic<bool> m_connected{false};
    std::string m_lastError;  // guarded by m_executeMutex
    std::chrono::seconds m_queryTimeout{kDefaultQueryTimeout};
    /// Guards m_lastError / m_queryTimeout. Subclasses additionally hold this
    /// during execute()/disconnect() to serialize against cancel() and getLastError().
    mutable std::mutex m_executeMutex;
};

}  // namespace velocitydb
