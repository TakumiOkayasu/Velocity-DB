#include "transaction_provider.h"

#include "../database/transaction_manager.h"
#include "../interfaces/providers/connection_provider.h"
#include "../utils/json_utils.h"
#include "simdjson.h"

#include <format>

namespace velocitydb {

TransactionProvider::TransactionProvider(IConnectionProvider& connections) : m_connections(connections) {}

TransactionProvider::~TransactionProvider() = default;

void TransactionProvider::cleanupConnection(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);
        auto idResult = doc["connectionId"].get_string();
        if (idResult.error())
            return;
        std::lock_guard lock(m_txMutex);
        m_transactionManagers.erase(std::string(idResult.value()));
    } catch (...) {
        // Best-effort cleanup — do not propagate exceptions
    }
}

std::string TransactionProvider::beginTransaction(std::string_view params) {
    try {
        simdjson::dom::parser parser;
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
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        if (connectionIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: connectionId");
        }
        auto connectionId = std::string(connectionIdResult.value());

        {
            std::lock_guard lock(m_txMutex);
            auto it = m_transactionManagers.find(connectionId);
            if (it == m_transactionManagers.end()) [[unlikely]] {
                return JsonUtils::errorResponse(std::format("No transaction manager for connection: {}", connectionId));
            }
            it->second->commit();
        }
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string TransactionProvider::rollbackTransaction(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        if (connectionIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: connectionId");
        }
        auto connectionId = std::string(connectionIdResult.value());

        {
            std::lock_guard lock(m_txMutex);
            auto it = m_transactionManagers.find(connectionId);
            if (it == m_transactionManagers.end()) [[unlikely]] {
                return JsonUtils::errorResponse(std::format("No transaction manager for connection: {}", connectionId));
            }
            it->second->rollback();
        }
        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
