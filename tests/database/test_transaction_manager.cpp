#include <gtest/gtest.h>
#include "database/transaction_manager.h"

namespace velocitydb {
namespace test {

class TransactionManagerTest : public ::testing::Test {
protected:
    TransactionManager txManager;
};

TEST_F(TransactionManagerTest, InitialStateIsNone) {
    EXPECT_EQ(txManager.getState(), TransactionState::None);
    EXPECT_FALSE(txManager.isInTransaction());
}

TEST_F(TransactionManagerTest, AutoCommitDefaultsToTrue) {
    EXPECT_TRUE(txManager.isAutoCommit());
}

TEST_F(TransactionManagerTest, SetAutoCommit) {
    txManager.setAutoCommit(false);
    EXPECT_FALSE(txManager.isAutoCommit());

    txManager.setAutoCommit(true);
    EXPECT_TRUE(txManager.isAutoCommit());
}

TEST_F(TransactionManagerTest, BeginWithoutDriverThrows) {
    EXPECT_THROW(txManager.begin(), std::runtime_error);
}

TEST_F(TransactionManagerTest, CommitWithoutTransactionThrows) {
    EXPECT_THROW(txManager.commit(), std::runtime_error);
}

TEST_F(TransactionManagerTest, RollbackWithoutTransactionThrows) {
    EXPECT_THROW(txManager.rollback(), std::runtime_error);
}

}  // namespace test
}  // namespace velocitydb
