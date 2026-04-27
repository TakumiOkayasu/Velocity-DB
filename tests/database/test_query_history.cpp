#include <gtest/gtest.h>
#include "database/query_history.h"

#include <chrono>
#include <filesystem>
#include <fstream>

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

TEST_F(QueryHistoryTest, SetMaxItemsShrinksHistoryEvictingNonFavorites) {
    QueryHistory h{10};
    for (int i = 0; i < 10; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        // 偶数 index を favorite (5 件)
        item.isFavorite = (i % 2 == 0);
        h.add(item);
    }
    ASSERT_EQ(h.getAll().size(), 10);

    // 上限を 5 に縮小: 非 favorite (5 件) が削除されて favorite だけが残る想定
    h.setMaxItems(5);

    auto remaining = h.getAll();
    EXPECT_EQ(remaining.size(), 5);
    for (const auto& item : remaining) {
        EXPECT_TRUE(item.isFavorite) << "non-favorite survived after shrink: " << item.sql;
    }
}

TEST_F(QueryHistoryTest, SetMaxItemsLargerThanCurrentKeepsAll) {
    QueryHistory h{5};
    for (int i = 0; i < 5; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        h.add(item);
    }
    ASSERT_EQ(h.getAll().size(), 5);

    h.setMaxItems(100);
    EXPECT_EQ(h.getAll().size(), 5);
}

TEST_F(QueryHistoryTest, SearchUtf8JapaneseKeyword) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT * FROM ユーザー WHERE id = 1";
    item.success = true;
    history.add(item);

    auto results = history.search("ユーザー");
    EXPECT_EQ(results.size(), 1);
}

TEST_F(QueryHistoryTest, SearchUtf8PartialMultibyte) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT * FROM ユーザー";
    item.success = true;
    history.add(item);

    // "ユー" = 6 byte (3 byte * 2)。trigram 4 個生成される。
    auto results = history.search("ユー");
    EXPECT_EQ(results.size(), 1);
}

TEST_F(QueryHistoryTest, SearchShortKeywordFallbackOneByte) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT a FROM tbl";
    item.success = true;
    history.add(item);

    // 1 byte: trigram 化不可 → 線形 fallback
    auto results = history.search("a");
    EXPECT_EQ(results.size(), 1);
}

TEST_F(QueryHistoryTest, SearchShortKeywordFallbackTwoByte) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT ab FROM tbl";
    item.success = true;
    history.add(item);

    // 2 byte: trigram 化不可 → 線形 fallback
    auto results = history.search("ab");
    EXPECT_EQ(results.size(), 1);
}

TEST_F(QueryHistoryTest, SearchTrigramFalsePositiveExcluded) {
    HistoryItem item;
    item.id = generateHistoryId();
    // "abc" "bcd" は両方 sql に含まれるが、"abcdef" は substring として存在しない
    item.sql = "abcXdef";
    item.success = true;
    history.add(item);

    auto results = history.search("abcdef");
    EXPECT_EQ(results.size(), 0) << "trigram 候補だが substring 不一致 → 0 件であるべき";
}

TEST_F(QueryHistoryTest, SearchAfterRemoveSyncsIndex) {
    HistoryItem item1;
    item1.id = "id-A";
    item1.sql = "SELECT alpha_unique_token FROM tbl";
    item1.success = true;
    HistoryItem item2;
    item2.id = "id-B";
    item2.sql = "SELECT beta FROM tbl";
    item2.success = true;
    history.add(item1);
    history.add(item2);

    history.remove("id-A");

    // A 固有の trigram で検索しても 0 件であるべき
    auto results = history.search("alpha_unique_token");
    EXPECT_EQ(results.size(), 0);
    // B はまだ残る
    EXPECT_EQ(history.search("beta").size(), 1);
}

TEST_F(QueryHistoryTest, SearchAfterEvictionSyncsIndex) {
    QueryHistory smallHistory{2};
    HistoryItem itemA;
    itemA.id = generateHistoryId();
    itemA.sql = "alpha_evicted_token";
    itemA.success = true;
    smallHistory.add(itemA);

    HistoryItem itemB;
    itemB.id = generateHistoryId();
    itemB.sql = "beta_token";
    itemB.success = true;
    smallHistory.add(itemB);

    HistoryItem itemC;
    itemC.id = generateHistoryId();
    itemC.sql = "gamma_token";
    itemC.success = true;
    smallHistory.add(itemC);

    // A は eviction された
    EXPECT_EQ(smallHistory.getAll().size(), 2);
    auto results = smallHistory.search("alpha_evicted_token");
    EXPECT_EQ(results.size(), 0) << "eviction された A の trigram は index から消えているべき";
}

TEST_F(QueryHistoryTest, SearchAfterClearSyncsIndex) {
    HistoryItem item;
    item.id = generateHistoryId();
    item.sql = "SELECT cleared_token FROM tbl";
    item.success = true;
    item.isFavorite = false;
    history.add(item);

    history.clear();

    auto results = history.search("cleared_token");
    EXPECT_EQ(results.size(), 0);
}

TEST_F(QueryHistoryTest, SearchAfterSetMaxItemsShrinkSyncsIndex) {
    QueryHistory h{5};
    for (int i = 0; i < 5; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "shrink_token_" + std::to_string(i);
        item.success = true;
        item.isFavorite = false;
        h.add(item);
    }
    ASSERT_EQ(h.getAll().size(), 5);

    // 最古 (push_front の back 側) から eviction される: token_0, token_1, token_2
    h.setMaxItems(2);
    EXPECT_EQ(h.getAll().size(), 2);

    auto results = h.search("shrink_token_0");
    EXPECT_EQ(results.size(), 0) << "eviction された 0 の trigram が残っていない";
}

TEST_F(QueryHistoryTest, SearchAfterLoadRebuildsIndex) {
    auto path = std::filesystem::temp_directory_path() / "qh_load_test.json";
    {
        QueryHistory writer{100};
        HistoryItem item;
        item.id = "loaded-id";
        item.sql = "SELECT loaded_token FROM tbl";
        item.success = true;
        writer.add(item);
        ASSERT_TRUE(writer.save(path.string()).has_value());
    }

    QueryHistory reader{100};
    ASSERT_TRUE(reader.load(path.string()).has_value());

    auto results = reader.search("loaded_token");
    EXPECT_EQ(results.size(), 1);

    std::filesystem::remove(path);
}

TEST_F(QueryHistoryTest, SearchUpdatesIndexOnReAdd) {
    HistoryItem item;
    item.id = "fixed";
    item.sql = "SELECT old_token FROM tbl";
    item.success = true;
    history.add(item);

    item.sql = "SELECT new_token FROM tbl";
    history.add(item);

    // 旧 trigram は消えている
    EXPECT_EQ(history.search("old_token").size(), 0);
    // 新 trigram でヒット
    EXPECT_EQ(history.search("new_token").size(), 1);
}

TEST_F(QueryHistoryTest, SearchPreservesLruOrder) {
    HistoryItem item1;
    item1.id = generateHistoryId();
    item1.sql = "SELECT order_token FROM a";
    item1.success = true;
    history.add(item1);

    HistoryItem item2;
    item2.id = generateHistoryId();
    item2.sql = "SELECT order_token FROM b";
    item2.success = true;
    history.add(item2);

    // 後に add した item2 が先頭 (newest first)
    auto results = history.search("order_token");
    ASSERT_EQ(results.size(), 2);
    EXPECT_EQ(results[0].sql, "SELECT order_token FROM b");
    EXPECT_EQ(results[1].sql, "SELECT order_token FROM a");
}

}  // namespace test
}  // namespace velocitydb
