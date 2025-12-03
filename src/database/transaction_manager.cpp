#include "transaction_manager.h"

#include "sqlserver_driver.h"

#include <stdexcept>

namespace predategrip {

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
    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state == TransactionState::Active) [[unlikely]] {
        throw std::runtime_error("Transaction already active");
    }

    m_driver->execute("BEGIN TRANSACTION");
    m_state = TransactionState::Active;
}

void TransactionManager::commit() {
    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state != TransactionState::Active) [[unlikely]] {
        throw std::runtime_error("No active transaction");
    }

    m_driver->execute("COMMIT TRANSACTION");
    m_state = TransactionState::Committed;
}

void TransactionManager::rollback() {
    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state != TransactionState::Active) [[unlikely]] {
        throw std::runtime_error("No active transaction");
    }

    m_driver->execute("ROLLBACK TRANSACTION");
    m_state = TransactionState::RolledBack;
}

}  // namespace predategrip
