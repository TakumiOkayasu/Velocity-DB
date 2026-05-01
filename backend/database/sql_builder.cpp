#include "sql_builder.h"

#include "../interfaces/sql_formattable.h"

namespace velocitydb {

namespace {

/// SET / VALUES で共通の右辺リテラル化。
/// null → "NULL" / string → quoteLiteral / 他 → minify した値を quoteLiteral で包む。
void appendValueLiteral(std::string& out, const ISqlFormattable& fmt, simdjson::dom::element value) {
    if (value.is_null()) {
        out += "NULL";
        return;
    }
    if (auto v = value.get_string(); !v.error()) {
        out += fmt.quoteLiteral(v.value());
        return;
    }
    out += fmt.quoteLiteral(simdjson::minify(value));
}

/// 等値比較 `<col> = <literal>` を whereOut に追記 (null は `IS NULL`)。
/// 既に節がある場合は ` AND ` を前置。値ソースは Lookup 経由で抽象化 (UPDATE / DELETE 共通)。
template <typename Lookup>
void appendEqualityFromLookup(std::string& whereOut, const ISqlFormattable& fmt, std::string_view colName, Lookup&& lookup) {
    if (!whereOut.empty())
        whereOut += " AND ";
    auto col = fmt.quoteIdentifier(colName);
    auto val = lookup(colName);
    if (val.error() || val.value().is_null()) {
        whereOut += col + " IS NULL";
        return;
    }
    if (auto v = val.value().get_string(); !v.error()) {
        whereOut += col + " = " + fmt.quoteLiteral(v.value());
        return;
    }
    whereOut += col + " = " + fmt.quoteLiteral(simdjson::minify(val.value()));
}

}  // namespace

SqlBuilder::SqlBuilder(const ISqlFormattable& formatter) noexcept : m_formatter(formatter) {}

std::string SqlBuilder::fullyQualifiedTable(std::string_view schema, std::string_view table) const {
    if (schema.empty())
        return m_formatter.quoteIdentifier(table);
    return m_formatter.quoteIdentifier(schema) + "." + m_formatter.quoteIdentifier(table);
}

std::string SqlBuilder::buildDataView(std::string_view tableName, std::string_view whereClause, int64_t limit) const {
    auto quotedTable = m_formatter.quoteIdentifier(tableName);
    if (!whereClause.empty())
        return m_formatter.buildSelectAllWhere(quotedTable, whereClause, limit);
    return m_formatter.buildSelectAll(quotedTable, limit);
}

std::string SqlBuilder::buildWhere(simdjson::dom::array conditions) const {
    // NOTE: 数値/真偽値は非 quote 埋め込み (`= 42`)。UPDATE/DELETE 用の
    //       appendEqualityFromLookup (常に quoteLiteral) とは敢えて挙動を分けている
    //       (元実装互換)。統一する場合は IPC スキーマと frontend 側
    //       (api/bridge.ts: buildWhereClause 呼び出し元) の確認が必要。
    std::string whereClause;
    for (auto condition : conditions) {
        auto columnResult = condition["column"].get_string();
        if (columnResult.error())
            continue;

        if (!whereClause.empty())
            whereClause += " AND ";

        auto quotedCol = m_formatter.quoteIdentifier(columnResult.value());

        auto valueEl = condition["value"];
        if (valueEl.error() || valueEl.is_null()) {
            whereClause += quotedCol + " IS NULL";
        } else if (auto v = valueEl.get_string(); !v.error()) {
            whereClause += quotedCol + " = " + m_formatter.quoteLiteral(v.value());
        } else if (!valueEl.get_int64().error() || !valueEl.get_uint64().error() || !valueEl.get_double().error() || !valueEl.get_bool().error()) {
            // 数値/真偽値は文字列内容を持たないので素の値で埋め込み可
            whereClause += quotedCol + " = " + simdjson::minify(valueEl.value());
        } else {
            // 不明型: 安全側に倒して quoteLiteral
            whereClause += quotedCol + " = " + m_formatter.quoteLiteral(simdjson::minify(valueEl.value()));
        }
    }
    return whereClause;
}

std::string SqlBuilder::buildUpdateStmt(std::string_view fullTable, const std::vector<std::string>& pkColumns, simdjson::dom::element update) const {
    auto changesObj = update["changes"].get_object();
    if (changesObj.error())
        return {};

    std::string setClauses;
    for (auto field : changesObj.value()) {
        if (!setClauses.empty())
            setClauses += ", ";
        setClauses += m_formatter.quoteIdentifier(field.key) + " = ";
        appendValueLiteral(setClauses, m_formatter, field.value);
    }
    if (setClauses.empty())
        return {};

    auto originalObj = update["originalData"].get_object();
    if (originalObj.error())
        return {};  // 元値が無いと WHERE を組めない (元実装も whereClauses 空のまま skip)

    auto lookup = [&](std::string_view col) { return originalObj.value()[col]; };

    std::string whereClauses;
    if (!pkColumns.empty()) {
        for (const auto& pk : pkColumns)
            appendEqualityFromLookup(whereClauses, m_formatter, pk, lookup);
    } else {
        for (auto field : originalObj.value())
            appendEqualityFromLookup(whereClauses, m_formatter, field.key, lookup);
    }
    if (whereClauses.empty())
        return {};

    return std::string("UPDATE ").append(fullTable).append(" SET ").append(setClauses).append(" WHERE ").append(whereClauses).append(";");
}

std::string SqlBuilder::buildInsertStmt(std::string_view fullTable, simdjson::dom::element insert) const {
    auto obj = insert.get_object();
    if (obj.error())
        return {};

    std::string columns, values;
    for (auto field : obj.value()) {
        if (!columns.empty()) {
            columns += ", ";
            values += ", ";
        }
        columns += m_formatter.quoteIdentifier(field.key);
        appendValueLiteral(values, m_formatter, field.value);
    }
    if (columns.empty())
        return {};

    return std::string("INSERT INTO ").append(fullTable).append(" (").append(columns).append(") VALUES (").append(values).append(");");
}

std::string SqlBuilder::buildDeleteStmt(std::string_view fullTable, const std::vector<std::string>& pkColumns, simdjson::dom::element del) const {
    auto obj = del.get_object();
    if (obj.error())
        return {};

    auto lookup = [&](std::string_view col) { return obj.value()[col]; };

    std::string whereClauses;
    if (!pkColumns.empty()) {
        for (const auto& pk : pkColumns)
            appendEqualityFromLookup(whereClauses, m_formatter, pk, lookup);
    } else {
        for (auto field : obj.value())
            appendEqualityFromLookup(whereClauses, m_formatter, field.key, lookup);
    }
    if (whereClauses.empty())
        return {};

    return std::string("DELETE FROM ").append(fullTable).append(" WHERE ").append(whereClauses).append(";");
}

std::vector<std::string> SqlBuilder::buildDml(const DmlInput& input) const {
    auto fullTable = fullyQualifiedTable(input.schema, input.table);
    std::vector<std::string> statements;

    auto pushIf = [&](std::string&& s) {
        if (!s.empty())
            statements.emplace_back(std::move(s));
    };

    if (input.updates) {
        for (auto u : *input.updates)
            pushIf(buildUpdateStmt(fullTable, input.pkColumns, u));
    }
    if (input.inserts) {
        for (auto i : *input.inserts)
            pushIf(buildInsertStmt(fullTable, i));
    }
    if (input.deletes) {
        for (auto d : *input.deletes)
            pushIf(buildDeleteStmt(fullTable, input.pkColumns, d));
    }

    return statements;
}

}  // namespace velocitydb
