// Correctness regression net for SIMDFilter::filter* (issue #542).
// The public filter* methods are being rerouted to go through the AVX2
// primitives; these tests pin the observable behaviour so the rewrite
// cannot silently regress matching semantics (NULL handling, column-index
// bounds, short-string fallback below the 32-byte AVX2 chunk, range
// inclusivity).

#include "search/simd_filter.h"

#include <deque>
#include <memory>
#include <string>

#include <gtest/gtest.h>

namespace velocitydb {
namespace test {

// ResultRow::values は string_view なので、本体の std::string を fixture の
// arena に保持して寿命を保証する (#553 partial fix で導入された契約)。
class SIMDFilterTest : public ::testing::Test {
protected:
    SIMDFilter filter;
    std::shared_ptr<std::deque<std::string>> arena = std::make_shared<std::deque<std::string>>();

    ResultRow makeRow(std::initializer_list<std::string> values) {
        ResultRow row;
        for (const auto& v : values) {
            arena->emplace_back(v);
            row.values.push_back(arena->back());
            row.nullFlags.push_back(false);
        }
        return row;
    }

    ResultRow makeRowWithNull(size_t nullIndex, std::initializer_list<std::string> values) {
        auto row = makeRow(values);
        if (nullIndex < row.nullFlags.size()) {
            row.nullFlags[nullIndex] = true;
        }
        return row;
    }
};

TEST_F(SIMDFilterTest, FilterEquals_MatchesExactValues) {
    ResultSet data;
    data.rows = {makeRow({"alpha"}), makeRow({"beta"}), makeRow({"alpha"})};

    const auto matches = filter.filterEquals(data, 0, "alpha");

    ASSERT_EQ(matches.size(), 2u);
    EXPECT_EQ(matches[0], 0u);
    EXPECT_EQ(matches[1], 2u);
}

TEST_F(SIMDFilterTest, FilterEquals_SkipsNullCells) {
    ResultSet data;
    data.rows = {makeRowWithNull(0, {"alpha"}), makeRow({"alpha"})};

    const auto matches = filter.filterEquals(data, 0, "alpha");

    ASSERT_EQ(matches.size(), 1u);
    EXPECT_EQ(matches[0], 1u);
}

TEST_F(SIMDFilterTest, FilterEquals_SkipsRowsWithMissingColumn) {
    ResultSet data;
    data.rows = {makeRow({"alpha"}), makeRow({})};

    const auto matches = filter.filterEquals(data, 0, "alpha");

    ASSERT_EQ(matches.size(), 1u);
    EXPECT_EQ(matches[0], 0u);
}

TEST_F(SIMDFilterTest, FilterEquals_LengthMismatchIsNotEqual) {
    // The AVX2 path operates byte-wise on equal-length spans; ensure the
    // public API still rejects length-mismatched values like operator== does.
    ResultSet data;
    data.rows = {makeRow({"alpha"}), makeRow({"alphabet"})};

    const auto matches = filter.filterEquals(data, 0, "alpha");

    ASSERT_EQ(matches.size(), 1u);
    EXPECT_EQ(matches[0], 0u);
}

TEST_F(SIMDFilterTest, FilterEquals_LongStringExercisesAvx2Chunk) {
    // 64 bytes >= the 32-byte AVX2 chunk so the SIMD loop fires when AVX2
    // is available. The fallback path must still match the same answer.
    const std::string longA(64, 'x');
    const std::string longB(64, 'y');
    ResultSet data;
    data.rows = {makeRow({longA}), makeRow({longB}), makeRow({longA})};

    const auto matches = filter.filterEquals(data, 0, longA);

    ASSERT_EQ(matches.size(), 2u);
    EXPECT_EQ(matches[0], 0u);
    EXPECT_EQ(matches[1], 2u);
}

TEST_F(SIMDFilterTest, FilterContains_FindsSubstring) {
    ResultSet data;
    data.rows = {makeRow({"hello world"}), makeRow({"goodbye"}), makeRow({"world peace"})};

    const auto matches = filter.filterContains(data, 0, "world");

    ASSERT_EQ(matches.size(), 2u);
    EXPECT_EQ(matches[0], 0u);
    EXPECT_EQ(matches[1], 2u);
}

TEST_F(SIMDFilterTest, FilterContains_EmptyNeedleMatchesEveryRow) {
    // Matches std::string::find semantics (empty needle is always found).
    ResultSet data;
    data.rows = {makeRow({"alpha"}), makeRow({""})};

    const auto matches = filter.filterContains(data, 0, "");

    ASSERT_EQ(matches.size(), 2u);
}

TEST_F(SIMDFilterTest, FilterContains_NeedleLongerThanHaystackHasNoMatch) {
    ResultSet data;
    data.rows = {makeRow({"abc"})};

    const auto matches = filter.filterContains(data, 0, "abcdefghij");

    EXPECT_TRUE(matches.empty());
}

TEST_F(SIMDFilterTest, FilterContains_LongHaystackExercisesAvx2Chunk) {
    // 64 bytes of 'a' with "NEEDLE" planted near the tail forces the AVX2
    // first-char scan path to fire and then verify the full substring.
    std::string haystack(64, 'a');
    const std::string needle = "NEEDLE";
    haystack.replace(haystack.size() - needle.size() - 1, needle.size(), needle);

    ResultSet data;
    data.rows = {makeRow({haystack}), makeRow({"plain"})};

    const auto matches = filter.filterContains(data, 0, needle);

    ASSERT_EQ(matches.size(), 1u);
    EXPECT_EQ(matches[0], 0u);
}

TEST_F(SIMDFilterTest, FilterContains_SkipsNullCells) {
    ResultSet data;
    data.rows = {makeRowWithNull(0, {"world"}), makeRow({"world peace"})};

    const auto matches = filter.filterContains(data, 0, "world");

    ASSERT_EQ(matches.size(), 1u);
    EXPECT_EQ(matches[0], 1u);
}

TEST_F(SIMDFilterTest, FilterRange_IncludesBoundaries) {
    ResultSet data;
    data.rows = {makeRow({"apple"}), makeRow({"banana"}), makeRow({"cherry"}), makeRow({"date"})};

    const auto matches = filter.filterRange(data, 0, "banana", "cherry");

    ASSERT_EQ(matches.size(), 2u);
    EXPECT_EQ(matches[0], 1u);
    EXPECT_EQ(matches[1], 2u);
}

}  // namespace test
}  // namespace velocitydb
