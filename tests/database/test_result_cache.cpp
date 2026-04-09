#include <gtest/gtest.h>
#include "database/result_cache.h"

namespace velocitydb {
namespace test {

namespace {

ResultSet makeResult(size_t numRows, size_t colSize = 10) {
    ResultSet rs;
    rs.columns = {{.name = "col1", .type = "VARCHAR", .size = 100}};
    rs.rows.reserve(numRows);
    for (size_t i = 0; i < numRows; ++i) {
        ResultRow row;
        row.values.emplace_back(colSize, 'x');
        row.nullFlags.push_back(false);
        rs.rows.push_back(std::move(row));
    }
    return rs;
}

}  // namespace

class ResultCacheTest : public ::testing::Test {
protected:
    // Small cache (1KB) for easy eviction testing
    ResultCache cache{1024};
};

TEST_F(ResultCacheTest, PutAndGet) {
    auto rs = makeResult(1);
    cache.put("q1", rs);

    auto result = cache.get("q1");
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->rows.size(), 1);
    EXPECT_EQ(result->rows[0].values[0], std::string(10, 'x'));
}

TEST_F(ResultCacheTest, GetNonExistent) {
    EXPECT_FALSE(cache.get("missing").has_value());
}

TEST_F(ResultCacheTest, Invalidate) {
    cache.put("q1", makeResult(1));
    cache.invalidate("q1");
    EXPECT_FALSE(cache.get("q1").has_value());
    EXPECT_EQ(cache.getCurrentSize(), 0);
}

TEST_F(ResultCacheTest, Clear) {
    cache.put("q1", makeResult(1));
    cache.put("q2", makeResult(1));
    cache.clear();
    EXPECT_FALSE(cache.get("q1").has_value());
    EXPECT_FALSE(cache.get("q2").has_value());
    EXPECT_EQ(cache.getCurrentSize(), 0);
}

TEST_F(ResultCacheTest, EvictsOldestFirst) {
    // Fill cache with multiple entries, then add one that triggers eviction
    cache.put("oldest", makeResult(5, 50));
    cache.put("middle", makeResult(5, 50));
    cache.put("newest", makeResult(5, 50));

    // This should evict "oldest" first
    cache.put("trigger", makeResult(5, 50));

    EXPECT_FALSE(cache.get("oldest").has_value());
    EXPECT_TRUE(cache.get("newest").has_value());
    EXPECT_TRUE(cache.get("trigger").has_value());
}

TEST_F(ResultCacheTest, GetUpdatesLruOrder) {
    cache.put("a", makeResult(5, 50));
    cache.put("b", makeResult(5, 50));
    cache.put("c", makeResult(5, 50));

    // Access "a" to make it recently used
    cache.get("a");

    // Trigger eviction - "b" should be evicted (oldest unused), not "a"
    cache.put("d", makeResult(5, 50));

    EXPECT_TRUE(cache.get("a").has_value());
    EXPECT_FALSE(cache.get("b").has_value());
}

TEST_F(ResultCacheTest, SkipsOversizedResult) {
    // Result larger than max cache size
    auto huge = makeResult(100, 100);
    cache.put("huge", huge);
    EXPECT_FALSE(cache.get("huge").has_value());
    EXPECT_EQ(cache.getCurrentSize(), 0);
}

TEST_F(ResultCacheTest, UpdateExistingEntry) {
    cache.put("q1", makeResult(1, 10));
    auto sizeBefore = cache.getCurrentSize();

    cache.put("q1", makeResult(2, 10));
    auto result = cache.get("q1");
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->rows.size(), 2);
}

TEST_F(ResultCacheTest, SizeTracking) {
    EXPECT_EQ(cache.getCurrentSize(), 0);
    cache.put("q1", makeResult(1));
    EXPECT_GT(cache.getCurrentSize(), 0);
    cache.invalidate("q1");
    EXPECT_EQ(cache.getCurrentSize(), 0);
}

}  // namespace test
}  // namespace velocitydb
