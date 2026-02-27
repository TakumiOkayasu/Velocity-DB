#include <gtest/gtest.h>
#include "database/postgresql_driver.h"
#include "parsers/copy_block_detector.h"

namespace velocitydb {
namespace test {

class PostgreSqlDriverTest : public ::testing::Test {
protected:
    PostgreSqlDriver driver;
};

TEST_F(PostgreSqlDriverTest, InitializesCorrectly) {
    EXPECT_FALSE(driver.isConnected());
    EXPECT_EQ(driver.getType(), DriverType::PostgreSQL);
}

TEST_F(PostgreSqlDriverTest, DisconnectWhenNotConnected) {
    EXPECT_NO_THROW(driver.disconnect());
}

TEST_F(PostgreSqlDriverTest, ExecuteThrowsWhenNotConnected) {
    EXPECT_THROW((void)driver.execute("SELECT 1"), std::runtime_error);
}

TEST_F(PostgreSqlDriverTest, CopyFromStdinThrowsWhenNotConnected) {
    std::string copySql =
        "COPY t (id) FROM stdin;\n"
        "1\n"
        "\\.";
    EXPECT_THROW((void)driver.execute(copySql), std::runtime_error);
}

// --- CopyBlockDetector detection via driver handler chain ---

TEST_F(PostgreSqlDriverTest, CopyFromStdinDetectedByHandler) {
    CopyBlockDetector detector;
    EXPECT_TRUE(detector.startsBlock("COPY t FROM stdin;\n1\n\\."));
}

TEST_F(PostgreSqlDriverTest, NormalSQLNotDetectedAsCopy) {
    CopyBlockDetector detector;
    EXPECT_FALSE(detector.startsBlock("SELECT * FROM t"));
    EXPECT_FALSE(detector.startsBlock("INSERT INTO t VALUES (1)"));
}

// Integration tests (require actual PostgreSQL database)
TEST_F(PostgreSqlDriverTest, DISABLED_CopyFromStdinInsertRows) {
    ASSERT_TRUE(driver.connect(
        "host=localhost dbname=testdb user=postgres password=postgres"));

    (void)driver.execute("DROP TABLE IF EXISTS copy_test");
    (void)driver.execute("CREATE TABLE copy_test (id int, name text)");

    std::string copySql =
        "COPY copy_test (id, name) FROM stdin;\n"
        "1\tAlice\n"
        "2\tBob\n"
        "\\.";

    auto result = driver.execute(copySql);
    EXPECT_EQ(result.affectedRows, 2);

    auto selectResult = driver.execute("SELECT count(*) FROM copy_test");
    EXPECT_EQ(selectResult.rows[0].values[0], "2");

    (void)driver.execute("DROP TABLE copy_test");
    driver.disconnect();
}

}  // namespace test
}  // namespace velocitydb
