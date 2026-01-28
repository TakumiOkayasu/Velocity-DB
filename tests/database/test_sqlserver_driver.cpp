#include <gtest/gtest.h>
#include "database/sqlserver_driver.h"

namespace velocitydb {
namespace test {

class SQLServerDriverTest : public ::testing::Test {
protected:
    void SetUp() override {
        // Setup code
    }

    void TearDown() override {
        // Cleanup code
    }
};

TEST_F(SQLServerDriverTest, InitializesCorrectly) {
    SQLServerDriver driver;
    EXPECT_FALSE(driver.isConnected());
}

TEST_F(SQLServerDriverTest, DisconnectWhenNotConnected) {
    SQLServerDriver driver;
    EXPECT_NO_THROW(driver.disconnect());
}

// Integration tests (require actual database)
// These tests should be skipped in CI unless a test database is available

TEST_F(SQLServerDriverTest, DISABLED_ConnectsToTestDatabase) {
    SQLServerDriver driver;
    std::string connectionString =
        "Driver={ODBC Driver 17 for SQL Server};"
        "Server=localhost;"
        "Database=master;"
        "Trusted_Connection=yes;";

    bool result = driver.connect(connectionString);
    EXPECT_TRUE(result);
    EXPECT_TRUE(driver.isConnected());

    driver.disconnect();
    EXPECT_FALSE(driver.isConnected());
}

TEST_F(SQLServerDriverTest, DISABLED_ExecutesSimpleQuery) {
    SQLServerDriver driver;
    std::string connectionString =
        "Driver={ODBC Driver 17 for SQL Server};"
        "Server=localhost;"
        "Database=master;"
        "Trusted_Connection=yes;";

    ASSERT_TRUE(driver.connect(connectionString));

    auto result = driver.execute("SELECT 1 AS Value");

    EXPECT_EQ(result.columns.size(), 1);
    EXPECT_EQ(result.columns[0].name, "Value");
    EXPECT_EQ(result.rows.size(), 1);
    EXPECT_EQ(result.rows[0].values[0], "1");

    driver.disconnect();
}

}  // namespace test
}  // namespace velocitydb
