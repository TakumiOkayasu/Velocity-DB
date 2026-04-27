#include <gtest/gtest.h>
#include "database/query_history.h"

#include <chrono>

namespace velocitydb {
namespace test {

class QueryHistoryTest : public ::testing::Test {
protected:
    QueryHistory history{100};  // Max 100 items for testing
};

TEST_F(QueryHistoryTest, InitiallyEmpty) {
    EXPECT_TRUE(history.getAll().empty());
}

TEST_F(QueryHistoryTest, AddsItems) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT * FROM Users";
    item.connectionId = "conn-1";
    item.timestamp = std::chrono::system_clock::now();
    item.executionTimeMs = 10.5;
    item.success = true;
    item.affectedRows = 0;
    item.isFavorite = false;

    history.add(item);

    auto all = history.getAll();
    EXPECT_EQ(all.size(), 1);
    EXPECT_EQ(all[0].sql, "SELECT * FROM Users");
}

TEST_F(QueryHistoryTest, SearchesItems) {
    HistoryItem item1;
    item1.id = generateHistoryId();
    item1.sql = "SELECT * FROM Users";
    item1.timestamp = std::chrono::system_clock::now();
    item1.success = true;

    HistoryItem item2;
    item2.id = generateHistoryId();
    item2.sql = "SELECT * FROM Orders";
    item2.timestamp = std::chrono::system_clock::now();
    item2.success = true;

    history.add(item1);
    history.add(item2);

    auto results = history.search("Users");
    EXPECT_EQ(results.size(), 1);
    EXPECT_EQ(results[0].sql, "SELECT * FROM Users");
}

TEST_F(QueryHistoryTest, SearchIsCaseInsensitive) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT * FROM Users";
    item.timestamp = std::chrono::system_clock::now();
    item.success = true;

    history.add(item);

    auto results = history.search("users");
    EXPECT_EQ(results.size(), 1);
}

TEST_F(QueryHistoryTest, SetsFavorite) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT 1";
    item.timestamp = std::chrono::system_clock::now();
    item.success = true;
    item.isFavorite = false;

    history.add(item);

    auto all = history.getAll();
    std::string id = all[0].id;

    history.setFavorite(id, true);

    auto favorites = history.getFavorites();
    EXPECT_EQ(favorites.size(), 1);
}

TEST_F(QueryHistoryTest, ClearKeepsFavorites) {
    HistoryItem item1;
    item1.id = generateHistoryId();
    item1.sql = "SELECT 1";
    item1.timestamp = std::chrono::system_clock::now();
    item1.success = true;
    item1.isFavorite = true;

    HistoryItem item2;
    item2.id = generateHistoryId();
    item2.sql = "SELECT 2";
    item2.timestamp = std::chrono::system_clock::now();
    item2.success = true;
    item2.isFavorite = false;

    history.add(item1);
    history.add(item2);

    EXPECT_EQ(history.getAll().size(), 2);

    history.clear();

    auto remaining = history.getAll();
    EXPECT_EQ(remaining.size(), 1);
    EXPECT_TRUE(remaining[0].isFavorite);
}

TEST_F(QueryHistoryTest, RespectsMaxItems) {
    QueryHistory smallHistory{5};

    for (int i = 0; i < 10; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        item.isFavorite = false;
        smallHistory.add(item);
    }

    auto all = smallHistory.getAll();
    EXPECT_LE(all.size(), 5);
}

TEST_F(QueryHistoryTest, RemoveByIdRemovesItem) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT 1";
    item.timestamp = std::chrono::system_clock::now();
    item.success = true;

    history.add(item);
    auto id = history.getAll()[0].id;

    history.remove(id);

    EXPECT_TRUE(history.getAll().empty());
}

TEST_F(QueryHistoryTest, RemoveNonExistentIdIsNoop) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT 1";
    item.timestamp = std::chrono::system_clock::now();
    item.success = true;

    history.add(item);

    history.remove("nonexistent-id-xxx");

    EXPECT_EQ(history.getAll().size(), 1);
}

TEST_F(QueryHistoryTest, AddSameIdReplacesEntry) {
    HistoryItem item;
    item.id = "fixed-id";
    item.sql = "SELECT 1";
    item.timestamp = std::chrono::system_clock::now();
    item.success = true;

    history.add(item);

    item.sql = "SELECT 2";
    history.add(item);

    auto all = history.getAll();
    EXPECT_EQ(all.size(), 1);
    EXPECT_EQ(all[0].sql, "SELECT 2");
    EXPECT_EQ(all[0].id, "fixed-id");
}

TEST_F(QueryHistoryTest, EvictionSkipsFastWhenAllFavorite) {
    // 全 favorite 状態で maxItems を大幅超過する add が、
    // eviction の find_if(reverse) で O(n) 走査せず O(1) で skip されることを検証する。
    QueryHistory smallHistory{5};
    constexpr int kCount = 50000;  // maxItems の 10000 倍

    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < kCount; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        item.isFavorite = true;
        smallHistory.add(item);
    }
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();

    // favorite は eviction されないので全件残る。
    EXPECT_EQ(smallHistory.getAll().size(), static_cast<size_t>(kCount));

    // O(n) per eviction だと 50000 件 × O(n) = O(n²) で数秒〜数十秒かかる。
    // O(1) skip なら 50000 件 add 全体で << 2 秒。
    EXPECT_LT(elapsed, 2000) << "all-favorite add of " << kCount << " items took " << elapsed << "ms (expected O(1) eviction skip)";
}

TEST_F(QueryHistoryTest, AddRemoveScalesLinearly) {
    // O(1) per op を検証: 件数を 10x にしても合計時間は概ね 10x で収まることを確認する。
    // 絶対閾値は CI runner の負荷で flaky になるため、スケーリング比で判定する。
    auto measureAddRemove = [](int count) {
        QueryHistory h{static_cast<size_t>(count) * 2};
        std::vector<std::string> ids;
        ids.reserve(count);

        auto t0 = std::chrono::steady_clock::now();
        for (int i = 0; i < count; ++i) {
            HistoryItem item;
            item.id = generateHistoryId();
            item.sql = "SELECT " + std::to_string(i) + " FROM tbl_" + std::to_string(i);
            item.timestamp = std::chrono::system_clock::now();
            item.success = true;
            h.add(item);
        }
        for (const auto& it : h.getAll()) {
            ids.push_back(it.id);
        }
        for (const auto& id : ids) {
            h.remove(id);
        }
        return std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - t0).count();
    };

    constexpr int kSmall = 1000;
    constexpr int kLarge = 10000;
    auto tSmall = measureAddRemove(kSmall);
    auto tLarge = measureAddRemove(kLarge);

    // O(n) per op なら ratio ≒ 100 (10x データに対し 100x 時間)。O(1) per op なら ≒ 10。
    // 余裕を見て 30 を上限に設定。これを超えたら superlinear scaling を疑う。
    auto ratio = static_cast<double>(tLarge) / std::max<int64_t>(tSmall, 1);
    EXPECT_LT(ratio, 30.0) << "scaling ratio=" << ratio << " (tSmall=" << tSmall << "us, tLarge=" << tLarge << "us) — superlinear scaling detected";
}

}  // namespace test
}  // namespace velocitydb
