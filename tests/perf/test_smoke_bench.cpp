// Smoke benchmark validating the perf-test infrastructure end to end:
// std::chrono measurement, EXPECT_LT against a target, and the "perf" ctest label.
//
// Concrete benchmarks for README performance goals (#3 SELECT, #6 SQL format,
// #10 history search, #11 SIMD) are tracked separately — see
// docs/PERFORMANCE_VALIDATION.md.

#include "parsers/sql_formatter.h"

#include <chrono>
#include <string>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

// README #6: SQL formatting target. The smoke case uses a short query so the
// measurement is dominated by formatter overhead, not input size.
constexpr auto SQL_FORMAT_TARGET = std::chrono::milliseconds(50);

TEST(PerfSmokeBench, SqlFormatterShortQueryUnderTarget) {
    const std::string sql = "select id, name, email from users where id = 1";
    SQLFormatter formatter;

    const auto start = std::chrono::steady_clock::now();
    const auto formatted = formatter.format(sql);
    const auto elapsed = std::chrono::steady_clock::now() - start;

    EXPECT_FALSE(formatted.empty());
    EXPECT_LT(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed), SQL_FORMAT_TARGET);
}

}  // namespace
}  // namespace velocitydb
