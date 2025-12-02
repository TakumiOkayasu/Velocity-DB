#include "schema_inspector.h"
#include <sstream>

namespace predategrip {

void SchemaInspector::setDriver(std::shared_ptr<SQLServerDriver> driver) {
    m_driver = driver;
}

std::vector<std::string> SchemaInspector::getDatabases() {
    std::vector<std::string> databases;

    if (!m_driver || !m_driver->isConnected()) {
        return databases;
    }

    auto result = m_driver->execute("SELECT name FROM sys.databases ORDER BY name");
    for (const auto& row : result.rows) {
        if (!row.values.empty()) {
            databases.push_back(row.values[0]);
        }
    }

    return databases;
}

std::vector<TableInfo> SchemaInspector::getTables(const std::string& database) {
    std::vector<TableInfo> tables;

    if (!m_driver || !m_driver->isConnected()) {
        return tables;
    }

    std::string sql = R"(
        SELECT
            s.name AS schema_name,
            t.name AS table_name,
            t.type_desc AS table_type
        FROM sys.tables t
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        UNION ALL
        SELECT
            s.name AS schema_name,
            v.name AS table_name,
            'VIEW' AS table_type
        FROM sys.views v
        INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
        ORDER BY schema_name, table_name
    )";

    auto result = m_driver->execute(sql);
    for (const auto& row : result.rows) {
        if (row.values.size() >= 3) {
            TableInfo info;
            info.schema = row.values[0];
            info.name = row.values[1];
            info.type = row.values[2];
            tables.push_back(info);
        }
    }

    return tables;
}

std::vector<ColumnInfo> SchemaInspector::getColumns(const std::string& table) {
    std::vector<ColumnInfo> columns;

    if (!m_driver || !m_driver->isConnected()) {
        return columns;
    }

    std::string sql = R"(
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
        WHERE o.name = ')" + table + R"('
        ORDER BY c.column_id
    )";

    auto result = m_driver->execute(sql);
    for (const auto& row : result.rows) {
        if (row.values.size() >= 5) {
            ColumnInfo info;
            info.name = row.values[0];
            info.type = row.values[1];
            info.size = std::stoi(row.values[2]);
            info.nullable = (row.values[3] == "1");
            info.isPrimaryKey = (row.values[4] == "1");
            columns.push_back(info);
        }
    }

    return columns;
}

std::vector<IndexInfo> SchemaInspector::getIndexes(const std::string& table) {
    std::vector<IndexInfo> indexes;

    if (!m_driver || !m_driver->isConnected()) {
        return indexes;
    }

    std::string sql = R"(
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
        WHERE o.name = ')" + table + R"(' AND i.name IS NOT NULL
        ORDER BY i.name, ic.key_ordinal
    )";

    auto result = m_driver->execute(sql);
    std::string currentIndex;
    IndexInfo* currentInfo = nullptr;

    for (const auto& row : result.rows) {
        if (row.values.size() >= 5) {
            if (row.values[0] != currentIndex) {
                IndexInfo info;
                info.name = row.values[0];
                info.type = row.values[1];
                info.isUnique = (row.values[2] == "1");
                info.isPrimaryKey = (row.values[3] == "1");
                indexes.push_back(info);
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

std::vector<ForeignKeyInfo> SchemaInspector::getForeignKeys(const std::string& table) {
    std::vector<ForeignKeyInfo> fks;

    if (!m_driver || !m_driver->isConnected()) {
        return fks;
    }

    std::string sql = R"(
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
        WHERE o.name = ')" + table + R"('
    )";

    auto result = m_driver->execute(sql);
    for (const auto& row : result.rows) {
        if (row.values.size() >= 4) {
            ForeignKeyInfo info;
            info.name = row.values[0];
            info.column = row.values[1];
            info.referencedTable = row.values[2];
            info.referencedColumn = row.values[3];
            fks.push_back(info);
        }
    }

    return fks;
}

std::vector<StoredProcedureInfo> SchemaInspector::getStoredProcedures(const std::string& database) {
    std::vector<StoredProcedureInfo> procs;

    if (!m_driver || !m_driver->isConnected()) {
        return procs;
    }

    std::string sql = R"(
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
    for (const auto& row : result.rows) {
        if (row.values.size() >= 3) {
            StoredProcedureInfo info;
            info.schema = row.values[0];
            info.name = row.values[1];
            info.definition = row.values[2];
            procs.push_back(info);
        }
    }

    return procs;
}

std::vector<FunctionInfo> SchemaInspector::getFunctions(const std::string& database) {
    std::vector<FunctionInfo> funcs;

    if (!m_driver || !m_driver->isConnected()) {
        return funcs;
    }

    std::string sql = R"(
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
    for (const auto& row : result.rows) {
        if (row.values.size() >= 4) {
            FunctionInfo info;
            info.schema = row.values[0];
            info.name = row.values[1];
            info.returnType = row.values[2];
            info.definition = row.values[3];
            funcs.push_back(info);
        }
    }

    return funcs;
}

std::string SchemaInspector::generateDDL(const std::string& table) {
    auto columns = getColumns(table);
    auto indexes = getIndexes(table);
    auto fks = getForeignKeys(table);

    std::ostringstream ddl;
    ddl << "CREATE TABLE [" << table << "] (\n";

    for (size_t i = 0; i < columns.size(); ++i) {
        const auto& col = columns[i];
        ddl << "    [" << col.name << "] " << col.type;

        if (col.type == "VARCHAR" || col.type == "NVARCHAR" || col.type == "CHAR") {
            if (col.size == -1) {
                ddl << "(MAX)";
            } else {
                ddl << "(" << col.size << ")";
            }
        }

        if (!col.nullable) {
            ddl << " NOT NULL";
        }

        if (i < columns.size() - 1) {
            ddl << ",";
        }
        ddl << "\n";
    }

    ddl << ");\n";

    return ddl.str();
}

std::string SchemaInspector::generateSelectStatement(const std::string& table) {
    auto columns = getColumns(table);

    std::ostringstream sql;
    sql << "SELECT\n";

    for (size_t i = 0; i < columns.size(); ++i) {
        sql << "    [" << columns[i].name << "]";
        if (i < columns.size() - 1) {
            sql << ",";
        }
        sql << "\n";
    }

    sql << "FROM [" << table << "]";
    return sql.str();
}

std::string SchemaInspector::generateInsertStatement(const std::string& table) {
    auto columns = getColumns(table);

    std::ostringstream sql;
    sql << "INSERT INTO [" << table << "] (\n";

    for (size_t i = 0; i < columns.size(); ++i) {
        sql << "    [" << columns[i].name << "]";
        if (i < columns.size() - 1) {
            sql << ",";
        }
        sql << "\n";
    }

    sql << ") VALUES (\n";

    for (size_t i = 0; i < columns.size(); ++i) {
        sql << "    @" << columns[i].name;
        if (i < columns.size() - 1) {
            sql << ",";
        }
        sql << "\n";
    }

    sql << ")";
    return sql.str();
}

std::string SchemaInspector::generateUpdateStatement(const std::string& table) {
    auto columns = getColumns(table);

    std::ostringstream sql;
    sql << "UPDATE [" << table << "]\nSET\n";

    bool first = true;
    std::string whereClause;

    for (const auto& col : columns) {
        if (col.isPrimaryKey) {
            if (!whereClause.empty()) {
                whereClause += " AND ";
            }
            whereClause += "[" + col.name + "] = @" + col.name;
        } else {
            if (!first) {
                sql << ",\n";
            }
            sql << "    [" << col.name << "] = @" << col.name;
            first = false;
        }
    }

    if (!whereClause.empty()) {
        sql << "\nWHERE " << whereClause;
    }

    return sql.str();
}

std::string SchemaInspector::generateDeleteStatement(const std::string& table) {
    auto columns = getColumns(table);

    std::ostringstream sql;
    sql << "DELETE FROM [" << table << "]\nWHERE ";

    bool first = true;
    for (const auto& col : columns) {
        if (col.isPrimaryKey) {
            if (!first) {
                sql << " AND ";
            }
            sql << "[" << col.name << "] = @" << col.name;
            first = false;
        }
    }

    return sql.str();
}

}  // namespace predategrip
