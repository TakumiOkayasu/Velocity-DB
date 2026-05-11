// README #11: AVX2 SIMD filtering — qualitative target ("fast"; see issue #537
// follow-up to make the goal quantitative).
//
// The public SIMDFilter::filter* methods do not currently route through the
// SIMD primitives (they use std::string operators directly). To make the AVX2
// vs fallback comparison meaningful, this bench targets the SIMD primitives
// (simdStringEquals / simdStringContains) and pits them against the obvious
// scalar equivalents (std::memcmp / std::string_view::find).
//
// The point is to detect regressions in the AVX2 path itself, not to assert
// a fixed speedup ratio — modern std::memcmp is already vectorised, and CI
// runner variance makes ratio assertions flaky. We log the ratio and assert
// only a loose absolute upper bound.

#include "search/simd_filter.h"

#include <chrono>
#include <cstring>
#include <iostream>
#include <string>
#include <string_view>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kEqualsIterations = 100'000;
constexpr size_t kEqualsLen = 64;  // >=32 so AVX2 path is exercised

// Targets are loose absolute upper bounds, not micro-benchmark precision —
// CI runner variance can easily multiply real wall time. After #543 cached
// the cpuid probe, local Release on a 12th-gen Intel measured <1ms for both
// primitives; 50ms leaves ample headroom while still flagging order-of-
// magnitude regressions (e.g. accidentally re-introducing per-call cpuid).
// Ratios stay logged-not-asserted because std::memcmp benefits from compiler
// auto-vectorisation and the comparison is noisy on small wall times.
constexpr auto EQUALS_TARGET = std::chrono::milliseconds(50);

constexpr size_t kHaystackLen = 64 * 1024;
constexpr size_t kContainsIterations = 1'000;
constexpr auto CONTAINS_TARGET = std::chrono::milliseconds(50);

[[nodiscard]] std::string makeRepeated(char c, size_t n) {
    return std::string(n, c);
}

// haystack of `len` bytes with `needle` planted near the tail so neither side
// can short-circuit on the first byte.
[[nodiscard]] std::string makeHaystackWithNeedleAtTail(size_t len, std::string_view needle) {
    std::string s(len, 'a');
    if (needle.size() <= len) {
        const auto pos = len - needle.size() - 1;
        std::memcpy(s.data() + pos, needle.data(), needle.size());
    }
    return s;
}

template <typename Fn>
[[nodiscard]] std::chrono::nanoseconds measure(Fn&& fn) {
    const auto start = std::chrono::steady_clock::now();
    fn();
    return std::chrono::steady_clock::now() - start;
}

TEST(SimdFilterBench, IsAvx2AvailableReturnsBool) {
    // Smoke: ensure the runtime probe links and returns a value.
    const bool available = SIMDFilter::isAVX2Available();
    std::cerr << "[bench] AVX2 available: " << (available ? "yes" : "no") << "\n";
    SUCCEED();
}

TEST(SimdFilterBench, StringEqualsAvx2PathUnderTarget) {
    const auto a = makeRepeated('x', kEqualsLen);
    const auto b = makeRepeated('x', kEqualsLen);
    SIMDFilter filter;

    const auto simdElapsed = measure([&] {
        for (size_t i = 0; i < kEqualsIterations; ++i) {
            const bool eq = filter.simdStringEquals(a.data(), b.data(), a.size());
            ASSERT_TRUE(eq);
        }
    });

    const auto scalarElapsed = measure([&] {
        for (size_t i = 0; i < kEqualsIterations; ++i) {
            const bool eq = std::memcmp(a.data(), b.data(), a.size()) == 0;
            ASSERT_TRUE(eq);
        }
    });

    const auto simdMs = std::chrono::duration_cast<std::chrono::milliseconds>(simdElapsed);
    const auto scalarMs = std::chrono::duration_cast<std::chrono::milliseconds>(scalarElapsed);
    const double ratio = scalarElapsed.count() > 0
        ? static_cast<double>(simdElapsed.count()) / static_cast<double>(scalarElapsed.count())
        : 0.0;

    std::cerr << "[bench] simdStringEquals: " << simdMs.count() << "ms, "
              << "std::memcmp: " << scalarMs.count() << "ms, "
              << "ratio (simd/scalar): " << ratio << "\n";

    EXPECT_LT(simdMs, EQUALS_TARGET) << "simdStringEquals took " << simdMs.count() << "ms";
}

TEST(SimdFilterBench, StringEqualsShorterThan32BUsesFallback) {
    // Boundary: len < 32 skips the AVX2 chunk loop and falls through to memcmp.
    const auto a = makeRepeated('y', 16);
    const auto b = makeRepeated('y', 16);
    SIMDFilter filter;

    EXPECT_TRUE(filter.simdStringEquals(a.data(), b.data(), a.size()));

    auto bMismatch = b;
    bMismatch[10] = 'z';
    EXPECT_FALSE(filter.simdStringEquals(a.data(), bMismatch.data(), a.size()));
}

TEST(SimdFilterBench, StringContainsAvx2PathUnderTarget) {
    const std::string needle = "NEEDLE!!";
    const auto haystack = makeHaystackWithNeedleAtTail(kHaystackLen, needle);
    SIMDFilter filter;

    const auto simdElapsed = measure([&] {
        for (size_t i = 0; i < kContainsIterations; ++i) {
            const bool found = filter.simdStringContains(
                haystack.data(), haystack.size(), needle.data(), needle.size());
            ASSERT_TRUE(found);
        }
    });

    const auto scalarElapsed = measure([&] {
        for (size_t i = 0; i < kContainsIterations; ++i) {
            const auto pos = std::string_view(haystack).find(std::string_view(needle));
            ASSERT_NE(pos, std::string_view::npos);
        }
    });

    const auto simdMs = std::chrono::duration_cast<std::chrono::milliseconds>(simdElapsed);
    const auto scalarMs = std::chrono::duration_cast<std::chrono::milliseconds>(scalarElapsed);
    const double ratio = scalarElapsed.count() > 0
        ? static_cast<double>(simdElapsed.count()) / static_cast<double>(scalarElapsed.count())
        : 0.0;

    std::cerr << "[bench] simdStringContains: " << simdMs.count() << "ms, "
              << "std::string_view::find: " << scalarMs.count() << "ms, "
              << "ratio (simd/scalar): " << ratio << "\n";

    EXPECT_LT(simdMs, CONTAINS_TARGET) << "simdStringContains took " << simdMs.count() << "ms";
}

TEST(SimdFilterBench, StringContainsEmptyNeedleReturnsTrue) {
    // Boundary: empty needle is conventionally a match.
    const auto haystack = makeRepeated('a', 64);
    SIMDFilter filter;

    EXPECT_TRUE(filter.simdStringContains(haystack.data(), haystack.size(), "", 0));
}

TEST(SimdFilterBench, StringContainsNeedleLongerThanHaystackReturnsFalse) {
    // Boundary: needle longer than haystack cannot match.
    const std::string haystack = "short";
    const std::string needle = "much longer needle than the haystack itself";
    SIMDFilter filter;

    EXPECT_FALSE(filter.simdStringContains(
        haystack.data(), haystack.size(), needle.data(), needle.size()));
}

}  // namespace
}  // namespace velocitydb
