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
    if (!m_driver) [[unlikely]] {
        throw std::runtime_error("TransactionManager: driver not set. Call setDriver() first.");
    }
    if (!m_driver->isConnected()) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state == TransactionState::Active) [[unlikely]] {
        throw std::runtime_error("Transaction already active");
    }

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

    [[maybe_unused]] auto result = m_driver->execute("COMMIT TRANSACTION");
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

    [[maybe_unused]] auto result = m_driver->execute("ROLLBACK TRANSACTION");
    if (!m_driver->getLastError().empty()) [[unlikely]] {
        throw std::runtime_error(std::string(m_driver->getLastError()));
    }
    m_state = TransactionState::RolledBack;
}

}  // namespace predategrip
