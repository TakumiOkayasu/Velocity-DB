// PERFORMANCE_VALIDATION.md #2: SQL Server 接続 < 50ms.
//
// 実 SQL Server (LocalDB or Docker mssql) への connect() 所要時間を計測する。
// VELOCITYDB_PERF_MSSQL_CONNSTR が未設定の場合はスキップ。
// I/O コスト (ODBC ドライバーロード等) はプロセス起動時に完了しているため、
// ここでは TCP ハンドシェイク + SQL Server 認証の純粋な接続時間を測る。
//
// Env vars:
//   VELOCITYDB_PERF_MSSQL_CONNSTR  SQL Server ODBC 接続文字列
//
// Docker を使った実行手順 (tests/perf/README.md も参照):
//   docker run -e ACCEPT_EULA=Y -e SA_PASSWORD=<SA_PASSWORD> \
//     -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest
//   set VELOCITYDB_PERF_MSSQL_CONNSTR=Driver={ODBC Driver 18 for SQL Server};^
//     Server=localhost,1433;UID=sa;PWD=<SA_PASSWORD>;TrustServerCertificate=yes;
//   ctest --preset release -L perf -R SqlServerConnect

#include "bench_helpers.h"
#include "database/driver_interface.h"

#include <algorithm>
#include <chrono>
#include <format>
#include <iostream>
#include <numeric>
#include <stdexcept>
#include <vector>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kRepeatCount = 11;                                 // 奇数: median = samples[5]
constexpr auto kConnectTarget = std::chrono::microseconds(50'000);  // 50ms

struct BenchStats {
    std::chrono::microseconds mean;
    std::chrono::microseconds median;
    std::chrono::microseconds max;
};

// 同一ドライバーインスタンスで connect/disconnect を繰り返して計測する。
// ドライバー生成コストを除外し、接続確立コストのみを測る。
// cold start サンプルを除外するため、計測前にウォームアップを 1 回行う。
[[nodiscard]] BenchStats measureConnect(std::string_view connStr) {
    auto driver = DriverFactory::createDriver(DriverType::SQLServer);
    if (!driver) {
        throw std::runtime_error("DriverFactory::createDriver returned null");
    }
    // getLastError() は ODBC 診断メッセージのみを返す (接続文字列は含まない)

    // ウォームアップ: ODBC ドライバー内部状態・OS TCP バッファを初期化してから計測開始
    {
        const bool ok = driver->connect(connStr);
        driver->disconnect();
        if (!ok) {
            throw std::runtime_error("warmup connect() failed: " + driver->getLastError());
        }
    }

    std::vector<std::chrono::microseconds> samples;
    samples.reserve(kRepeatCount);

    for (size_t i = 0; i < kRepeatCount; ++i) {
        const auto start = std::chrono::steady_clock::now();
        const bool ok = driver->connect(connStr);
        const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - start);

        driver->disconnect();

        if (!ok) {
            throw std::runtime_error("connect() failed: " + driver->getLastError());
        }
        samples.push_back(elapsed);
    }

    std::sort(samples.begin(), samples.end());
    const auto sum = std::accumulate(samples.begin(), samples.end(), std::chrono::microseconds(0));
    return {
        sum / static_cast<std::chrono::microseconds::rep>(kRepeatCount),
        samples[kRepeatCount / 2],  // lower median (kRepeatCount が奇数の場合は真の中央値)
        samples.back(),
    };
}

TEST(SqlServerConnectBench, should_ConnectUnder50ms_whenLocalServer) {
    const auto connStr = perf::env("VELOCITYDB_PERF_MSSQL_CONNSTR");
    if (connStr.empty()) {
        GTEST_SKIP() << "VELOCITYDB_PERF_MSSQL_CONNSTR not set; skipping SQL Server connect bench";
    }

    BenchStats stats{};
    ASSERT_NO_THROW(stats = measureConnect(connStr));

    std::cerr << std::format("[bench] SqlServerConnect ({}rep): mean={}us median={}us max={}us\n", kRepeatCount, stats.mean.count(), stats.median.count(), stats.max.count());

    EXPECT_LT(stats.mean, kConnectTarget) << "connect() mean=" << stats.mean.count() << "us exceeded target " << kConnectTarget.count() << "us";
}

}  // namespace
}  // namespace velocitydb
