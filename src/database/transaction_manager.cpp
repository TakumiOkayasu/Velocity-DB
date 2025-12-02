#include "transaction_manager.h"
#include "sqlserver_driver.h"
#include <stdexcept>

namespace predategrip {

TransactionManager::TransactionManager() = default;

TransactionManager::~TransactionManager() {
    if (m_state == TransactionState::Active && m_driver) {
        try {
            rollback();
        } catch (...) {
            // Ignore errors during cleanup
        }
    }
}

void TransactionManager::setDriver(std::shared_ptr<SQLServerDriver> driver) {
    m_driver = driver;
}

void TransactionManager::begin() {
    if (!m_driver || !m_driver->isConnected()) {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state == TransactionState::Active) {
        throw std::runtime_error("Transaction already active");
    }

    m_driver->execute("BEGIN TRANSACTION");
    m_state = TransactionState::Active;
}

void TransactionManager::commit() {
    if (!m_driver || !m_driver->isConnected()) {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state != TransactionState::Active) {
        throw std::runtime_error("No active transaction");
    }

    m_driver->execute("COMMIT TRANSACTION");
    m_state = TransactionState::Committed;
}

void TransactionManager::rollback() {
    if (!m_driver || !m_driver->isConnected()) {
        throw std::runtime_error("Not connected to database");
    }

    if (m_state != TransactionState::Active) {
        throw std::runtime_error("No active transaction");
    }

    m_driver->execute("ROLLBACK TRANSACTION");
    m_state = TransactionState::RolledBack;
}

bool TransactionManager::isInTransaction() const {
    return m_state == TransactionState::Active;
}

TransactionState TransactionManager::getState() const {
    return m_state;
}

void TransactionManager::setAutoCommit(bool autoCommit) {
    m_autoCommit = autoCommit;
}

bool TransactionManager::isAutoCommit() const {
    return m_autoCommit;
}

}  // namespace predategrip
