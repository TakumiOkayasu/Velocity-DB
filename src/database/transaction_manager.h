#pragma once

#include <memory>
#include <string>

namespace predategrip {

class SQLServerDriver;

enum class TransactionState {
    None,
    Active,
    Committed,
    RolledBack
};

class TransactionManager {
public:
    TransactionManager();
    ~TransactionManager();

    void setDriver(std::shared_ptr<SQLServerDriver> driver);

    void begin();
    void commit();
    void rollback();

    bool isInTransaction() const;
    TransactionState getState() const;

    void setAutoCommit(bool autoCommit);
    bool isAutoCommit() const;

private:
    std::shared_ptr<SQLServerDriver> m_driver;
    TransactionState m_state = TransactionState::None;
    bool m_autoCommit = true;
};

}  // namespace predategrip
