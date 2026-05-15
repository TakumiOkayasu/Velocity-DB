// PERFORMANCE_VALIDATION.md #6: SQLFormatter target — 中サイズで mean < 50ms。
//
// SQLFormatter は unordered_set ベースのキーワード判定 (O(1)) + 文字単位
// ストリーミングパースで、入力長 N に対し O(N) で動作する想定。小 (JOIN-heavy
// 短文) / 中 (500 行) / 大 (10000 行) の 3 段階で計測し、中サイズの mean を
// 50ms target で assert する。
//
// 計測は 5 反復 → mean / median / max を出力。Plan は「平均・p95」だが、5
// サンプルでは percentile が安定しないため median + max (worst case) に置換。
// max は冷キャッシュ初回 + 外れ値検出用。中サイズの mean のみ assert し、
// 小/大は情報出力のみ (大は非線形リグレッション検出のためのウォッチ枠)。

#include "parsers/sql_formatter.h"

#include <algorithm>
#include <chrono>
#include <format>
#include <iostream>
#include <numeric>
#include <string>
#include <string_view>
#include <vector>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kRepeatCount = 5;
constexpr auto FORMAT_TARGET = std::chrono::milliseconds(50);

// 1 unit SELECT を unitCount 回 UNION ALL で連結し長い SQL を生成。各 unit に
// キーワード / 識別子 / リテラルを含めて formatter の主要分岐を網羅する。
[[nodiscard]] std::string buildLongSql(size_t unitCount) {
    std::string sql;
    sql.reserve(unitCount * 80);
    for (size_t i = 0; i < unitCount; ++i) {
        if (i > 0) sql.append(" UNION ALL ");
        sql.append(std::format(
            "SELECT id, name, value FROM tbl_{} WHERE id = {} AND name = 'row_{}'",
            i % 100, i, i));
    }
    return sql;
}

// 100 行相当の JOIN-heavy SELECT (実用的な複合クエリの再現)。
[[nodiscard]] std::string buildJoinHeavySql() {
    std::string sql = "SELECT u.id, u.name, o.order_date, o.total, p.product_name, "
                      "c.category_name, w.warehouse_code "
                      "FROM users u "
                      "JOIN orders o ON u.id = o.user_id "
                      "LEFT JOIN order_items oi ON o.id = oi.order_id "
                      "LEFT JOIN products p ON oi.product_id = p.id "
                      "LEFT JOIN categories c ON p.category_id = c.id "
                      "LEFT JOIN warehouses w ON p.warehouse_id = w.id "
                      "WHERE ";
    for (size_t i = 0; i < 100; ++i) {
        if (i > 0) sql.append(" OR ");
        sql.append(std::format("(u.id = {} AND o.total > {})", i, i * 10));
    }
    sql.append(" ORDER BY o.order_date DESC, u.name ASC");
    return sql;
}

struct BenchStats {
    std::chrono::milliseconds mean;
    std::chrono::milliseconds median;
    std::chrono::milliseconds max;
};

[[nodiscard]] BenchStats measureFormat(SQLFormatter& formatter, std::string_view sql) {
    std::vector<std::chrono::milliseconds> samples;
    samples.reserve(kRepeatCount);
    for (size_t i = 0; i < kRepeatCount; ++i) {
        const auto start = std::chrono::steady_clock::now();
        const auto formatted = formatter.format(sql);
        const auto elapsed = std::chrono::steady_clock::now() - start;
        // 最適化で format() 呼び出しが除去されないよう結果を参照
        (void)formatted.size();
        samples.push_back(
            std::chrono::duration_cast<std::chrono::milliseconds>(elapsed));
    }
    std::sort(samples.begin(), samples.end());
    const auto sum = std::accumulate(samples.begin(), samples.end(),
                                     std::chrono::milliseconds(0));
    return {
        sum / kRepeatCount,
        samples[samples.size() / 2],
        samples.back(),
    };
}

void reportStats(std::string_view label, const BenchStats& s) {
    std::cerr << std::format("[bench] SQLFormatter {}: mean={}ms median={}ms max={}ms\n",
                             label, s.mean.count(), s.median.count(), s.max.count());
}

class SQLFormatterBench : public ::testing::Test {
protected:
    SQLFormatter formatter;
};

TEST_F(SQLFormatterBench, SmallJoinHeavyInformational) {
    const auto sql = buildJoinHeavySql();
    const auto stats = measureFormat(formatter, sql);
    reportStats(std::format("small-join-heavy({} chars)", sql.size()), stats);
}

TEST_F(SQLFormatterBench, MediumUnder50ms) {
    const auto sql = buildLongSql(500);
    const auto stats = measureFormat(formatter, sql);
    reportStats(std::format("medium-500lines({} chars)", sql.size()), stats);
    EXPECT_LT(stats.mean, FORMAT_TARGET)
        << "format(500 lines) mean=" << stats.mean.count() << "ms exceeded target "
        << FORMAT_TARGET.count() << "ms";
}

TEST_F(SQLFormatterBench, LargeInformational) {
    const auto sql = buildLongSql(10000);
    const auto stats = measureFormat(formatter, sql);
    reportStats(std::format("large-10000lines({} chars)", sql.size()), stats);
}

}  // namespace
}  // namespace velocitydb
