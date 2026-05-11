// PERFORMANCE_VALIDATION.md #12: LRU result cache.
//
// README #12 のサイズ上限 (100MB) と LRU 動作は既存
// `tests/database/test_result_cache.cpp` で機能検証済み。本 bench は時間目標
// (= 明示的な README 値はない) ではなくリグレッション検出を目的とし、ヒット
// 経路 / miss 経路 / eviction を伴う put 経路のそれぞれに CI フレンドリーな
// 絶対上限を置く。
//
// `ResultCache::getAndApply` は `std::unordered_map::find` + `splice` + ユーザー
// callback の合算で、O(1) を期待。`put` は eviction が走る場合のみ容量上限内に
// 収まるまで先頭から `pop_front` するため、worst case では複数件 evict される。
// SIMDFilter bench と同様、ratio は記録するが assert は loose な上限のみ。

#include "database/result_cache.h"

#include <chrono>
#include <format>
#include <iostream>
#include <string>
#include <vector>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kBenchEntries = 1'000;
constexpr size_t kEntryRows = 10;
constexpr size_t kEntryCols = 4;

// CI runner variance を吸収する loose な絶対上限。ローカル Release では各
// テストとも 1ms 未満で完走するため、桁違いのリグレッション (たとえば
// getAndApply の hash 計算が線形化する等) を捕捉できる粒度。
constexpr auto HIT_TARGET = std::chrono::milliseconds(50);
constexpr auto MISS_TARGET = std::chrono::milliseconds(50);
constexpr auto PUT_WITH_EVICTION_TARGET = std::chrono::milliseconds(500);

[[nodiscard]] ResultSet makeResultSet(size_t rows, size_t cols) {
    ResultSet rs;
    rs.columns.reserve(cols);
    for (size_t c = 0; c < cols; ++c) {
        rs.columns.push_back(ColumnInfo{.name = std::format("col_{}", c), .type = "VARCHAR"});
    }
    rs.rows.reserve(rows);
    for (size_t r = 0; r < rows; ++r) {
        ResultRow row;
        row.values.reserve(cols);
        row.nullFlags.assign(cols, false);
        for (size_t c = 0; c < cols; ++c) {
            row.values.push_back(std::format("val_{}_{}", r, c));
        }
        rs.rows.push_back(std::move(row));
    }
    return rs;
}

template <typename Fn>
[[nodiscard]] std::chrono::nanoseconds measure(Fn&& fn) {
    const auto start = std::chrono::steady_clock::now();
    fn();
    return std::chrono::steady_clock::now() - start;
}

class ResultCacheBench : public ::testing::Test {
protected:
    // 100MB は README #12 の上限。ヒット / miss 計測ではすべて収まる前提で
    // eviction を意図的に起こさない構成。
    ResultCache cache{100 * 1024 * 1024};
    std::vector<std::string> keys;

    void SetUp() override {
        keys.reserve(kBenchEntries);
        const auto sample = makeResultSet(kEntryRows, kEntryCols);
        for (size_t i = 0; i < kBenchEntries; ++i) {
            keys.push_back(std::format("key_{}", i));
            cache.put(keys.back(), sample);
        }
    }
};

TEST_F(ResultCacheBench, HitLatencyUnderTarget) {
    size_t total = 0;
    const auto elapsed = measure([&] {
        for (const auto& k : keys) {
            total += cache.getAndApply(k, [](const ResultSet& r) { return r.rows.size(); });
        }
    });
    ASSERT_EQ(total, kBenchEntries * kEntryRows);

    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed);
    std::cerr << "[bench] ResultCache hit x " << kBenchEntries << ": "
              << elapsedMs.count() << "ms\n";
    EXPECT_LT(elapsedMs, HIT_TARGET);
}

TEST_F(ResultCacheBench, MissLatencyUnderTarget) {
    size_t total = 0;
    const auto elapsed = measure([&] {
        for (size_t i = 0; i < kBenchEntries; ++i) {
            const auto miss = std::format("missing_{}", i);
            total += cache.getAndApply(miss, [](const ResultSet& r) { return r.rows.size(); });
        }
    });
    EXPECT_EQ(total, 0u);  // すべて miss → 0

    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed);
    std::cerr << "[bench] ResultCache miss x " << kBenchEntries << ": "
              << elapsedMs.count() << "ms\n";
    EXPECT_LT(elapsedMs, MISS_TARGET);
}

TEST(ResultCacheBenchEvict, PutWithEvictionUnderTarget) {
    // 容量を「半分の件数しか入らない」サイズに絞ることで、後半の put すべてで
    // eviction を強制する。これにより evictIfNeeded の loop 性能を捕捉。
    const auto probeSample = makeResultSet(kEntryRows, kEntryCols);
    ResultCache probe{100 * 1024 * 1024};
    probe.put("probe", probeSample);
    const auto entrySize = probe.getCurrentSize();
    ASSERT_GT(entrySize, 0u);

    const size_t capacity = entrySize * (kBenchEntries / 2);
    ResultCache tight{capacity};

    const auto sample = makeResultSet(kEntryRows, kEntryCols);
    const auto elapsed = measure([&] {
        for (size_t i = 0; i < kBenchEntries; ++i) {
            tight.put(std::format("k_{}", i), sample);
        }
    });

    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed);
    std::cerr << "[bench] ResultCache put-with-eviction x " << kBenchEntries << ": "
              << elapsedMs.count() << "ms (capacity=" << capacity
              << " bytes, entry=" << entrySize << " bytes)\n";

    // 後半半分で eviction が走るため、tight.getCurrentSize() <= capacity を確認。
    EXPECT_LE(tight.getCurrentSize(), capacity);
    EXPECT_LT(elapsedMs, PUT_WITH_EVICTION_TARGET);
}

}  // namespace
}  // namespace velocitydb
