// README #10: QueryHistory.search() target — 1 万件で 100ms 未満。
// trigram inverted index が posting list 交差 + 最終 substring 検証で
// 線形 substring 走査 (O(n*m)) より高速になることを検証する。

#include "database/query_history.h"

#include <chrono>
#include <format>
#include <string>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kBenchCount = 10000;
constexpr auto SEARCH_TARGET = std::chrono::milliseconds(100);

class QueryHistorySearchBench : public ::testing::Test {
protected:
    QueryHistory history{kBenchCount};

    void SetUp() override {
        for (size_t i = 0; i < kBenchCount; ++i) {
            HistoryItem item;
            item.id = generateHistoryId();
            item.sql = std::format("SELECT col_{} FROM tbl_{} WHERE id = {}", i, i % 100, i);
            item.success = true;
            history.add(item);
        }
    }

    static std::chrono::milliseconds measureSearch(QueryHistory& h, std::string_view keyword) {
        const auto start = std::chrono::steady_clock::now();
        const auto results = h.search(keyword);
        const auto elapsed = std::chrono::steady_clock::now() - start;
        // 結果が空でも測定は有効。NoMatch ケース用。
        (void)results;
        return std::chrono::duration_cast<std::chrono::milliseconds>(elapsed);
    }
};

TEST_F(QueryHistorySearchBench, ShortKeywordUnder100ms) {
    // 5 文字: trigram 3 個。selectivity が高い posting (col_5) を起点に絞られる想定。
    const auto results = history.search("col_5");
    EXPECT_FALSE(results.empty());

    const auto elapsed = measureSearch(history, "col_5");
    EXPECT_LT(elapsed, SEARCH_TARGET) << "search('col_5') took " << elapsed.count() << "ms";
}

TEST_F(QueryHistorySearchBench, MediumKeywordUnder100ms) {
    // 10 文字: trigram 8 個。長いほど候補が絞られる。
    const auto results = history.search("tbl_50 WHE");
    EXPECT_FALSE(results.empty());

    const auto elapsed = measureSearch(history, "tbl_50 WHE");
    EXPECT_LT(elapsed, SEARCH_TARGET) << "search('tbl_50 WHE') took " << elapsed.count() << "ms";
}

TEST_F(QueryHistorySearchBench, LongKeywordUnder100ms) {
    // 21 文字: trigram 19 個。さらに絞り込まれる。
    const auto kw = std::string("col_500 FROM tbl_0 WH");
    const auto results = history.search(kw);
    EXPECT_FALSE(results.empty());

    const auto elapsed = measureSearch(history, kw);
    EXPECT_LT(elapsed, SEARCH_TARGET) << "search('" << kw << "') took " << elapsed.count() << "ms";
}

TEST_F(QueryHistorySearchBench, NoMatchUnder100ms) {
    // 完全不一致: 1 個でも posting に欠ける trigram があれば早期 return で 0 件。
    const auto kw = std::string("ZZZZQQQQXXXX");
    const auto elapsed = measureSearch(history, kw);
    EXPECT_LT(elapsed, SEARCH_TARGET) << "search('" << kw << "') took " << elapsed.count() << "ms";
}

}  // namespace
}  // namespace velocitydb
