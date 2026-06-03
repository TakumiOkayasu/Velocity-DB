// PERFORMANCE_VALIDATION.md #8: A5ERParser target — テキスト/XML 両形式で mean < 100ms。
//
// A5ERParser は pugixml ベースの XML パーサーと独自テキストパーサーで構成される。
// 100 テーブル × 5 列 + 99 リレーションのフィクスチャで両形式を計測し、
// 各形式の mean を 100ms (100000μs) target で assert する。
//
// フィクスチャは tests/fixtures/a5er/ に gen_a5er_fixture.py で生成したファイルを使用。
// I/O コストを除くため SetUp でファイルを読み込み、parseFromString() のみを計測する。
// 計測は 20 反復 (ウォームアップ 2 回 + 計測 20 回) → mean / median / max を μs で出力。
// max は冷キャッシュ初回の外れ値検出用。median 計算は kRepeatCount が奇数であることを前提とする。

#include "parsers/a5er_parser.h"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <format>
#include <fstream>
#include <iostream>
#include <numeric>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

constexpr size_t kRepeatCount = 20;  // 奇数: median = samples[10]
constexpr auto kParseTarget = std::chrono::microseconds(100'000);  // 100ms

[[nodiscard]] std::string readFile(const std::filesystem::path& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f.is_open()) {
        throw std::runtime_error("Cannot open fixture: " + path.string());
    }
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

struct BenchStats {
    std::chrono::microseconds mean;
    std::chrono::microseconds median;
    std::chrono::microseconds max;
};

[[nodiscard]] BenchStats measureParse(const A5ERParser& parser, const std::string& content) {
    // 命令キャッシュ・メモリページフォルトを事前消化してから計測する
    for (size_t i = 0; i < 2; ++i) {
        (void)parser.parseFromString(content).tables.size();
    }

    std::vector<std::chrono::microseconds> samples;
    samples.reserve(kRepeatCount);
    for (size_t i = 0; i < kRepeatCount; ++i) {
        const auto start = std::chrono::steady_clock::now();
        const auto model = parser.parseFromString(content);
        const auto elapsed = std::chrono::steady_clock::now() - start;
        // 最適化で parseFromString() 呼び出しが除去されないよう結果を参照
        (void)model.tables.size();
        samples.push_back(std::chrono::duration_cast<std::chrono::microseconds>(elapsed));
    }
    std::sort(samples.begin(), samples.end());
    const auto sum = std::accumulate(samples.begin(), samples.end(), std::chrono::microseconds(0));
    return {
        sum / kRepeatCount,
        samples[samples.size() / 2],  // kRepeatCount が奇数の場合に正確な中央値
        samples.back(),
    };
}

void reportStats(std::string_view label, const BenchStats& s) {
    std::cerr << std::format("[bench] A5ERParser {}: mean={}us median={}us max={}us\n",
                             label, s.mean.count(), s.median.count(), s.max.count());
}

class A5ERParserBench : public ::testing::Test {
protected:
    A5ERParser parser;
    std::string textContent;
    std::string xmlContent;

    void SetUp() override {
        const std::filesystem::path fixturesDir{TEST_FIXTURES_DIR};
        textContent = readFile(fixturesDir / "a5er" / "fixture_100tables.a5er");
        xmlContent = readFile(fixturesDir / "a5er" / "fixture_100tables.a5er.xml");
    }
};

TEST_F(A5ERParserBench, should_ParseUnder100ms_whenTextFormat100Tables) {
    const auto stats = measureParse(parser, textContent);
    reportStats(std::format("text-100tables({} chars)", textContent.size()), stats);
    EXPECT_LT(stats.mean, kParseTarget)
        << "parseFromString(text, 100 tables) mean=" << stats.mean.count()
        << "us exceeded target " << kParseTarget.count() << "us";
}

TEST_F(A5ERParserBench, should_ParseUnder100ms_whenXmlFormat100Tables) {
    const auto stats = measureParse(parser, xmlContent);
    reportStats(std::format("xml-100tables({} chars)", xmlContent.size()), stats);
    EXPECT_LT(stats.mean, kParseTarget)
        << "parseFromString(xml, 100 tables) mean=" << stats.mean.count()
        << "us exceeded target " << kParseTarget.count() << "us";
}

}  // namespace
}  // namespace velocitydb
