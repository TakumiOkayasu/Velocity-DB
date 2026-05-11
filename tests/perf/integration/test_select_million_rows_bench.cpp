// PERFORMANCE_VALIDATION.md #3: SELECT (100万行) < 500ms.
//
// Unlike the in-memory perf benches under tests/perf/, this one requires a
// live database with the perf_million_rows fixture already loaded
// (scripts/perf/setup_million_row_fixture.py). Connection strings are read
// from environment variables; tests skip when unset so the binary stays safe
// to run on dev machines without a DB.
//
// Env vars:
//   VELOCITYDB_PERF_PG_CONNSTR     PostgreSQL conninfo (libpq form)
//   VELOCITYDB_PERF_MSSQL_CONNSTR  SQL Server ODBC connection string
//
// 500ms is the documented goal in docs/PERFORMANCE_VALIDATION.md #3 and is
// measured end-to-end (driver.execute returns when all 100万行 have been
// fetched into ResultSet).

#include "database/driver_interface.h"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kExpectedRows = 1'000'000;
constexpr auto kSelectTarget = std::chrono::milliseconds(500);
constexpr std::string_view kSelectSql = "SELECT * FROM perf_million_rows";

[[nodiscard]] std::string env(const char* name) {
    const char* v = std::getenv(name);
    return v ? std::string{v} : std::string{};
}

class SelectMillionRowsBench : public ::testing::TestWithParam<DriverType> {
protected:
    static std::string connStrFor(DriverType type) {
        switch (type) {
            case DriverType::PostgreSQL: return env("VELOCITYDB_PERF_PG_CONNSTR");
            case DriverType::SQLServer:  return env("VELOCITYDB_PERF_MSSQL_CONNSTR");
            case DriverType::MySQL:      return {};  // not supported by this bench yet
        }
        return {};
    }
};

TEST_P(SelectMillionRowsBench, SelectMillionRowsUnderTarget) {
    const auto type = GetParam();
    const auto connStr = connStrFor(type);
    if (connStr.empty()) {
        GTEST_SKIP() << driverTypeToString(type) << " conn string not set; skipping integration bench";
    }

    auto driver = DriverFactory::createDriver(type);
    ASSERT_NE(driver, nullptr);

    ASSERT_TRUE(driver->connect(connStr))
        << "connect failed: " << driver->getLastError();

    const auto start = std::chrono::steady_clock::now();
    const auto result = driver->execute(kSelectSql);
    const auto elapsed = std::chrono::steady_clock::now() - start;

    driver->disconnect();

    ASSERT_EQ(result.rows.size(), kExpectedRows)
        << "fixture not loaded? run scripts/perf/setup_million_row_fixture.py";

    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed);
    std::cerr << "[bench] SELECT 100万行 (" << driverTypeToString(type) << "): "
              << elapsedMs.count() << "ms\n";

    EXPECT_LT(elapsedMs, kSelectTarget)
        << "SELECT 100万行 took " << elapsedMs.count() << "ms (target " << kSelectTarget.count() << "ms)";
}

// `driverTypeToString` returns display names ("SQL Server") that contain
// whitespace; GoogleTest parameterized test names must be valid identifiers,
// so use this no-whitespace variant for INSTANTIATE_TEST_SUITE_P only.
[[nodiscard]] std::string driverParamName(DriverType type) {
    switch (type) {
        case DriverType::PostgreSQL: return "PostgreSQL";
        case DriverType::SQLServer:  return "SQLServer";
        case DriverType::MySQL:      return "MySQL";
    }
    return "Unknown";
}

INSTANTIATE_TEST_SUITE_P(
    AllDrivers,
    SelectMillionRowsBench,
    ::testing::Values(DriverType::PostgreSQL, DriverType::SQLServer),
    [](const ::testing::TestParamInfo<DriverType>& info) { return driverParamName(info.param); });

}  // namespace
}  // namespace velocitydb
