#include "database/connection_types.h"
#include "database/driver_interface.h"
#include "database/query_history.h"
#include "database/result_cache.h"
#include "interfaces/providers/connection_provider.h"
#include "providers/transaction_provider.h"
#include "simdjson.h"

#include <chrono>
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include <gmock/gmock.h>
#include <gtest/gtest.h>

using velocitydb::DatabaseConnectionParams;
using velocitydb::DriverType;
using velocitydb::IConnectionProvider;
using velocitydb::IDatabaseDriver;
using velocitydb::QueryHistory;
using velocitydb::ResultCache;
using velocitydb::ResultRow;
using velocitydb::ResultSet;

#include "database/async_query_executor.h"
#include "providers/query_options.h"
#include "providers/query_result_formatter.h"

#include <thread>
namespace {

class MockDatabaseDriver : public IDatabaseDriver {
public:
    MOCK_METHOD(bool, connect, (std::string_view), (override));
    MOCK_METHOD(void, disconnect, (), (override));
    MOCK_METHOD(bool, isConnected, (), (const, noexcept, override));
    MOCK_METHOD(ResultSet, execute, (std::string_view), (override));
    MOCK_METHOD(void, cancel, (), (override));
    MOCK_METHOD(void, setQueryTimeout, (std::chrono::seconds), (override));
    MOCK_METHOD(std::chrono::seconds, queryTimeout, (), (const, noexcept, override));
    MOCK_METHOD(std::string, getLastError, (), (const, override));
    MOCK_METHOD(DriverType, getType, (), (const, noexcept, override));
};

class MockConnectionProvider : public IConnectionProvider {
public:
    MOCK_METHOD(std::string, connectAsync, (std::string_view), (override));
    MOCK_METHOD(std::string, getConnectResult, (std::string_view), (override));
    MOCK_METHOD(std::string, cancelConnect, (std::string_view), (override));
    MOCK_METHOD(std::string, disconnect, (std::string_view), (override));
    MOCK_METHOD(std::string, testConnection, (std::string_view), (override));
    MOCK_METHOD(std::shared_ptr<IDatabaseDriver>, getQueryDriver, (std::string_view), (override));
    MOCK_METHOD(std::shared_ptr<IDatabaseDriver>, getMetadataDriver, (std::string_view), (override));
    MOCK_METHOD(DriverType, getDriverType, (std::string_view), (const, override));
    MOCK_METHOD(std::optional<DatabaseConnectionParams>, getConnectionParams, (std::string_view), (const, override));
    MOCK_METHOD(void, setDefaultQueryTimeoutSeconds, (int), (override));
};

}  // namespace

class ManualTransactionTest : public ::testing::Test {
protected:
    ::testing::NiceMock<MockConnectionProvider> connections;
    std::shared_ptr<::testing::NiceMock<MockDatabaseDriver>> driver = std::make_shared<::testing::NiceMock<MockDatabaseDriver>>();
    std::shared_ptr<ResultCache> cache = std::make_shared<ResultCache>();
    void SetUp() override {
        ON_CALL(connections, getQueryDriver(::testing::_)).WillByDefault(::testing::Return(driver));
        ON_CALL(*driver, getType()).WillByDefault(::testing::Return(DriverType::PostgreSQL));
        ON_CALL(*driver, isConnected()).WillByDefault(::testing::Return(true));
    }
};

TEST_F(ManualTransactionTest, BeginOnceRejectBusyAndModeSwitchThenCommit) {
    velocitydb::TransactionProvider transactions(connections, cache);
    EXPECT_CALL(*driver, execute("BEGIN")).Times(1);
    EXPECT_CALL(*driver, execute("COMMIT")).Times(1);
    auto lease = transactions.prepareQuery("c1", "UPDATE t SET x=1", false);
    EXPECT_THROW((void)transactions.prepareQuery("c1", "SELECT 1", false), std::runtime_error);
    EXPECT_NE(transactions.commitTransaction(R"({"connectionId":"c1"})").find(R"("success":false)"), std::string::npos);
    EXPECT_THROW(transactions.cleanupConnection(R"({"connectionId":"c1"})"), std::runtime_error);
    lease.reset();
    EXPECT_THROW((void)transactions.prepareQuery("c1", "SELECT 1", true), std::runtime_error);
    auto next = transactions.prepareQuery("c1", "SELECT 1", false);
    next.reset();
    EXPECT_NE(transactions.commitTransaction(R"({"connectionId":"c1"})").find(R"("success":true)"), std::string::npos);
    EXPECT_FALSE(transactions.isInTransaction("c1"));
    EXPECT_NO_THROW((void)transactions.prepareQuery("c1", "SELECT 1", true));
}

TEST_F(ManualTransactionTest, RejectExplicitControlAndExternalCopyBeforeBeginning) {
    velocitydb::TransactionProvider transactions(connections);
    EXPECT_CALL(*driver, execute(::testing::_)).Times(0);
    EXPECT_THROW((void)transactions.prepareQuery("c1", "COMMIT", false), std::runtime_error);
    EXPECT_THROW((void)transactions.prepareQuery("c1", "COPY t FROM stdin;\n1\n\\.\n", false), std::runtime_error);
}

TEST_F(ManualTransactionTest, FailedAsyncQueryRetainsTransactionAndReleasesBusyLease) {
    velocitydb::TransactionProvider transactions(connections);
    velocitydb::AsyncQueryExecutor executor;
    EXPECT_CALL(*driver, execute("BEGIN")).Times(1);
    EXPECT_CALL(*driver, execute("UPDATE t SET x=1")).WillOnce(::testing::Throw(std::runtime_error("query failed")));
    EXPECT_CALL(*driver, execute("ROLLBACK")).Times(1);
    auto lease = transactions.prepareQuery("c1", "UPDATE t SET x=1", false);
    auto id = executor.submitQuery(driver, "UPDATE t SET x=1", false, std::move(lease), 123);
    velocitydb::AsyncQueryResult result;
    for (int i = 0; i < 1000; ++i) {
        result = executor.getQueryResult(id);
        if (result.status == velocitydb::QueryStatus::Failed)
            break;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    ASSERT_EQ(result.status, velocitydb::QueryStatus::Failed);
    EXPECT_EQ(result.maxRows, 123u);
    EXPECT_TRUE(transactions.isInTransaction("c1"));
    EXPECT_NE(transactions.getTransactionState(R"({"connectionId":"c1"})").find(R"("busy":false)"), std::string::npos);
    EXPECT_NE(transactions.rollbackTransaction(R"({"connectionId":"c1"})").find(R"("success":true)"), std::string::npos);
}

TEST(QueryOptionsTest, ValidatesIpcBoundsAndKeepsBackwardDefaults) {
    simdjson::dom::parser parser;
    auto defaults = velocitydb::parseQueryOptions(parser.parse(std::string("{}")).value());
    EXPECT_TRUE(defaults.autoCommit);
    EXPECT_EQ(defaults.maxRows, 10000u);
    for (const auto* json : {R"({"maxRows":99})", R"({"maxRows":1000001})", R"({"maxRows":"100"})", R"({"autoCommit":1})"}) {
        EXPECT_THROW((void)velocitydb::parseQueryOptions(parser.parse(std::string(json)).value()), std::runtime_error);
    }
    auto options = velocitydb::parseQueryOptions(parser.parse(std::string(R"({"autoCommit":false,"maxRows":1000000})")).value());
    EXPECT_FALSE(options.autoCommit);
    EXPECT_EQ(options.maxRows, 1000000u);
}

TEST(QueryRowLimitTest, CapsEveryResultSetWithoutChangingAffectedRows) {
    ResultSet rows;
    rows.columns.push_back({.name = "n", .type = "INT"});
    ResultRow row;
    row.values = {"42"};
    row.nullFlags = {false};
    rows.rows.resize(101, row);
    rows.affectedRows = 456;
    std::vector<velocitydb::NamedResult> results{{"SELECT 1", std::cref(rows)}, {"SELECT 2", std::cref(rows)}};
    auto json = velocitydb::QueryResultFormatter::buildMultipleResultsJson(results, 100);
    simdjson::dom::parser parser;
    auto doc = parser.parse(json).value();
    for (auto result : doc["results"].get_array()) {
        EXPECT_EQ(result["data"]["rows"].get_array().value().size(), 100u);
        EXPECT_TRUE(result["data"]["truncated"].get_bool().value());
        EXPECT_EQ(result["data"]["affectedRows"].get_int64().value(), 456);
    }
}
