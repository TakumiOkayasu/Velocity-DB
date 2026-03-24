#include "async_connection_executor.h"

#include "../network/ssh_tunnel.h"
#include "../utils/logger.h"

#include <format>

namespace velocitydb {

AsyncConnectionExecutor::~AsyncConnectionExecutor() {
    std::vector<std::shared_ptr<ConnectTask>> tasks;

    {
        std::lock_guard lock(m_mutex);
        tasks.reserve(m_tasks.size());
        for (auto& [id, task] : m_tasks) {
            tasks.push_back(task);
        }
    }

    for (auto& task : tasks) {
        if (task->status == ConnectStatus::Pending) {
            task->cancelled.store(true, std::memory_order_release);
        }
        if (task->future.valid()) {
            task->future.wait();
        }
    }
}

std::string AsyncConnectionExecutor::submitConnect(PreparedConnectRequest request) {
    auto requestId = std::format("conn_{}", m_counter++);

    auto task = std::make_shared<ConnectTask>();
    task->connectionString = std::move(request.connectionString);
    task->driverType = request.driverType;
    task->effectiveParams = std::move(request.effectiveParams);
    task->tunnel = std::move(request.tunnel);
    task->startTime = std::chrono::steady_clock::now();
    task->status = ConnectStatus::Pending;

    task->future = std::async(std::launch::async, [task]() {
        try {
            // Create and connect query driver
            auto queryDriver = DriverFactory::createDriver(task->driverType);
            std::shared_ptr<IDatabaseDriver> queryDriverPtr(std::move(queryDriver));
            queryDriverPtr->setConnectionTimeout(task->effectiveParams.connectionTimeoutSeconds);

            if (!queryDriverPtr->connect(task->connectionString)) {
                task->errorMessage = std::format("Connection failed: {}", queryDriverPtr->getLastError());
                task->status = ConnectStatus::Failed;
                return;
            }

            // Check cancellation between the two connections
            if (task->cancelled.load(std::memory_order_acquire)) {
                queryDriverPtr->disconnect();
                task->status = ConnectStatus::Cancelled;
                return;
            }

            // Create and connect metadata driver
            auto metadataDriver = DriverFactory::createDriver(task->driverType);
            std::shared_ptr<IDatabaseDriver> metadataDriverPtr(std::move(metadataDriver));
            metadataDriverPtr->setConnectionTimeout(task->effectiveParams.connectionTimeoutSeconds);

            if (!metadataDriverPtr->connect(task->connectionString)) {
                queryDriverPtr->disconnect();
                task->errorMessage = std::format("Metadata connection failed: {}", metadataDriverPtr->getLastError());
                task->status = ConnectStatus::Failed;
                return;
            }

            // Check cancellation after both connections
            if (task->cancelled.load(std::memory_order_acquire)) {
                queryDriverPtr->disconnect();
                metadataDriverPtr->disconnect();
                task->status = ConnectStatus::Cancelled;
                return;
            }

            task->queryDriver = std::move(queryDriverPtr);
            task->metadataDriver = std::move(metadataDriverPtr);
            task->status = ConnectStatus::Connected;

            log<LogLevel::DEBUG>("[DB] Async connection completed successfully");
        } catch (const std::exception& e) {
            task->errorMessage = e.what();
            task->status = ConnectStatus::Failed;
        }
    });

    std::lock_guard lock(m_mutex);
    m_tasks[requestId] = task;

    return requestId;
}

bool AsyncConnectionExecutor::cancelConnect(std::string_view requestId) {
    std::lock_guard lock(m_mutex);

    auto iter = m_tasks.find(std::string(requestId));
    if (iter == m_tasks.end()) {
        return false;
    }

    auto& task = iter->second;
    auto status = task->status.load();
    if (status == ConnectStatus::Pending) {
        task->cancelled.store(true, std::memory_order_release);
        task->status = ConnectStatus::Cancelled;
        return true;
    }

    return false;
}

std::expected<AsyncConnectionExecutor::ConnectedDrivers, ConnectResult> AsyncConnectionExecutor::getResultAndConsume(std::string_view requestId) {
    std::lock_guard lock(m_mutex);

    auto iter = m_tasks.find(std::string(requestId));
    if (iter == m_tasks.end()) {
        return std::unexpected(ConnectResult{
            .requestId = std::string(requestId),
            .status = ConnectStatus::Failed,
            .errorMessage = "Request not found",
        });
    }

    auto& task = iter->second;
    auto status = task->status.load();

    if (status == ConnectStatus::Connected && task->queryDriver && task->metadataDriver) {
        ConnectedDrivers drivers{
            .queryDriver = std::move(task->queryDriver),
            .metadataDriver = std::move(task->metadataDriver),
            .tunnel = std::move(task->tunnel),
            .effectiveParams = std::move(task->effectiveParams),
        };
        m_tasks.erase(iter);
        return drivers;
    }

    ConnectResult result{
        .requestId = std::string(requestId),
        .status = status,
        .errorMessage = task->errorMessage,
    };

    if (status == ConnectStatus::Failed || status == ConnectStatus::Cancelled) {
        m_tasks.erase(iter);
    }

    return std::unexpected(result);
}

}  // namespace velocitydb
