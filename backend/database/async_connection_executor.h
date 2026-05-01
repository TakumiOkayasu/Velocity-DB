#pragma once

#include "../utils/transparent_hash.h"
#include "connection_types.h"
#include "driver_interface.h"

#include <atomic>
#include <chrono>
#include <expected>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_map>

namespace velocitydb {

class SshTunnel;

enum class ConnectStatus { Pending, Connected, Failed, Cancelled };

struct ConnectResult {
    std::string requestId;
    ConnectStatus status = ConnectStatus::Pending;
    std::string errorMessage;
};

class AsyncConnectionExecutor {
public:
    AsyncConnectionExecutor() = default;
    ~AsyncConnectionExecutor();

    AsyncConnectionExecutor(const AsyncConnectionExecutor&) = delete;
    AsyncConnectionExecutor& operator=(const AsyncConnectionExecutor&) = delete;
    AsyncConnectionExecutor(AsyncConnectionExecutor&&) = delete;
    AsyncConnectionExecutor& operator=(AsyncConnectionExecutor&&) = delete;

    /// Submit an async connection request (SSH + DB connect in background).
    /// Returns requestId immediately.
    [[nodiscard]] std::string submitConnect(DatabaseConnectionParams params);

    /// Cancel a pending/running connection request.
    [[nodiscard]] std::expected<void, std::string> cancelConnect(std::string_view requestId);

    /// Get the connected drivers (query + metadata) after successful connection.
    struct ConnectedDrivers {
        std::shared_ptr<IDatabaseDriver> queryDriver;
        std::shared_ptr<IDatabaseDriver> metadataDriver;
        std::unique_ptr<SshTunnel> tunnel;
        DatabaseConnectionParams effectiveParams;
    };

    /// Atomically get result and consume drivers if connected.
    /// Removes task on Connected/Failed/Cancelled (no leak).
    [[nodiscard]] std::expected<ConnectedDrivers, ConnectResult> getResultAndConsume(std::string_view requestId);

private:
    struct ConnectTask {
        std::future<void> future;
        std::atomic<ConnectStatus> status{ConnectStatus::Pending};
        std::atomic<bool> cancelled{false};
        std::shared_ptr<IDatabaseDriver> queryDriver;
        std::shared_ptr<IDatabaseDriver> metadataDriver;
        std::unique_ptr<SshTunnel> tunnel;
        DatabaseConnectionParams effectiveParams;
        std::string errorMessage;
        std::chrono::steady_clock::time_point startTime;
    };

    mutable std::mutex m_mutex;
    std::unordered_map<std::string, std::shared_ptr<ConnectTask>, TransparentStringHash, TransparentStringEqual> m_tasks;
    std::atomic<int> m_counter{1};
};

}  // namespace velocitydb
