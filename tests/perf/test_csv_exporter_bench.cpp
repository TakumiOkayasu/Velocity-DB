// PERFORMANCE_VALIDATION.md #7: CSV export (100,000 rows) under 2s.
//
// CSVExporter streams to std::ofstream in binary mode and is dominated by
// per-cell escaping + stream writes. This bench builds an in-memory 10-column
// ResultSet (mix of int-as-string / short text / NULL / quote-bearing text so
// every escapeCSV branch is exercised), calls exportData(), and asserts the
// wall time stays below the 2s target.
//
// The target is a CI-friendly upper bound, not a microbenchmark — disk I/O
// and OS cache state cause real variance. 2s aligns with the documented goal;
// local Release runs sit well below it.

#include "exporters/csv_exporter.h"

#include <chrono>
#include <filesystem>
#include <format>
#include <iostream>
#include <string>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kBenchRows = 100'000;
constexpr size_t kBenchColumns = 10;
constexpr auto EXPORT_TARGET = std::chrono::milliseconds(2'000);

// NULL を散らす頻度 (約 5.9% のセルが SQL NULL になる)。escapedNullValue 経路を
// 偏らせず分布させ、行ごとに NULL 位置がずれることで分岐予測の偏りを抑える。
constexpr size_t kNullEveryNthCell = 17;
// 1 セルだけ delimiter + quote を埋め込み、escapeCSV のクオート経路を強制的に
// 通す。列インデックスはこの目的専用に固定。
constexpr size_t kEscapeHeavyColumn = 3;

// セル値の生成パターン。CSVExporter::escapeCSV の分岐 (NULL / クオート必要 /
// 平文) を網羅するために列ごとに役割を切り替える。
enum class CellKind {
    SqlNull,        // SQL NULL — escapedNullValue 経路
    EscapeHeavy,    // delimiter + quote 含む — 強制クオート経路
    NumericLike,    // 数値のみ — 短い平文経路
    ShortText,      // 短文 — 標準クオート経路
};

[[nodiscard]] CellKind classifyCell(size_t row, size_t col) {
    if ((row + col) % kNullEveryNthCell == 0) return CellKind::SqlNull;
    if (col == kEscapeHeavyColumn) return CellKind::EscapeHeavy;
    if (col % 2 == 0) return CellKind::NumericLike;
    return CellKind::ShortText;
}

[[nodiscard]] std::string makeCellValue(CellKind kind, size_t row, size_t col) {
    switch (kind) {
        case CellKind::SqlNull:      return {};
        case CellKind::EscapeHeavy:  return std::format("v,{}\"x", row);
        case CellKind::NumericLike:  return std::format("{}", row * (col + 1));
        case CellKind::ShortText:    return std::format("row_{}_col_{}", row, col);
    }
    return {};  // unreachable
}

class CSVExporterBench : public ::testing::Test {
protected:
    ResultSet data;
    std::filesystem::path outPath;

    void SetUp() override {
        data.columns = buildColumns();
        data.rows = buildRows();
        outPath = makeTempOutputPath();
    }

    void TearDown() override {
        std::error_code ec;
        std::filesystem::remove(outPath, ec);
    }

private:
    static std::vector<ColumnInfo> buildColumns() {
        std::vector<ColumnInfo> cols;
        cols.reserve(kBenchColumns);
        for (size_t c = 0; c < kBenchColumns; ++c) {
            ColumnInfo col;
            col.name = std::format("col_{}", c);
            cols.push_back(std::move(col));
        }
        return cols;
    }

    static std::vector<ResultRow> buildRows() {
        std::vector<ResultRow> rows;
        rows.reserve(kBenchRows);
        for (size_t r = 0; r < kBenchRows; ++r) {
            rows.push_back(buildRow(r));
        }
        return rows;
    }

    static ResultRow buildRow(size_t r) {
        ResultRow row;
        row.values.reserve(kBenchColumns);
        row.nullFlags.resize(kBenchColumns, false);
        for (size_t c = 0; c < kBenchColumns; ++c) {
            const auto kind = classifyCell(r, c);
            row.values.emplace_back(makeCellValue(kind, r, c));
            if (kind == CellKind::SqlNull) {
                row.nullFlags[c] = true;
            }
        }
        return row;
    }

    static std::filesystem::path makeTempOutputPath() {
        return std::filesystem::temp_directory_path()
               / std::format("velocitydb_csv_bench_{}.csv",
                             std::chrono::steady_clock::now().time_since_epoch().count());
    }
};

TEST_F(CSVExporterBench, Export100kRowsUnderTarget) {
    CSVExporter exporter;

    const auto start = std::chrono::steady_clock::now();
    const bool ok = exporter.exportData(data, outPath.string());
    const auto elapsed = std::chrono::steady_clock::now() - start;

    ASSERT_TRUE(ok);

    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed);
    std::cerr << "[bench] CSVExporter 100k rows x " << kBenchColumns << " cols: "
              << elapsedMs.count() << "ms\n";

    EXPECT_LT(elapsedMs, EXPORT_TARGET)
        << "CSV export of " << kBenchRows << " rows took " << elapsedMs.count() << "ms";
}

}  // namespace
}  // namespace velocitydb
