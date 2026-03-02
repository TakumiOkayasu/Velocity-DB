#include "sqlserver_dialect.h"

#include "../utils/sql_escape.h"

#include <cstdint>
#include <format>
#include <ranges>
#include <string>
#include <string_view>

namespace velocitydb {

namespace {

/// SQL LIKE pattern escaping: %, _, [ are bracket-escaped
[[nodiscard]] std::string escapeLike(std::string_view value) {
    std::string result;
    result.reserve(value.size());
    for (char c : value) {
        switch (c) {
            case '%':
                result += "[%]";
                break;
            case '_':
                result += "[_]";
                break;
            case '[':
                result += "[[]";
                break;
            default:
                result += c;
                break;
        }
    }
    return result;
}

/// Combined: LIKE-escape then SQL-escape for safe embedding in SQL string literals
[[nodiscard]] std::string escapeSqlLike(std::string_view value) {
    return escapeSql(escapeLike(value));
}

/// Build schema.table qualified name for OBJECT_ID()
[[nodiscard]] std::string qualifiedName(std::string_view schema, std::string_view table) {
    return std::format("{}.{}", escapeSql(schema), escapeSql(table));
}

}  // namespace

// ---------------------------------------------------------------------------
// ISchemaQueryable
// ---------------------------------------------------------------------------

std::string SqlServerDialect::getDatabasesQuery() const {
    return "SELECT name FROM sys.databases ORDER BY name";
}

std::string SqlServerDialect::getTablesQuery() const {
    return R"(
            SELECT
                t.TABLE_SCHEMA,
                t.TABLE_NAME,
                t.TABLE_TYPE,
                CAST(ep.value AS NVARCHAR(MAX)) AS comment
            FROM INFORMATION_SCHEMA.TABLES t
            LEFT JOIN sys.extended_properties ep ON ep.major_id = OBJECT_ID(t.TABLE_SCHEMA + '.' + t.TABLE_NAME)
                AND ep.minor_id = 0
                AND ep.class = 1
                AND ep.name = 'MS_Description'
            WHERE t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
            ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
        )";
}

std::string SqlServerDialect::getColumnsQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT
                c.name AS column_name,
                t.name AS data_type,
                c.max_length,
                c.is_nullable,
                CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
                CAST(ep.value AS NVARCHAR(MAX)) AS comment
            FROM sys.columns c
            INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
            INNER JOIN sys.objects o ON c.object_id = o.object_id
            INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
            LEFT JOIN (
                SELECT ic.object_id, ic.column_id
                FROM sys.index_columns ic
                INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                WHERE i.is_primary_key = 1
            ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
            LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id
                AND ep.minor_id = c.column_id
                AND ep.class = 1
                AND ep.name = 'MS_Description'
            WHERE o.name = '{}' AND s.name = '{}'
            ORDER BY c.column_id
        )",
                       escapeSql(table), escapeSql(schema));
}

std::string SqlServerDialect::getTableMetadataQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT
                OBJECT_SCHEMA_NAME(o.object_id) AS SchemaName,
                o.name AS TableName,
                o.type_desc AS ObjectType,
                ISNULL(p.rows, 0) AS RowCount,
                CONVERT(varchar, o.create_date, 120) AS CreatedAt,
                CONVERT(varchar, o.modify_date, 120) AS ModifiedAt,
                ISNULL(USER_NAME(o.principal_id), 'dbo') AS Owner,
                ISNULL(ep.value, '') AS Comment
            FROM sys.objects o
            LEFT JOIN sys.partitions p ON o.object_id = p.object_id AND p.index_id IN (0, 1)
            LEFT JOIN sys.extended_properties ep ON ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
            WHERE o.object_id = OBJECT_ID('{}')
        )",
                       qualifiedName(schema, table));
}

// ---------------------------------------------------------------------------
// IRelationQueryable
// ---------------------------------------------------------------------------

std::string SqlServerDialect::getIndexesQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT
                i.name AS IndexName,
                i.type_desc AS IndexType,
                i.is_unique AS IsUnique,
                i.is_primary_key AS IsPrimaryKey,
                STUFF((
                    SELECT ',' + c.name
                    FROM sys.index_columns ic
                    JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                    WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                    ORDER BY ic.key_ordinal
                    FOR XML PATH('')
                ), 1, 1, '') AS Columns
            FROM sys.indexes i
            WHERE i.object_id = OBJECT_ID('{}')
              AND i.name IS NOT NULL
            ORDER BY i.is_primary_key DESC, i.name
        )",
                       qualifiedName(schema, table));
}

std::string SqlServerDialect::getConstraintsQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT
                tc.CONSTRAINT_NAME,
                tc.CONSTRAINT_TYPE,
                STUFF((
                    SELECT ',' + kcu.COLUMN_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    WHERE kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                      AND kcu.TABLE_NAME = tc.TABLE_NAME
                    ORDER BY kcu.ORDINAL_POSITION
                    FOR XML PATH('')
                ), 1, 1, '') AS Columns,
                ISNULL(cc.CHECK_CLAUSE, dc.definition) AS Definition
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            LEFT JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
                ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
            LEFT JOIN sys.default_constraints dc
                ON dc.name = tc.CONSTRAINT_NAME
            WHERE tc.TABLE_NAME = '{}' AND tc.TABLE_SCHEMA = '{}'
            ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME
        )",
                       escapeSql(table), escapeSql(schema));
}

std::string SqlServerDialect::getForeignKeysQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT
                fk.name AS FKName,
                STUFF((
                    SELECT ',' + COL_NAME(fkc.parent_object_id, fkc.parent_column_id)
                    FROM sys.foreign_key_columns fkc
                    WHERE fkc.constraint_object_id = fk.object_id
                    ORDER BY fkc.constraint_column_id
                    FOR XML PATH('')
                ), 1, 1, '') AS Columns,
                OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable,
                STUFF((
                    SELECT ',' + COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id)
                    FROM sys.foreign_key_columns fkc
                    WHERE fkc.constraint_object_id = fk.object_id
                    ORDER BY fkc.constraint_column_id
                    FOR XML PATH('')
                ), 1, 1, '') AS ReferencedColumns,
                fk.delete_referential_action_desc AS OnDelete,
                fk.update_referential_action_desc AS OnUpdate
            FROM sys.foreign_keys fk
            WHERE fk.parent_object_id = OBJECT_ID('{}')
            ORDER BY fk.name
        )",
                       qualifiedName(schema, table));
}

std::string SqlServerDialect::getReferencingForeignKeysQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT
                fk.name AS FKName,
                OBJECT_SCHEMA_NAME(fk.parent_object_id) + '.' + OBJECT_NAME(fk.parent_object_id) AS ReferencingTable,
                STUFF((
                    SELECT ',' + COL_NAME(fkc.parent_object_id, fkc.parent_column_id)
                    FROM sys.foreign_key_columns fkc
                    WHERE fkc.constraint_object_id = fk.object_id
                    ORDER BY fkc.constraint_column_id
                    FOR XML PATH('')
                ), 1, 1, '') AS ReferencingColumns,
                STUFF((
                    SELECT ',' + COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id)
                    FROM sys.foreign_key_columns fkc
                    WHERE fkc.constraint_object_id = fk.object_id
                    ORDER BY fkc.constraint_column_id
                    FOR XML PATH('')
                ), 1, 1, '') AS Columns,
                fk.delete_referential_action_desc AS OnDelete,
                fk.update_referential_action_desc AS OnUpdate
            FROM sys.foreign_keys fk
            WHERE fk.referenced_object_id = OBJECT_ID('{}')
            ORDER BY fk.name
        )",
                       qualifiedName(schema, table));
}

std::string SqlServerDialect::getTriggersQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT
                t.name AS TriggerName,
                CASE WHEN t.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END AS TriggerType,
                STUFF((
                    SELECT ',' + CASE te.type WHEN 1 THEN 'INSERT' WHEN 2 THEN 'UPDATE' WHEN 3 THEN 'DELETE' END
                    FROM sys.trigger_events te
                    WHERE te.object_id = t.object_id
                    FOR XML PATH('')
                ), 1, 1, '') AS Events,
                CASE WHEN t.is_disabled = 0 THEN 1 ELSE 0 END AS IsEnabled,
                OBJECT_DEFINITION(t.object_id) AS Definition
            FROM sys.triggers t
            WHERE t.parent_id = OBJECT_ID('{}')
            ORDER BY t.name
        )",
                       qualifiedName(schema, table));
}

// ---------------------------------------------------------------------------
// IDDLQueryable
// ---------------------------------------------------------------------------

std::string SqlServerDialect::getDDLColumnsQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_PRECISION,
                c.NUMERIC_SCALE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = '{}' AND c.TABLE_SCHEMA = '{}'
            ORDER BY c.ORDINAL_POSITION
        )",
                       escapeSql(table), escapeSql(schema));
}

std::string SqlServerDialect::getDDLPrimaryKeyQuery(std::string_view schema, std::string_view table) const {
    return std::format(R"(
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_NAME = '{}' AND TABLE_SCHEMA = '{}'
              AND CONSTRAINT_NAME = (
                  SELECT CONSTRAINT_NAME
                  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
                  WHERE TABLE_NAME = '{}' AND TABLE_SCHEMA = '{}' AND CONSTRAINT_TYPE = 'PRIMARY KEY'
              )
            ORDER BY ORDINAL_POSITION
        )",
                       escapeSql(table), escapeSql(schema), escapeSql(table), escapeSql(schema));
}

std::string SqlServerDialect::getExecutionPlanQuery(std::string_view sql, bool actual) const {
    // String concatenation instead of std::format to avoid format_error on SQL containing { or }
    if (actual) {
        return std::string("SET STATISTICS XML ON;\n").append(sql).append("\nSET STATISTICS XML OFF;");
    }
    return std::string("SET SHOWPLAN_TEXT ON;\n").append(sql).append("\nSET SHOWPLAN_TEXT OFF;");
}

// ---------------------------------------------------------------------------
// ISqlFormattable
// ---------------------------------------------------------------------------

std::string SqlServerDialect::quoteIdentifier(std::string_view id) const {
    if (id.empty())
        return {};
    std::string result;
    result.reserve(id.size() + 4);
    bool first = true;
    for (auto part : id | std::views::split('.')) {
        if (!first)
            result += '.';
        first = false;
        result += '[';
        for (char c : std::string_view{part.begin(), part.end()}) {
            if (c == ']')
                result += "]]";
            else
                result += c;
        }
        result += ']';
    }
    return result;
}

std::string SqlServerDialect::quoteLiteral(std::string_view value) const {
    return std::string("N'").append(escapeSql(value)).append("'");
}

std::string SqlServerDialect::buildSelectAll(std::string_view quotedTable, int64_t limit) const {
    return std::format("SELECT TOP {} * FROM ", limit).append(quotedTable);
}

std::string SqlServerDialect::buildSelectAllWhere(std::string_view quotedTable, std::string_view whereClause, int64_t limit) const {
    return std::format("SELECT TOP {} * FROM ", limit).append(quotedTable).append(" WHERE ").append(whereClause);
}

std::string_view SqlServerDialect::defaultSchema() const noexcept {
    return "dbo";
}

std::string SqlServerDialect::paginateQuery(std::string_view sql, int64_t offset, int64_t limit) const {
    // Quote-aware ORDER BY detection to avoid false positives on string literals
    return std::string(sql).append(hasOrderByOutsideQuotes(sql) ? "" : " ORDER BY (SELECT NULL)").append(std::format(" OFFSET {} ROWS FETCH NEXT {} ROWS ONLY", offset, limit));
}

std::string SqlServerDialect::rowCountQuery(std::string_view sql) const {
    // String concatenation to avoid std::format_error on SQL containing { or }
    return std::string("SELECT COUNT_BIG(*) AS total_rows FROM (").append(sql).append(") AS subquery WITH(NOLOCK)");
}

// ---------------------------------------------------------------------------
// IObjectSearchable
// ---------------------------------------------------------------------------

std::string SqlServerDialect::searchObjectsQuery(std::string_view pattern, bool caseSensitive, int maxResults, uint8_t categories) const {
    auto likePattern = "%" + escapeSqlLike(pattern) + "%";
    auto collate = caseSensitive ? " COLLATE Latin1_General_CS_AS" : "";

    std::string unions;
    auto appendUnion = [&](std::string_view fragment) {
        if (!unions.empty())
            unions += " UNION ALL ";
        unions += fragment;
    };

    if (categories & SearchCategory::Tables) {
        appendUnion(std::format("SELECT 'TABLE' as object_type, TABLE_SCHEMA as schema_name, TABLE_NAME as object_name, '' as parent_name "
                                "FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME{} LIKE '{}'",
                                collate, likePattern));
    }
    if (categories & SearchCategory::Views) {
        appendUnion(std::format("SELECT 'VIEW' as object_type, TABLE_SCHEMA as schema_name, TABLE_NAME as object_name, '' as parent_name "
                                "FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_NAME{} LIKE '{}'",
                                collate, likePattern));
    }
    if (categories & SearchCategory::Procedures) {
        appendUnion(std::format("SELECT 'PROCEDURE' as object_type, ROUTINE_SCHEMA as schema_name, ROUTINE_NAME as object_name, '' as parent_name "
                                "FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_NAME{} LIKE '{}'",
                                collate, likePattern));
    }
    if (categories & SearchCategory::Functions) {
        appendUnion(std::format("SELECT 'FUNCTION' as object_type, ROUTINE_SCHEMA as schema_name, ROUTINE_NAME as object_name, '' as parent_name "
                                "FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE = 'FUNCTION' AND ROUTINE_NAME{} LIKE '{}'",
                                collate, likePattern));
    }
    if (categories & SearchCategory::Columns) {
        appendUnion(std::format("SELECT 'COLUMN' as object_type, TABLE_SCHEMA as schema_name, COLUMN_NAME as object_name, TABLE_NAME as parent_name "
                                "FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME{} LIKE '{}'",
                                collate, likePattern));
    }
    if (categories & SearchCategory::Indexes) {
        appendUnion(std::format("SELECT 'INDEX' as object_type, OBJECT_SCHEMA_NAME(object_id) as schema_name, name as object_name, OBJECT_NAME(object_id) as parent_name "
                                "FROM sys.indexes WHERE name IS NOT NULL AND name{} LIKE '{}'",
                                collate, likePattern));
    }

    if (unions.empty())
        return "SELECT NULL AS object_type, NULL AS schema_name, NULL AS object_name, NULL AS parent_name WHERE 1=0";

    return std::format("SELECT TOP {} * FROM ({}) AS search_results ORDER BY object_type, object_name", std::clamp(maxResults, 1, 1000), unions);
}

std::string SqlServerDialect::quickSearchQuery(std::string_view prefix, int limit) const {
    auto escaped = escapeSqlLike(prefix);
    return std::format(R"(
        SELECT TOP {} name FROM (
            SELECT TABLE_NAME as name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '{}%'
            UNION
            SELECT COLUMN_NAME as name FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '{}%'
        ) AS combined
        ORDER BY name
    )",
                       std::clamp(limit, 1, 100), escaped, escaped);
}

}  // namespace velocitydb
