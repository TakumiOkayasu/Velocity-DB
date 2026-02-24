#pragma once

#include <memory>
#include <string>

namespace velocitydb {

class IDatabaseDriver;

enum class TransactionState { None, Active, Committed, RolledBack };

class TransactionManager {
public:
    TransactionManager() = default;
    ~TransactionManager();

    void setDriver(std::shared_ptr<IDatabaseDriver> driver) { m_driver = std::move(driver); }

    void begin();
    void commit();
    void rollback();

    [[nodiscard]] bool isInTransaction() const noexcept { return m_state == TransactionState::Active; }
    [[nodiscard]] TransactionState getState() const noexcept { return m_state; }

    void setAutoCommit(bool autoCommit) noexcept { m_autoCommit = autoCommit; }
    [[nodiscard]] bool isAutoCommit() const noexcept { return m_autoCommit; }

private:
    std::shared_ptr<IDatabaseDriver> m_driver;
    TransactionState m_state = TransactionState::None;
    bool m_autoCommit = true;
};

}  // namespace velocitydb
