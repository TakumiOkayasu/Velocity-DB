#include "transaction_manager.h"

#include "driver_interface.h"

#include <stdexcept>

namespace velocitydb {

TransactionManager::~TransactionManager() {
    if (m_state == TransactionState::Active && m_driver) {
        try {
            rollback();
        } catch (...) {
            // Ignore errors during cleanup
        }
    }
}

void TransactionManager::begin() {
    if (!m_driver) [[unlikely]] {
        throw std::runtime_error("TransactionManager: driver not set. Call setDriver() first.");
    }
    if (!m_driver->isConnected()) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state == TransactionState::Active) [[unlikely]] {
        throw std::runtime_error("Transaction already active");
    }

    // BEGIN TRANSACTION is unambiguous on both SQL Server and PostgreSQL
    // (plain BEGIN is a block statement in SQL Server batch context)
    [[maybe_unused]] auto result = m_driver->execute("BEGIN TRANSACTION");
    if (!m_driver->getLastError().empty()) [[unlikely]] {
        throw std::runtime_error(std::string(m_driver->getLastError()));
    }
    m_state = TransactionState::Active;
}

void TransactionManager::commit() {
    if (!m_driver) [[unlikely]] {
        throw std::runtime_error("TransactionManager: driver not set. Call setDriver() first.");
    }
    if (!m_driver->isConnected()) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state != TransactionState::Active) [[unlikely]] {
        throw std::runtime_error("No active transaction");
    }

    [[maybe_unused]] auto result = m_driver->execute("COMMIT");
    if (!m_driver->getLastError().empty()) [[unlikely]] {
        throw std::runtime_error(std::string(m_driver->getLastError()));
    }
    m_state = TransactionState::Committed;
}

void TransactionManager::rollback() {
    if (!m_driver) [[unlikely]] {
        throw std::runtime_error("TransactionManager: driver not set. Call setDriver() first.");
    }
    if (!m_driver->isConnected()) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state != TransactionState::Active) [[unlikely]] {
        throw std::runtime_error("No active transaction");
    }

    [[maybe_unused]] auto result = m_driver->execute("ROLLBACK");
    if (!m_driver->getLastError().empty()) [[unlikely]] {
        throw std::runtime_error(std::string(m_driver->getLastError()));
    }
    m_state = TransactionState::RolledBack;
}

}  // namespace velocitydb
