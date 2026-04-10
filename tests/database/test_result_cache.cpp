#include <gtest/gtest.h>
#include "database/result_cache.h"

namespace velocitydb {
namespace test {

namespace {

ResultSet makeResultSet(int numRows, int numCols) {
    ResultSet rs;
    rs.columns.reserve(static_cast<size_t>(numCols));
    for (int c = 0; c < numCols; ++c) {
        rs.columns.push_back(ColumnInfo{.name = "col" + std::to_string(c), .type = "VARCHAR"});
    }
    rs.rows.reserve(static_cast<size_t>(numRows));
    for (int r = 0; r < numRows; ++r) {
        ResultRow row;
        row.values.reserve(static_cast<size_t>(numCols));
        row.nullFlags.reserve(static_cast<size_t>(numCols));
        for (int c = 0; c < numCols; ++c) {
            row.values.push_back("val_" + std::to_string(r) + "_" + std::to_string(c));
            row.nullFlags.push_back(false);
        }
        rs.rows.push_back(std::move(row));
    }
    rs.affectedRows = numRows;
    return rs;
}

size_t measureItemSize() {
    ResultCache probe{1024 * 1024};
    probe.put("measure", makeResultSet(1, 1));
    return probe.getCurrentSize();
}

}  // namespace

class ResultCacheTest : public ::testing::Test {
protected:
    ResultCache cache{1024 * 1024};  // 1MB for testing
};

// #1: put/getAndApplyで値を保存・取得できる
TEST_F(ResultCacheTest, PutAndGetReturnsStoredValue) {
    auto rs = makeResultSet(2, 3);
    cache.put("key1", rs);

    auto colCount = cache.getAndApply("key1", [](const ResultSet& r) { return r.columns.size(); });
    auto rowCount = cache.getAndApply("key1", [](const ResultSet& r) { return r.rows.size(); });
    auto firstVal = cache.getAndApply("key1", [](const ResultSet& r) { return r.rows[0].values[0]; });

    EXPECT_EQ(colCount, 3);
    EXPECT_EQ(rowCount, 2);
    EXPECT_EQ(firstVal, "val_0_0");
}

// #2: 存在しないキーは空を返す
TEST_F(ResultCacheTest, GetMissingKeyReturnsEmpty) {
    auto result = cache.getAndApply("nonexistent", [](const ResultSet& r) { return r.columns.size(); });
    EXPECT_EQ(result, 0);
}

// #3: invalidateでキーを削除
TEST_F(ResultCacheTest, InvalidateRemovesEntry) {
    cache.put("key1", makeResultSet(1, 1));
    ASSERT_TRUE(cache.contains("key1"));

    cache.invalidate("key1");
    EXPECT_FALSE(cache.contains("key1"));
}

// #4: clearで全削除
TEST_F(ResultCacheTest, ClearRemovesAllEntries) {
    cache.put("a", makeResultSet(1, 1));
    cache.put("b", makeResultSet(1, 1));
    cache.put("c", makeResultSet(1, 1));

    cache.clear();

    EXPECT_FALSE(cache.contains("a"));
    EXPECT_FALSE(cache.contains("b"));
    EXPECT_FALSE(cache.contains("c"));
    EXPECT_EQ(cache.getCurrentSize(), 0);
}

// #5: LRU順でevict（最古が追い出される）
TEST_F(ResultCacheTest, EvictsOldestEntryWhenFull) {
    auto itemSize = measureItemSize();
    ResultCache smallCache{itemSize * 3 - 1};
    auto rs = makeResultSet(1, 1);

    smallCache.put("first", rs);
    smallCache.put("second", rs);
    smallCache.put("third", rs);

    EXPECT_FALSE(smallCache.contains("first"));
    EXPECT_TRUE(smallCache.contains("third"));
}

// #6: getAndApplyでアクセス順が更新される
TEST_F(ResultCacheTest, GetUpdatesLruOrder) {
    auto itemSize = measureItemSize();
    ResultCache smallCache{itemSize * 4 - 1};
    auto rs = makeResultSet(1, 1);

    smallCache.put("A", rs);
    smallCache.put("B", rs);
    smallCache.put("C", rs);

    // 3件格納をサイズで確認（LRU順序を変えない）
    ASSERT_EQ(smallCache.getCurrentSize(), itemSize * 3);

    // AにアクセスしてLRU順更新 → LRU順: B, C, A
    smallCache.getAndApply("A", [](const ResultSet&) { return true; });

    // 4件目追加 → Bがevict（最古）
    smallCache.put("D", rs);

    EXPECT_FALSE(smallCache.contains("B"));
    EXPECT_TRUE(smallCache.contains("A"));
}

// #7: 同一キー上書き
TEST_F(ResultCacheTest, PutOverwritesExistingKey) {
    cache.put("key1", makeResultSet(1, 1));
    cache.put("key1", makeResultSet(3, 2));

    auto rowCount = cache.getAndApply("key1", [](const ResultSet& r) { return r.rows.size(); });
    auto colCount = cache.getAndApply("key1", [](const ResultSet& r) { return r.columns.size(); });
    EXPECT_EQ(rowCount, 3);
    EXPECT_EQ(colCount, 2);
}

// #8: サイズ追跡が正確
TEST_F(ResultCacheTest, CurrentSizeTracksAccurately) {
    EXPECT_EQ(cache.getCurrentSize(), 0);

    cache.put("key1", makeResultSet(2, 2));
    EXPECT_GT(cache.getCurrentSize(), 0);

    cache.invalidate("key1");
    EXPECT_EQ(cache.getCurrentSize(), 0);
}

// #9: putでResultSetがmoveされる（rvalue渡し）
TEST_F(ResultCacheTest, PutMovesRvalueResultSet) {
    auto rs = makeResultSet(5, 3);
    auto originalSize = rs.rows.size();

    cache.put("moved", std::move(rs));

    // move元が空になったことで検証
    EXPECT_TRUE(rs.rows.empty());

    auto cachedSize = cache.getAndApply("moved", [](const ResultSet& r) { return r.rows.size(); });
    EXPECT_EQ(cachedSize, originalSize);
}

// #10: getAndApplyがロック保持中にコールバック実行
TEST_F(ResultCacheTest, GetAndApplyExecutesCallbackUnderLock) {
    cache.put("ref", makeResultSet(2, 2));

    auto result = cache.getAndApply("ref", [](const ResultSet& r) {
        return std::string(r.rows[0].values[0]);
    });
    EXPECT_EQ(result, "val_0_0");
}

// #11: string_viewで直接検索可能
TEST_F(ResultCacheTest, FindsWithStringView) {
    cache.put("sv_test", makeResultSet(1, 1));

    std::string_view sv = "sv_test";
    EXPECT_TRUE(cache.contains(sv));
    auto colCount = cache.getAndApply(sv, [](const ResultSet& r) { return r.columns.size(); });
    EXPECT_EQ(colCount, 1);
}

}  // namespace test
}  // namespace velocitydb
