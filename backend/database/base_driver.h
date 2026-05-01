#pragma once

#include "driver_interface.h"

#include <atomic>
#include <chrono>
#include <cstdint>
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

    [[nodiscard]] std::chrono::seconds queryTimeout() const noexcept override { return std::chrono::seconds{m_queryTimeoutSeconds.load(std::memory_order_relaxed)}; }

    void setQueryTimeout(std::chrono::seconds timeout) override { m_queryTimeoutSeconds.store(timeout.count(), std::memory_order_relaxed); }
    [[nodiscard]] std::string getLastError() const override;

protected:
    BaseDriver() = default;
    ~BaseDriver() override = default;

    std::atomic<bool> m_connected{false};
    std::string m_lastError;  // guarded by m_executeMutex
    /// Stored as raw seconds count so we can use lock-free std::atomic
    /// (std::chrono::seconds itself is not trivially copyable on all stdlibs).
    /// queryTimeout() / setQueryTimeout() handle the chrono conversion.
    std::atomic<std::int64_t> m_queryTimeoutSeconds{kDefaultQueryTimeout.count()};
    /// Guards m_lastError. Subclasses additionally hold this during
    /// execute()/disconnect() and during accessor side effects (e.g.
    /// PostgreSqlDriver::setQueryTimeout pairs the atomic store with
    /// SET statement_timeout under this lock to keep cache and live
    /// session state in sync).
    mutable std::mutex m_executeMutex;
};

}  // namespace velocitydb
