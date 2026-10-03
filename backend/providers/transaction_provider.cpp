#include "transaction_provider.h"

#include "../database/driver_interface.h"
#include "../database/result_cache.h"
#include "../database/transaction_manager.h"
#include "../interfaces/providers/connection_provider.h"
#include "../parsers/copy_block_detector.h"
#include "../parsers/split_utils.h"
#include "../parsers/sql_parser.h"
#include "../utils/json_utils.h"
#include "simdjson.h"

#include <algorithm>
#include <format>
#include <stdexcept>

namespace velocitydb {

TransactionProvider::TransactionProvider(IConnectionProvider& connections, std::shared_ptr<ResultCache> cache) : m_connections(connections), m_cache(std::move(cache)) {}

TransactionProvider::~TransactionProvider() = default;

void TransactionProvider::cleanupConnection(std::string_view params) {
    simdjson::dom::parser parser;
    auto doc = parser.parse(params);
    auto key = std::string(doc["connectionId"].get_string().value());
    std::lock_guard lock(m_txMutex);
    if (m_busy.contains(key))
        throw std::runtime_error("Cancel the running query and wait for it to finish before disconnecting");
    m_transactionManagers.erase(key);
}

std::string TransactionProvider::beginTransaction(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        if (connectionIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: connectionId");
        }
        auto connectionId = std::string(connectionIdResult.value());

        auto driver = m_connections.getQueryDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        {
            std::lock_guard lock(m_txMutex);
            if (m_busy.contains(connectionId))
                return JsonUtils::errorResponse("A query is still running on this connection");
            if (!m_transactionManagers.contains(connectionId)) {
                auto txManager = std::make_unique<TransactionManager>();
                txManager->setDriver(driver);
                m_transactionManagers[connectionId] = std::move(txManager);
            }
            m_transactionManagers[connectionId]->begin();
        }
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string TransactionProvider::commitTransaction(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        if (connectionIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: connectionId");
        }
        auto connectionId = std::string(connectionIdResult.value());

        {
            std::lock_guard lock(m_txMutex);
            if (m_busy.contains(connectionId))
                return JsonUtils::errorResponse("A query is still running on this connection");
            auto it = m_transactionManagers.find(connectionId);
            if (it == m_transactionManagers.end()) [[unlikely]] {
                return JsonUtils::errorResponse(std::format("No transaction manager for connection: {}", connectionId));
            }
            it->second->commit();
            if (m_cache)
                m_cache->invalidatePrefix(makeConnectionCachePrefix(connectionId));
        }
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string TransactionProvider::rollbackTransaction(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        if (connectionIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: connectionId");
        }
        auto connectionId = std::string(connectionIdResult.value());

        {
            std::lock_guard lock(m_txMutex);
            if (m_busy.contains(connectionId))
                return JsonUtils::errorResponse("A query is still running on this connection");
            auto it = m_transactionManagers.find(connectionId);
            if (it == m_transactionManagers.end()) [[unlikely]] {
                return JsonUtils::errorResponse(std::format("No transaction manager for connection: {}", connectionId));
            }
            it->second->rollback();
            if (m_cache)
                m_cache->invalidatePrefix(makeConnectionCachePrefix(connectionId));
        }
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

bool TransactionProvider::isInTransaction(std::string_view connectionId) {
    std::lock_guard lock(m_txMutex);
    auto it = m_transactionManagers.find(std::string(connectionId));
    return it != m_transactionManagers.end() && it->second->isInTransaction();
}

std::string TransactionProvider::getTransactionState(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);
        auto key = std::string(doc["connectionId"].get_string().value());
        std::lock_guard lock(m_txMutex);
        auto it = m_transactionManagers.find(key);
        bool active = it != m_transactionManagers.end() && it->second->isInTransaction();
        return JsonUtils::successResponse(std::format(R"({{"active":{},"busy":{}}})", active, m_busy.contains(key)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::shared_ptr<void> TransactionProvider::prepareQuery(std::string_view connectionId, std::string_view sql, bool autoCommit) {
    auto key = std::string(connectionId);
    std::lock_guard lock(m_txMutex);
    if (m_busy.contains(key))
        throw std::runtime_error("A query is still running on this connection");
    auto it = m_transactionManagers.find(key);
    bool active = it != m_transactionManagers.end() && it->second->isInTransaction();
    if (autoCommit && active)
        throw std::runtime_error("Commit or rollback the pending transaction before enabling auto-commit");
    if (!autoCommit) {
        auto driver = m_connections.getQueryDriver(key);
        if (!driver)
            throw std::runtime_error("Connection not found");
        auto statements = splitStatementsForDriver(sql, driver->getType());
        if (std::ranges::any_of(statements, &SQLParser::isTransactionControl))
            throw std::runtime_error("Use Commit/Rollback buttons for manual transactions");
        if (containsCopyFromStdin(sql))
            throw std::runtime_error("COPY FROM stdin uses a separate connection; enable auto-commit for this operation");
        if (!active) {
            auto& manager = m_transactionManagers[key];
            if (!manager) {
                manager = std::make_unique<TransactionManager>();
                manager->setDriver(driver);
            }
            manager->begin();
            if (m_cache)
                m_cache->invalidatePrefix(makeConnectionCachePrefix(key));
        }
    }
    m_busy.insert(key);
    // The async executor retains this lease until execution (including cancellation) finishes.
    return std::shared_ptr<void>(this, [this, key](void*) {
        std::lock_guard releaseLock(m_txMutex);
        m_busy.erase(key);
    });
}

}  // namespace velocitydb
