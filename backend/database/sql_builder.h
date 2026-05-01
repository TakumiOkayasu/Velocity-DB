#pragma once

#include "simdjson.h"

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

class ISqlFormattable;

/// DML バッチ入力 (UPDATE/INSERT/DELETE 群)。引数過多回避のため構造体化。
///
/// **ライフタイム制約**:
/// - `schema` / `table` は呼び出し元文字列への非所有ビュー
/// - `updates` / `inserts` / `deletes` は `simdjson::dom::parser` が保持する
///   メモリへの非所有ハンドル
/// `SqlBuilder::buildDml` 呼び出し中、同一 parser が同じ JSON を保持していること。
/// parser を再 parse すると無効化される。
struct DmlInput {
    std::string_view schema;
    std::string_view table;
    std::vector<std::string> pkColumns;
    std::optional<simdjson::dom::array> updates;
    std::optional<simdjson::dom::array> inserts;
    std::optional<simdjson::dom::array> deletes;
};

/// Dialect-aware SQL string builder (操作層).
/// SQL 構築のみ責務を持つ純粋寄りクラス。JSON parsing / IPC 応答整形は Provider の責務。
class SqlBuilder {
public:
    explicit SqlBuilder(const ISqlFormattable& formatter) noexcept;

    SqlBuilder(const SqlBuilder&) = delete;
    SqlBuilder& operator=(const SqlBuilder&) = delete;
    SqlBuilder(SqlBuilder&&) = delete;
    SqlBuilder& operator=(SqlBuilder&&) = delete;

    /// `SELECT * FROM <tableName> [WHERE <whereClause>] LIMIT <limit>` を方言に従い構築。
    /// `tableName` は未 quote 値 (内部で quoteIdentifier する)。
    [[nodiscard]] std::string buildDataView(std::string_view tableName, std::string_view whereClause, int64_t limit) const;

    /// `<col> = <val> [AND <col> = <val> ...]` 形式の WHERE 句本体を構築 (`WHERE` 接頭辞は含まない)。
    /// 各 condition は `{column, value}` の object。null は `IS NULL`、string は quoteLiteral、
    /// 数値/真偽値は素のまま埋め込む (内容が無いため安全)。
    [[nodiscard]] std::string buildWhere(simdjson::dom::array conditions) const;

    /// UPDATE / INSERT / DELETE 文のリストを構築。
    /// `pkColumns` が空でない場合は WHERE 句に PK のみ使用、空なら originalData の全カラムを使用。
    [[nodiscard]] std::vector<std::string> buildDml(const DmlInput& input) const;

private:
    [[nodiscard]] std::string fullyQualifiedTable(std::string_view schema, std::string_view table) const;
    [[nodiscard]] std::string buildUpdateStmt(std::string_view fullTable, const std::vector<std::string>& pkColumns, simdjson::dom::element update) const;
    [[nodiscard]] std::string buildInsertStmt(std::string_view fullTable, simdjson::dom::element insert) const;
    [[nodiscard]] std::string buildDeleteStmt(std::string_view fullTable, const std::vector<std::string>& pkColumns, simdjson::dom::element del) const;

    const ISqlFormattable& m_formatter;
};

}  // namespace velocitydb
