#include "schema_inspector.h"

#include "utils/logger.h"

#include <format>

using namespace std::literals;

namespace predategrip {

std::vector<std::string> SchemaInspector::getDatabases() {
    std::vector<std::string> databases;

    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        return databases;
    }

    auto result = m_driver->execute("SELECT name FROM sys.databases ORDER BY name");
    databases.reserve(result.rows.size());
    for (const auto& row : result.rows) {
        if (!row.values.empty()) {
            databases.push_back(row.values[0]);
        }
    }

    return databases;
}

std::vector<TableInfo> SchemaInspector::getTables(std::string_view database) {
    predategrip::log<LogLevel::DEBUG>(std::format("SchemaInspector::getTables called for database: '{}'", database));

    std::vector<TableInfo> tables;

    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        predategrip::log<LogLevel::WARNING>("SchemaInspector::getTables: Driver not connected"sv);
        return tables;
    }

    constexpr auto sql = R"(
        SELECT
            s.name AS schema_name,
            t.name AS table_name,
            t.type_desc AS table_type,
            CAST(ep.value AS NVARCHAR(MAX)) AS comment
        FROM sys.tables t
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id
            AND ep.minor_id = 0
            AND ep.class = 1
            AND ep.name = 'MS_Description'
        UNION ALL
        SELECT
            s.name AS schema_name,
            v.name AS table_name,
            'VIEW' AS table_type,
            CAST(ep.value AS NVARCHAR(MAX)) AS comment
        FROM sys.views v
        INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
        LEFT JOIN sys.extended_properties ep ON ep.major_id = v.object_id
            AND ep.minor_id = 0
            AND ep.class = 1
            AND ep.name = 'MS_Description'
        ORDER BY schema_name, table_name
    )";

    predategrip::log<LogLevel::DEBUG>("SchemaInspector::getTables: Executing SQL query"sv);
    auto result = m_driver->execute(sql);
    predategrip::log<LogLevel::INFO>(std::format("SchemaInspector::getTables: Query returned {} rows", result.rows.size()));

    tables.reserve(result.rows.size());
    for (const auto& row : result.rows) {
        if (row.values.size() >= 3) {
            std::string comment = row.values.size() >= 4 ? row.values[3] : "";
            tables.push_back({.schema = row.values[0], .name = row.values[1], .type = row.values[2], .comment = comment});
            predategrip::log<LogLevel::DEBUG>(std::format("  Found: {}.{} ({}) - Comment: {}", row.values[0], row.values[1], row.values[2], comment));
        }
    }

    predategrip::log<LogLevel::INFO>(std::format("SchemaInspector::getTables: Returning {} tables/views", tables.size()));
    return tables;
}

std::vector<ColumnInfo> SchemaInspector::getColumns(std::string_view table) {
    std::vector<ColumnInfo> columns;

    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        return columns;
    }

    auto sql = std::format(R"(
        SELECT
            c.name AS column_name,
            t.name AS data_type,
            c.max_length,
            c.is_nullable,
            CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
        FROM sys.columns c
        INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
        INNER JOIN sys.objects o ON c.object_id = o.object_id
        LEFT JOIN (
            SELECT ic.object_id, ic.column_id
            FROM sys.index_columns ic
            INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            WHERE i.is_primary_key = 1
        ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
        WHERE o.name = '{}'
        ORDER BY c.column_id
    )",
                           table);

    auto result = m_driver->execute(sql);
    columns.reserve(result.rows.size());
    for (const auto& row : result.rows) {
        if (row.values.size() >= 5) {
            columns.push_back({.name = row.values[0], .type = row.values[1], .size = std::stoi(row.values[2]), .nullable = (row.values[3] == "1"), .isPrimaryKey = (row.values[4] == "1")});
        }
    }

    return columns;
}

std::vector<IndexInfo> SchemaInspector::getIndexes(std::string_view table) {
    std::vector<IndexInfo> indexes;

    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        return indexes;
    }

    auto sql = std::format(R"(
        SELECT
            i.name AS index_name,
            i.type_desc AS index_type,
            i.is_unique,
            i.is_primary_key,
            c.name AS column_name
        FROM sys.indexes i
        INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        INNER JOIN sys.objects o ON i.object_id = o.object_id
        WHERE o.name = '{}' AND i.name IS NOT NULL
        ORDER BY i.name, ic.key_ordinal
    )",
                           table);

    auto result = m_driver->execute(sql);
    std::string currentIndex;
    IndexInfo* currentInfo = nullptr;

    for (const auto& row : result.rows) {
        if (row.values.size() >= 5) {
            if (row.values[0] != currentIndex) {
                indexes.push_back({.name = row.values[0], .type = row.values[1], .isUnique = (row.values[2] == "1"), .isPrimaryKey = (row.values[3] == "1")});
                currentIndex = row.values[0];
                currentInfo = &indexes.back();
            }
            if (currentInfo) {
                currentInfo->columns.push_back(row.values[4]);
            }
        }
    }

    return indexes;
}

std::vector<ForeignKeyInfo> SchemaInspector::getForeignKeys(std::string_view table) {
    std::vector<ForeignKeyInfo> fks;

    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        return fks;
    }

    auto sql = std::format(R"(
        SELECT
            fk.name AS fk_name,
            c.name AS column_name,
            rt.name AS referenced_table,
            rc.name AS referenced_column
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
        INNER JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id
        INNER JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
        INNER JOIN sys.objects o ON fk.parent_object_id = o.object_id
        WHERE o.name = '{}'
    )",
                           table);

    auto result = m_driver->execute(sql);
    fks.reserve(result.rows.size());
    for (const auto& row : result.rows) {
        if (row.values.size() >= 4) {
            fks.push_back({.name = row.values[0], .column = row.values[1], .referencedTable = row.values[2], .referencedColumn = row.values[3]});
        }
    }

    return fks;
}

std::vector<StoredProcedureInfo> SchemaInspector::getStoredProcedures(std::string_view) {
    std::vector<StoredProcedureInfo> procs;

    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        return procs;
    }

    constexpr auto sql = R"(
        SELECT
            s.name AS schema_name,
            p.name AS proc_name,
            m.definition
        FROM sys.procedures p
        INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
        LEFT JOIN sys.sql_modules m ON p.object_id = m.object_id
        ORDER BY s.name, p.name
    )";

    auto result = m_driver->execute(sql);
    procs.reserve(result.rows.size());
    for (const auto& row : result.rows) {
        if (row.values.size() >= 3) {
            procs.push_back({.schema = row.values[0], .name = row.values[1], .definition = row.values[2]});
        }
    }

    return procs;
}

std::vector<FunctionInfo> SchemaInspector::getFunctions(std::string_view) {
    std::vector<FunctionInfo> funcs;

    if (!m_driver || !m_driver->isConnected()) [[unlikely]] {
        return funcs;
    }

    constexpr auto sql = R"(
        SELECT
            s.name AS schema_name,
            o.name AS func_name,
            TYPE_NAME(c.user_type_id) AS return_type,
            m.definition
        FROM sys.objects o
        INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
        LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
        LEFT JOIN sys.parameters c ON o.object_id = c.object_id AND c.parameter_id = 0
        WHERE o.type IN ('FN', 'IF', 'TF')
        ORDER BY s.name, o.name
    )";

    auto result = m_driver->execute(sql);
    funcs.reserve(result.rows.size());
    for (const auto& row : result.rows) {
        if (row.values.size() >= 4) {
            funcs.push_back({.schema = row.values[0], .name = row.values[1], .returnType = row.values[2], .definition = row.values[3]});
        }
    }

    return funcs;
}

std::string SchemaInspector::generateDDL(std::string_view table) {
    auto columns = getColumns(table);

    std::string ddl = std::format("CREATE TABLE [{}] (\n", table);

    for (size_t i = 0; i < columns.size(); ++i) {
        const auto& col = columns[i];
        ddl += std::format("    [{}] {}", col.name, col.type);

        if (col.type == "VARCHAR" || col.type == "NVARCHAR" || col.type == "CHAR") {
            if (col.size == -1) {
                ddl += "(MAX)";
            } else {
                ddl += std::format("({})", col.size);
            }
        }

        if (!col.nullable) {
            ddl += " NOT NULL";
        }

        if (i < columns.size() - 1) {
            ddl += ",";
        }
        ddl += "\n";
    }

    ddl += ");\n";
    return ddl;
}

std::string SchemaInspector::generateSelectStatement(std::string_view table) {
    auto columns = getColumns(table);

    std::string sql = "SELECT\n";
    for (size_t i = 0; i < columns.size(); ++i) {
        sql += std::format("    [{}]", columns[i].name);
        if (i < columns.size() - 1) {
            sql += ",";
        }
        sql += "\n";
    }
    sql += std::format("FROM [{}]", table);
    return sql;
}

std::string SchemaInspector::generateInsertStatement(std::string_view table) {
    auto columns = getColumns(table);

    std::string sql = std::format("INSERT INTO [{}] (\n", table);
    for (size_t i = 0; i < columns.size(); ++i) {
        sql += std::format("    [{}]", columns[i].name);
        if (i < columns.size() - 1) {
            sql += ",";
        }
        sql += "\n";
    }
    sql += ") VALUES (\n";
    for (size_t i = 0; i < columns.size(); ++i) {
        sql += std::format("    @{}", columns[i].name);
        if (i < columns.size() - 1) {
            sql += ",";
        }
        sql += "\n";
    }
    sql += ")";
    return sql;
}

std::string SchemaInspector::generateUpdateStatement(std::string_view table) {
    auto columns = getColumns(table);

    std::string sql = std::format("UPDATE [{}]\nSET\n", table);
    std::string whereClause;
    bool first = true;

    for (const auto& col : columns) {
        if (col.isPrimaryKey) {
            if (!whereClause.empty()) {
                whereClause += " AND ";
            }
            whereClause += std::format("[{}] = @{}", col.name, col.name);
        } else {
            if (!first) {
                sql += ",\n";
            }
            sql += std::format("    [{}] = @{}", col.name, col.name);
            first = false;
        }
    }

    if (!whereClause.empty()) {
        sql += std::format("\nWHERE {}", whereClause);
    }

    return sql;
}

std::string SchemaInspector::generateDeleteStatement(std::string_view table) {
    auto columns = getColumns(table);

    std::string sql = std::format("DELETE FROM [{}]\nWHERE ", table);
    bool first = true;

    for (const auto& col : columns) {
        if (col.isPrimaryKey) {
            if (!first) {
                sql += " AND ";
            }
            sql += std::format("[{}] = @{}", col.name, col.name);
            first = false;
        }
    }

    return sql;
}

}  // namespace predategrip
