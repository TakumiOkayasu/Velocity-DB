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

#include "bench_helpers.h"
#include "database/driver_interface.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kExpectedRows = 1'000'000;
constexpr auto kSelectTarget = std::chrono::milliseconds(500);
constexpr std::string_view kSelectSql = "SELECT * FROM perf_million_rows";

class SelectMillionRowsBench : public ::testing::TestWithParam<DriverType> {
protected:
    static std::string connStrFor(DriverType type) {
        switch (type) {
            case DriverType::PostgreSQL:
                return perf::env("VELOCITYDB_PERF_PG_CONNSTR");
            case DriverType::SQLServer:
                return perf::env("VELOCITYDB_PERF_MSSQL_CONNSTR");
            case DriverType::MySQL:
                return {};  // not supported by this bench yet
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

    ASSERT_TRUE(driver->connect(connStr)) << "connect failed: " << driver->getLastError();

    const auto start = std::chrono::steady_clock::now();
    const auto result = driver->execute(kSelectSql);
    const auto elapsed = std::chrono::steady_clock::now() - start;

    driver->disconnect();

    ASSERT_EQ(result.rows.size(), kExpectedRows) << "fixture not loaded? run scripts/perf/setup_million_row_fixture.py";

    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed);
    std::cerr << "[bench] SELECT 100万行 (" << driverTypeToString(type) << "): " << elapsedMs.count() << "ms\n";

    EXPECT_LT(elapsedMs, kSelectTarget) << "SELECT 100万行 took " << elapsedMs.count() << "ms (target " << kSelectTarget.count() << "ms)";
}

// Decomposition bench (info-only, no pass/fail assertion). Splits the SELECT *
// latency into: round-trip, server-side scan, and row transfer + ResultSet
// construction. Run with the same fixture and report median of N runs to
// suppress per-run noise.
//
// Cost model:
//   round-trip = SELECT 1
//   server scan = SELECT COUNT(*) - round-trip
//   transfer + build = SELECT * - SELECT COUNT(*)
TEST_P(SelectMillionRowsBench, DecomposeStages) {
    const auto type = GetParam();
    const auto connStr = connStrFor(type);
    if (connStr.empty()) {
        GTEST_SKIP() << driverTypeToString(type) << " conn string not set; skipping integration bench";
    }

    auto driver = DriverFactory::createDriver(type);
    ASSERT_NE(driver, nullptr);
    ASSERT_TRUE(driver->connect(connStr)) << "connect failed: " << driver->getLastError();

    constexpr int kIterations = 5;

    auto medianMs = [&](std::string_view sql) {
        std::vector<int64_t> samples;
        samples.reserve(kIterations);
        for (int i = 0; i < kIterations; ++i) {
            const auto start = std::chrono::steady_clock::now();
            (void)driver->execute(sql);
            const auto elapsed = std::chrono::steady_clock::now() - start;
            samples.push_back(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count());
        }
        std::sort(samples.begin(), samples.end());
        return samples[samples.size() / 2];
    };

    const auto roundTripMs = medianMs("SELECT 1");
    const auto countMs = medianMs("SELECT COUNT(*) FROM perf_million_rows");
    const auto fullMs = medianMs(kSelectSql);

    const auto serverScanMs = countMs - roundTripMs;
    const auto transferMs = fullMs - countMs;

    const auto driverName = driverTypeToString(type);
    std::cerr << "[bench-decompose] " << driverName << " (median of " << kIterations << "):\n"
              << "  SELECT 1                        = " << roundTripMs << "ms (round-trip)\n"
              << "  SELECT COUNT(*)                 = " << countMs << "ms\n"
              << "    -> server scan               = " << serverScanMs << "ms\n"
              << "  SELECT *                        = " << fullMs << "ms\n"
              << "    -> transfer + ResultSet      = " << transferMs << "ms (" << (fullMs > 0 ? (100 * transferMs / fullMs) : 0) << "% of total)\n";

    driver->disconnect();
    SUCCEED();
}

// `driverTypeToString` returns display names ("SQL Server") that contain
// whitespace; GoogleTest parameterized test names must be valid identifiers,
// so use this no-whitespace variant for INSTANTIATE_TEST_SUITE_P only.
[[nodiscard]] std::string driverParamName(DriverType type) {
    switch (type) {
        case DriverType::PostgreSQL:
            return "PostgreSQL";
        case DriverType::SQLServer:
            return "SQLServer";
        case DriverType::MySQL:
            return "MySQL";
    }
    return "Unknown";
}

INSTANTIATE_TEST_SUITE_P(AllDrivers, SelectMillionRowsBench, ::testing::Values(DriverType::PostgreSQL, DriverType::SQLServer),
                         [](const ::testing::TestParamInfo<DriverType>& info) { return driverParamName(info.param); });

}  // namespace
}  // namespace velocitydb
