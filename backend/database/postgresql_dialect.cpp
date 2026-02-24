#include "postgresql_dialect.h"

#include "../utils/sql_escape.h"

#include <cstdint>
#include <format>
#include <string>
#include <string_view>

namespace velocitydb {

namespace {

/// PostgreSQL LIKE escaping: %, _ → \%, \_ (with ESCAPE '\')
auto escapeLike(std::string_view input) -> std::string {
    std::string result;
    result.reserve(input.size());
    for (auto ch : input) {
        if (ch == '%' || ch == '_' || ch == '\\') {
            result += '\\';
        }
        result += ch;
    }
    return result;
}

/// Combined: LIKE-escape then SQL-escape for safe embedding
auto escapeSqlLike(std::string_view input) -> std::string {
    return escapeSql(escapeLike(input));
}

}  // namespace

// ---------------------------------------------------------------------------
// ISchemaQueryable
// ---------------------------------------------------------------------------

auto PostgreSqlDialect::getDatabasesQuery() const -> std::string {
    return "SELECT datname AS name "
           "FROM pg_database "
           "WHERE NOT datistemplate "
           "ORDER BY datname";
}

auto PostgreSqlDialect::getTablesQuery() const -> std::string {
    return "SELECT * FROM ("
           "SELECT schemaname AS table_schema, "
           "       tablename  AS table_name, "
           "       'BASE TABLE' AS table_type, "
           "       obj_description((schemaname || '.' || tablename)::regclass) AS comment "
           "FROM pg_tables "
           "WHERE schemaname NOT IN ('pg_catalog', 'information_schema') "
           "UNION ALL "
           "SELECT schemaname AS table_schema, "
           "       viewname   AS table_name, "
           "       'VIEW'     AS table_type, "
           "       obj_description((schemaname || '.' || viewname)::regclass) AS comment "
           "FROM pg_views "
           "WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"
           ") AS combined "
           "ORDER BY table_schema, table_name";
}

// Consumer expects: [0]=name, [1]=type, [2]=size, [3]=is_nullable(1/0), [4]=is_pk(1/0), [5]=comment
auto PostgreSqlDialect::getColumnsQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT c.column_name, "
                       "       c.data_type, "
                       "       COALESCE(c.character_maximum_length, c.numeric_precision, 0) AS col_size, "
                       "       CASE WHEN c.is_nullable = 'YES' THEN 1 ELSE 0 END AS is_nullable, "
                       "       CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key, "
                       "       COALESCE(col_description((c.table_schema || '.' || c.table_name)::regclass, "
                       "                                c.ordinal_position), '') AS comment "
                       "FROM information_schema.columns c "
                       "LEFT JOIN ("
                       "    SELECT kcu.column_name, kcu.table_schema, kcu.table_name "
                       "    FROM information_schema.table_constraints tc "
                       "    JOIN information_schema.key_column_usage kcu "
                       "      ON tc.constraint_name = kcu.constraint_name "
                       "     AND tc.table_schema = kcu.table_schema "
                       "    WHERE tc.constraint_type = 'PRIMARY KEY' "
                       "      AND tc.table_schema = '{}' "
                       "      AND tc.table_name = '{}'"
                       ") pk ON c.column_name = pk.column_name "
                       "    AND c.table_schema = pk.table_schema "
                       "    AND c.table_name = pk.table_name "
                       "WHERE c.table_schema = '{}' "
                       "  AND c.table_name = '{}' "
                       "ORDER BY c.ordinal_position",
                       s, t, s, t);
}

// Consumer expects: [0]=schema, [1]=name, [2]=type, [3]=rowCount, [4]=createdAt, [5]=modifiedAt, [6]=owner, [7]=comment
auto PostgreSqlDialect::getTableMetadataQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT nsp.nspname AS schema_name, "
                       "       cls.relname AS table_name, "
                       "       CASE cls.relkind "
                       "           WHEN 'r' THEN 'BASE TABLE' "
                       "           WHEN 'v' THEN 'VIEW' "
                       "           WHEN 'm' THEN 'MATERIALIZED VIEW' "
                       "           WHEN 'p' THEN 'PARTITIONED TABLE' "
                       "           ELSE cls.relkind::text "
                       "       END AS object_type, "
                       "       COALESCE(stat.n_live_tup, 0) AS row_count, "
                       "       '' AS created_at, "
                       "       '' AS modified_at, "
                       "       pg_get_userbyid(cls.relowner) AS owner, "
                       "       COALESCE(obj_description(cls.oid), '') AS comment "
                       "FROM pg_class cls "
                       "JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace "
                       "LEFT JOIN pg_stat_user_tables stat ON stat.relid = cls.oid "
                       "WHERE nsp.nspname = '{}' "
                       "  AND cls.relname = '{}'",
                       s, t);
}

// ---------------------------------------------------------------------------
// IRelationQueryable
// ---------------------------------------------------------------------------

// Consumer expects: [0]=name, [1]=type, [2]=isUnique(1/0), [3]=isPrimary(1/0), [4]=columns(CSV)
auto PostgreSqlDialect::getIndexesQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT ic.relname AS index_name, "
                       "       am.amname AS index_type, "
                       "       CASE WHEN ix.indisunique THEN 1 ELSE 0 END AS is_unique, "
                       "       CASE WHEN ix.indisprimary THEN 1 ELSE 0 END AS is_primary, "
                       "       string_agg(att.attname, ',' ORDER BY k.ord) AS columns "
                       "FROM pg_index ix "
                       "JOIN pg_class tc ON tc.oid = ix.indrelid "
                       "JOIN pg_class ic ON ic.oid = ix.indexrelid "
                       "JOIN pg_namespace nsp ON nsp.oid = tc.relnamespace "
                       "JOIN pg_am am ON am.oid = ic.relam "
                       "JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE "
                       "JOIN pg_attribute att ON att.attrelid = tc.oid AND att.attnum = k.attnum "
                       "WHERE nsp.nspname = '{}' "
                       "  AND tc.relname = '{}' "
                       "GROUP BY ic.relname, am.amname, ix.indisunique, ix.indisprimary "
                       "ORDER BY ix.indisprimary DESC, ic.relname",
                       s, t);
}

// Consumer expects: [0]=name, [1]=type, [2]=columns(CSV), [3]=definition
auto PostgreSqlDialect::getConstraintsQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT con.conname AS constraint_name, "
                       "       CASE con.contype "
                       "           WHEN 'p' THEN 'PRIMARY KEY' "
                       "           WHEN 'u' THEN 'UNIQUE' "
                       "           WHEN 'f' THEN 'FOREIGN KEY' "
                       "           WHEN 'c' THEN 'CHECK' "
                       "           WHEN 'x' THEN 'EXCLUSION' "
                       "           ELSE con.contype::text "
                       "       END AS constraint_type, "
                       "       COALESCE(string_agg(att.attname, ',' ORDER BY k.ord), '') AS columns, "
                       "       pg_get_constraintdef(con.oid) AS definition "
                       "FROM pg_constraint con "
                       "JOIN pg_class cls ON cls.oid = con.conrelid "
                       "JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace "
                       "LEFT JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE "
                       "LEFT JOIN pg_attribute att ON att.attrelid = cls.oid AND att.attnum = k.attnum "
                       "WHERE nsp.nspname = '{}' "
                       "  AND cls.relname = '{}' "
                       "GROUP BY con.conname, con.contype, con.oid "
                       "ORDER BY con.contype, con.conname",
                       s, t);
}

// Consumer expects: [0]=name, [1]=columns(CSV), [2]=referencedTable, [3]=referencedColumns(CSV), [4]=onDelete, [5]=onUpdate
auto PostgreSqlDialect::getForeignKeysQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT con.conname AS fk_name, "
                       "       string_agg(att.attname, ',' ORDER BY ck.ord) AS columns, "
                       "       ref_nsp.nspname || '.' || ref_cls.relname AS referenced_table, "
                       "       string_agg(ref_att.attname, ',' ORDER BY ck.ord) AS referenced_columns, "
                       "       CASE con.confdeltype "
                       "           WHEN 'a' THEN 'NO_ACTION' WHEN 'r' THEN 'RESTRICT' "
                       "           WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET_NULL' "
                       "           WHEN 'd' THEN 'SET_DEFAULT' ELSE 'NO_ACTION' "
                       "       END AS on_delete, "
                       "       CASE con.confupdtype "
                       "           WHEN 'a' THEN 'NO_ACTION' WHEN 'r' THEN 'RESTRICT' "
                       "           WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET_NULL' "
                       "           WHEN 'd' THEN 'SET_DEFAULT' ELSE 'NO_ACTION' "
                       "       END AS on_update "
                       "FROM pg_constraint con "
                       "JOIN pg_class cls ON cls.oid = con.conrelid "
                       "JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace "
                       "JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid "
                       "JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref_cls.relnamespace "
                       "JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(num, ord) ON TRUE "
                       "JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ck.num "
                       "JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(num, ord) ON fk.ord = ck.ord "
                       "JOIN pg_attribute ref_att ON ref_att.attrelid = con.confrelid AND ref_att.attnum = fk.num "
                       "WHERE con.contype = 'f' "
                       "  AND nsp.nspname = '{}' "
                       "  AND cls.relname = '{}' "
                       "GROUP BY con.conname, ref_nsp.nspname, ref_cls.relname, con.confdeltype, con.confupdtype "
                       "ORDER BY con.conname",
                       s, t);
}

// Consumer expects: [0]=name, [1]=referencingTable, [2]=referencingColumns(CSV), [3]=columns(CSV), [4]=onDelete, [5]=onUpdate
auto PostgreSqlDialect::getReferencingForeignKeysQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT con.conname AS fk_name, "
                       "       src_nsp.nspname || '.' || src_cls.relname AS referencing_table, "
                       "       string_agg(att.attname, ',' ORDER BY ck.ord) AS referencing_columns, "
                       "       string_agg(ref_att.attname, ',' ORDER BY ck.ord) AS columns, "
                       "       CASE con.confdeltype "
                       "           WHEN 'a' THEN 'NO_ACTION' WHEN 'r' THEN 'RESTRICT' "
                       "           WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET_NULL' "
                       "           WHEN 'd' THEN 'SET_DEFAULT' ELSE 'NO_ACTION' "
                       "       END AS on_delete, "
                       "       CASE con.confupdtype "
                       "           WHEN 'a' THEN 'NO_ACTION' WHEN 'r' THEN 'RESTRICT' "
                       "           WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET_NULL' "
                       "           WHEN 'd' THEN 'SET_DEFAULT' ELSE 'NO_ACTION' "
                       "       END AS on_update "
                       "FROM pg_constraint con "
                       "JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid "
                       "JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref_cls.relnamespace "
                       "JOIN pg_class src_cls ON src_cls.oid = con.conrelid "
                       "JOIN pg_namespace src_nsp ON src_nsp.oid = src_cls.relnamespace "
                       "JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(num, ord) ON TRUE "
                       "JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ck.num "
                       "JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(num, ord) ON fk.ord = ck.ord "
                       "JOIN pg_attribute ref_att ON ref_att.attrelid = con.confrelid AND ref_att.attnum = fk.num "
                       "WHERE con.contype = 'f' "
                       "  AND ref_nsp.nspname = '{}' "
                       "  AND ref_cls.relname = '{}' "
                       "GROUP BY con.conname, src_nsp.nspname, src_cls.relname, con.confdeltype, con.confupdtype "
                       "ORDER BY con.conname",
                       s, t);
}

// Consumer expects: [0]=name, [1]=type, [2]=events(CSV), [3]=isEnabled(1/0), [4]=definition
auto PostgreSqlDialect::getTriggersQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT trg.tgname AS trigger_name, "
                       "       CASE WHEN trg.tgtype & 64 <> 0 THEN 'INSTEAD OF' WHEN trg.tgtype & 2 <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS trigger_type,"
                       "       array_to_string(ARRAY["
                       "           CASE WHEN trg.tgtype & 4  <> 0 THEN 'INSERT' END, "
                       "           CASE WHEN trg.tgtype & 8  <> 0 THEN 'DELETE' END, "
                       "           CASE WHEN trg.tgtype & 16 <> 0 THEN 'UPDATE' END "
                       "       ], ',') AS events, "
                       "       CASE WHEN trg.tgenabled = 'D' THEN 0 ELSE 1 END AS is_enabled, "
                       "       pg_get_triggerdef(trg.oid) AS definition "
                       "FROM pg_trigger trg "
                       "JOIN pg_class cls ON cls.oid = trg.tgrelid "
                       "JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace "
                       "WHERE NOT trg.tgisinternal "
                       "  AND nsp.nspname = '{}' "
                       "  AND cls.relname = '{}' "
                       "ORDER BY trg.tgname",
                       s, t);
}

// ---------------------------------------------------------------------------
// IDDLQueryable
// ---------------------------------------------------------------------------

auto PostgreSqlDialect::getDDLColumnsQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT c.column_name, "
                       "       c.data_type, "
                       "       c.character_maximum_length::text, "
                       "       c.numeric_precision::text, "
                       "       c.numeric_scale::text, "
                       "       c.is_nullable, "
                       "       c.column_default "
                       "FROM information_schema.columns c "
                       "WHERE c.table_schema = '{}' "
                       "  AND c.table_name = '{}' "
                       "ORDER BY c.ordinal_position",
                       s, t);
}

// Consumer expects: [0]=column_name (only)
auto PostgreSqlDialect::getDDLPrimaryKeyQuery(std::string_view schema, std::string_view table) const -> std::string {
    auto s = escapeSql(schema);
    auto t = escapeSql(table);
    return std::format("SELECT att.attname AS column_name "
                       "FROM pg_constraint con "
                       "JOIN pg_class cls ON cls.oid = con.conrelid "
                       "JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace "
                       "JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(num, ord) ON TRUE "
                       "JOIN pg_attribute att ON att.attrelid = cls.oid AND att.attnum = ck.num "
                       "WHERE con.contype = 'p' "
                       "  AND nsp.nspname = '{}' "
                       "  AND cls.relname = '{}' "
                       "ORDER BY ck.ord",
                       s, t);
}

auto PostgreSqlDialect::getExecutionPlanQuery(std::string_view sql, bool actual) const -> std::string {
    // String concatenation instead of std::format to avoid format_error on SQL containing { or }
    if (actual) {
        return std::string("EXPLAIN ANALYZE ").append(sql);
    }
    return std::string("EXPLAIN ").append(sql);
}

// ---------------------------------------------------------------------------
// ISqlFormattable
// ---------------------------------------------------------------------------

auto PostgreSqlDialect::quoteIdentifier(std::string_view id) const -> std::string {
    if (id.empty())
        return {};
    std::string result;
    std::string_view remaining = id;

    while (!remaining.empty()) {
        auto dot = remaining.find('.');
        auto part = remaining.substr(0, dot);

        if (!result.empty()) {
            result += '.';
        }

        result += '"';
        for (auto ch : part) {
            if (ch == '"') {
                result += "\"\"";
            } else {
                result += ch;
            }
        }
        result += '"';

        if (dot == std::string_view::npos) {
            break;
        }
        remaining = remaining.substr(dot + 1);
    }

    return result;
}

auto PostgreSqlDialect::defaultSchema() const noexcept -> std::string_view {
    return "public";
}

auto PostgreSqlDialect::paginateQuery(std::string_view sql, int64_t offset, int64_t limit) const -> std::string {
    // String concatenation to avoid std::format_error on SQL containing { or }
    return std::string(sql).append(std::format(" LIMIT {} OFFSET {}", limit, offset));
}

auto PostgreSqlDialect::rowCountQuery(std::string_view sql) const -> std::string {
    // String concatenation to avoid std::format_error on SQL containing { or }
    return std::string("SELECT COUNT(*) AS total_rows FROM (").append(sql).append(") AS subquery");
}

// ---------------------------------------------------------------------------
// IObjectSearchable
// ---------------------------------------------------------------------------

auto PostgreSqlDialect::searchObjectsQuery(std::string_view pattern, bool caseSensitive, int maxResults, uint8_t categories) const -> std::string {
    auto p = escapeSqlLike(pattern);
    auto like_op = caseSensitive ? "LIKE" : "ILIKE";
    // Assumes standard_conforming_strings = on (PostgreSQL 9.1+ default)
    auto esc = "ESCAPE '\\'";
    auto excluded = "table_schema NOT IN ('pg_catalog', 'information_schema')";

    std::string unions;
    auto appendUnion = [&](std::string_view fragment) {
        if (!unions.empty())
            unions += " UNION ALL ";
        unions += fragment;
    };

    if (categories & SearchCategory::Tables) {
        appendUnion(std::format("SELECT 'BASE TABLE' AS object_type, table_schema AS schema_name, table_name AS object_name, '' AS parent_name "
                                "FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_name {} '%{}%' {} AND {}",
                                like_op, p, esc, excluded));
    }
    if (categories & SearchCategory::Views) {
        appendUnion(std::format("SELECT 'VIEW' AS object_type, table_schema AS schema_name, table_name AS object_name, '' AS parent_name "
                                "FROM information_schema.tables WHERE table_type = 'VIEW' AND table_name {} '%{}%' {} AND {}",
                                like_op, p, esc, excluded));
    }
    if (categories & SearchCategory::Procedures) {
        appendUnion(std::format("SELECT 'PROCEDURE' AS object_type, routine_schema AS schema_name, routine_name AS object_name, '' AS parent_name "
                                "FROM information_schema.routines WHERE routine_type = 'PROCEDURE' AND routine_name {} '%{}%' {} "
                                "AND routine_schema NOT IN ('pg_catalog', 'information_schema')",
                                like_op, p, esc));
    }
    if (categories & SearchCategory::Functions) {
        appendUnion(std::format("SELECT 'FUNCTION' AS object_type, routine_schema AS schema_name, routine_name AS object_name, '' AS parent_name "
                                "FROM information_schema.routines WHERE routine_type = 'FUNCTION' AND routine_name {} '%{}%' {} "
                                "AND routine_schema NOT IN ('pg_catalog', 'information_schema')",
                                like_op, p, esc));
    }
    if (categories & SearchCategory::Columns) {
        appendUnion(std::format("SELECT 'COLUMN' AS object_type, table_schema AS schema_name, column_name AS object_name, table_name AS parent_name "
                                "FROM information_schema.columns WHERE column_name {} '%{}%' {} AND {}",
                                like_op, p, esc, excluded));
    }
    if (categories & SearchCategory::Indexes) {
        appendUnion(std::format("SELECT 'INDEX' AS object_type, schemaname AS schema_name, indexname AS object_name, tablename AS parent_name "
                                "FROM pg_indexes WHERE indexname {} '%{}%' {} AND schemaname NOT IN ('pg_catalog', 'information_schema')",
                                like_op, p, esc));
    }

    if (unions.empty())
        return "SELECT NULL AS object_type, NULL AS schema_name, NULL AS object_name, NULL AS parent_name WHERE false";

    return std::format("SELECT * FROM ({}) AS search_results ORDER BY schema_name, object_name LIMIT {}", unions, std::clamp(maxResults, 1, 1000));
}

auto PostgreSqlDialect::quickSearchQuery(std::string_view prefix, int limit) const -> std::string {
    auto p = escapeSqlLike(prefix);
    auto excluded = "table_schema NOT IN ('pg_catalog', 'information_schema')";

    return std::format("SELECT name FROM ("
                       "SELECT table_name AS name "
                       "FROM information_schema.tables "
                       "WHERE table_name ILIKE '{}%' ESCAPE '\\' AND {} "
                       "UNION "
                       "SELECT column_name "
                       "FROM information_schema.columns "
                       "WHERE column_name ILIKE '{}%' ESCAPE '\\' AND {}"
                       ") AS combined "
                       "ORDER BY name "
                       "LIMIT {}",
                       p, excluded, p, excluded, std::clamp(limit, 1, 100));
}

}  // namespace velocitydb
