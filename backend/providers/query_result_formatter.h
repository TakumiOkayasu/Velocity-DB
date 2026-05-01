#pragma once

#include <functional>
#include <span>
#include <string>
#include <string_view>

namespace velocitydb {

struct ResultSet;

/// 複数ステートメント実行結果の 1 件 (multipleResults JSON 用).
///
/// `statement` は呼び出し元文字列への非所有ビュー、`result` は ResultSet への
/// 非所有 const 参照。いずれも `buildMultipleResultsJson` 呼び出し中、
/// 呼び出し元が生存を保証すること。
struct NamedResult {
    std::string_view statement;
    std::reference_wrapper<const ResultSet> result;
};

/// Query 結果を IPC 応答 JSON へ整形する操作層 (`backend/providers/`).
/// SIMD フィルタ実行 / DB 実行 / キャッシュ操作は責務外 (Provider に残す).
/// 純粋寄り (状態なし) なため static メソッド集約.
class QueryResultFormatter {
public:
    QueryResultFormatter() = delete;

    /// `USE <db>` の応答用 ResultSet (1 行 1 列 "Database changed to <db>") を構築.
    /// executeQuery 内 2 箇所 (single / multi-statement) の重複を排除.
    [[nodiscard]] static ResultSet buildUseStatementResult(std::string_view dbName);

    /// 複数ステートメント実行結果を `{"multipleResults":true,"results":[...]}` 形式で整形.
    /// 各要素は `{"statement":<エスケープ済 SQL 1行目>,"data":<serializeResultSet>}`.
    [[nodiscard]] static std::string buildMultipleResultsJson(std::span<const NamedResult> results);

    /// SIMD フィルタ結果 (`matchingIndices`) のみを行として持つ JSON を構築.
    /// `totalRows` / `filteredRows` / `simdAvailable` を含む.
    [[nodiscard]] static std::string buildFilteredResultJson(const ResultSet& result, std::span<const size_t> matchingIndices);
};

}  // namespace velocitydb
