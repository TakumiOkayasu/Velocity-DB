#include <gtest/gtest.h>

#include "database/schema_inspector.h"
#include "database/sqlserver_driver.h"

namespace predategrip {
namespace test {

class SchemaInspectorTest : public ::testing::Test {
protected:
    void SetUp() override {}
    void TearDown() override {}
};

// Unit test: getColumns returns empty when driver is not set
TEST_F(SchemaInspectorTest, GetColumnsReturnsEmptyWithoutDriver) {
    SchemaInspector inspector;
    // No driver set

    auto columns = inspector.getColumns("users");

    EXPECT_TRUE(columns.empty());
}

// Unit test: getColumns returns empty when driver is not connected
TEST_F(SchemaInspectorTest, GetColumnsReturnsEmptyWhenDisconnected) {
    SchemaInspector inspector;
    auto driver = std::make_shared<SQLServerDriver>();
    inspector.setDriver(driver);
    // Driver is not connected

    auto columns = inspector.getColumns("users");

    EXPECT_TRUE(columns.empty());
}

// Unit test: getDatabases returns empty without driver
TEST_F(SchemaInspectorTest, GetDatabasesReturnsEmptyWithoutDriver) {
    SchemaInspector inspector;

    auto databases = inspector.getDatabases();

    EXPECT_TRUE(databases.empty());
}

// Unit test: getTables returns empty without driver
TEST_F(SchemaInspectorTest, GetTablesReturnsEmptyWithoutDriver) {
    SchemaInspector inspector;

    auto tables = inspector.getTables("TestDB");

    EXPECT_TRUE(tables.empty());
}

// Unit test: getIndexes returns empty without driver
TEST_F(SchemaInspectorTest, GetIndexesReturnsEmptyWithoutDriver) {
    SchemaInspector inspector;

    auto indexes = inspector.getIndexes("users");

    EXPECT_TRUE(indexes.empty());
}

// Unit test: getForeignKeys returns empty without driver
TEST_F(SchemaInspectorTest, GetForeignKeysReturnsEmptyWithoutDriver) {
    SchemaInspector inspector;

    auto fks = inspector.getForeignKeys("orders");

    EXPECT_TRUE(fks.empty());
}

// Integration tests (require actual database)
// These are disabled by default and should be run manually with a test database

class SchemaInspectorIntegrationTest : public ::testing::Test {
protected:
    void SetUp() override {
        m_driver = std::make_shared<SQLServerDriver>();
        m_connectionString =
            "Driver={ODBC Driver 17 for SQL Server};"
            "Server=127.0.0.1\\MMS;"
            "Database=work_inst;"
            "Trusted_Connection=yes;";
    }

    void TearDown() override {
        if (m_driver && m_driver->isConnected()) {
            m_driver->disconnect();
        }
    }

    bool connect() { return m_driver->connect(m_connectionString); }

    std::shared_ptr<SQLServerDriver> m_driver;
    std::string m_connectionString;
};

TEST_F(SchemaInspectorIntegrationTest, DISABLED_GetColumnsWithSimpleTableName) {
    ASSERT_TRUE(connect());

    SchemaInspector inspector;
    inspector.setDriver(m_driver);

    auto columns = inspector.getColumns("work_instructions");

    EXPECT_FALSE(columns.empty());
    // Verify column properties
    for (const auto& col : columns) {
        EXPECT_FALSE(col.name.empty());
        EXPECT_FALSE(col.type.empty());
    }
}

TEST_F(SchemaInspectorIntegrationTest, DISABLED_GetColumnsWithSchemaPrefix) {
    ASSERT_TRUE(connect());

    SchemaInspector inspector;
    inspector.setDriver(m_driver);

    // Test with explicit dbo schema
    auto columns = inspector.getColumns("dbo.work_instructions");

    EXPECT_FALSE(columns.empty());
}

TEST_F(SchemaInspectorIntegrationTest, DISABLED_GetColumnsWithBrackets) {
    ASSERT_TRUE(connect());

    SchemaInspector inspector;
    inspector.setDriver(m_driver);

    // Test with bracketed names
    auto columns = inspector.getColumns("[dbo].[work_instructions]");

    EXPECT_FALSE(columns.empty());
}

TEST_F(SchemaInspectorIntegrationTest, DISABLED_GetColumnsNonExistentTable) {
    ASSERT_TRUE(connect());

    SchemaInspector inspector;
    inspector.setDriver(m_driver);

    auto columns = inspector.getColumns("nonexistent_table_xyz");

    EXPECT_TRUE(columns.empty());
}

TEST_F(SchemaInspectorIntegrationTest, DISABLED_GetTables) {
    ASSERT_TRUE(connect());

    SchemaInspector inspector;
    inspector.setDriver(m_driver);

    auto tables = inspector.getTables("work_inst");

    EXPECT_FALSE(tables.empty());
    // Verify table properties
    for (const auto& table : tables) {
        EXPECT_FALSE(table.name.empty());
        EXPECT_FALSE(table.schema.empty());
    }
}

}  // namespace test
}  // namespace predategrip
