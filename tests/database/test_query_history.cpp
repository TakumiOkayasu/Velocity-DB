#include <gtest/gtest.h>
#include "database/query_history.h"

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
    item1.sql = "SELECT * FROM Users";
    item1.timestamp = std::chrono::system_clock::now();
    item1.success = true;

    HistoryItem item2;
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
    item.sql = "SELECT * FROM Users";
    item.timestamp = std::chrono::system_clock::now();
    item.success = true;

    history.add(item);

    auto results = history.search("users");
    EXPECT_EQ(results.size(), 1);
}

TEST_F(QueryHistoryTest, SetsFavorite) {
    HistoryItem item;
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
    item1.sql = "SELECT 1";
    item1.timestamp = std::chrono::system_clock::now();
    item1.success = true;
    item1.isFavorite = true;

    HistoryItem item2;
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
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        item.isFavorite = false;
        smallHistory.add(item);
    }

    auto all = smallHistory.getAll();
    EXPECT_LE(all.size(), 5);
}

}  // namespace test
}  // namespace velocitydb
