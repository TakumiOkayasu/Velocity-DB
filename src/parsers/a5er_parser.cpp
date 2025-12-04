#include "a5er_parser.h"

#include <fstream>
#include <sstream>
#include <stdexcept>

#include "pugixml.hpp"

namespace predategrip {

A5ERModel A5ERParser::parse(const std::string& filepath) {
    pugi::xml_document doc;
    pugi::xml_parse_result result = doc.load_file(filepath.c_str());

    if (!result) {
        throw std::runtime_error("Failed to parse A5:ER file: " + std::string(result.description()));
    }

    A5ERModel model;

    auto root = doc.child("A5ER");
    if (!root) {
        throw std::runtime_error("Invalid A5:ER file format");
    }

    model.name = root.attribute("Name").as_string();
    model.databaseType = root.attribute("DatabaseType").as_string();

    // Parse tables
    for (auto entityNode : root.children("Entity")) {
        A5ERTable table;
        table.name = entityNode.attribute("Name").as_string();
        table.logicalName = entityNode.attribute("LogicalName").as_string();
        table.comment = entityNode.attribute("Comment").as_string();
        table.posX = entityNode.attribute("X").as_double();
        table.posY = entityNode.attribute("Y").as_double();

        // Parse columns
        for (auto attrNode : entityNode.children("Attribute")) {
            A5ERColumn col;
            col.name = attrNode.attribute("Name").as_string();
            col.logicalName = attrNode.attribute("LogicalName").as_string();
            col.type = attrNode.attribute("Type").as_string();
            col.size = attrNode.attribute("Size").as_int();
            col.scale = attrNode.attribute("Scale").as_int();
            col.nullable = attrNode.attribute("Nullable").as_bool(true);
            col.isPrimaryKey = attrNode.attribute("PK").as_bool(false);
            col.defaultValue = attrNode.attribute("Default").as_string();
            col.comment = attrNode.attribute("Comment").as_string();
            table.columns.push_back(col);
        }

        // Parse indexes
        for (auto indexNode : entityNode.children("Index")) {
            A5ERIndex idx;
            idx.name = indexNode.attribute("Name").as_string();
            idx.isUnique = indexNode.attribute("Unique").as_bool(false);

            std::string cols = indexNode.attribute("Columns").as_string();
            std::istringstream iss(cols);
            std::string colName;
            while (std::getline(iss, colName, ',')) {
                idx.columns.push_back(colName);
            }
            table.indexes.push_back(idx);
        }

        model.tables.push_back(table);
    }

    // Parse relations
    for (auto relNode : root.children("Relation")) {
        A5ERRelation rel;
        rel.name = relNode.attribute("Name").as_string();
        rel.parentTable = relNode.attribute("ParentEntity").as_string();
        rel.childTable = relNode.attribute("ChildEntity").as_string();
        rel.parentColumn = relNode.attribute("ParentAttribute").as_string();
        rel.childColumn = relNode.attribute("ChildAttribute").as_string();
        rel.cardinality = relNode.attribute("Cardinality").as_string("1:N");
        model.relations.push_back(rel);
    }

    return model;
}

A5ERModel A5ERParser::parseFromString(const std::string& content) {
    pugi::xml_document doc;
    pugi::xml_parse_result result = doc.load_string(content.c_str());

    if (!result) {
        throw std::runtime_error("Failed to parse A5:ER content: " + std::string(result.description()));
    }

    // Same parsing logic as parse()
    A5ERModel model;
    auto root = doc.child("A5ER");
    if (!root) {
        throw std::runtime_error("Invalid A5:ER format");
    }

    model.name = root.attribute("Name").as_string();
    model.databaseType = root.attribute("DatabaseType").as_string();

    for (auto entityNode : root.children("Entity")) {
        A5ERTable table;
        table.name = entityNode.attribute("Name").as_string();
        table.logicalName = entityNode.attribute("LogicalName").as_string();
        table.comment = entityNode.attribute("Comment").as_string();
        table.posX = entityNode.attribute("X").as_double();
        table.posY = entityNode.attribute("Y").as_double();

        for (auto attrNode : entityNode.children("Attribute")) {
            A5ERColumn col;
            col.name = attrNode.attribute("Name").as_string();
            col.logicalName = attrNode.attribute("LogicalName").as_string();
            col.type = attrNode.attribute("Type").as_string();
            col.size = attrNode.attribute("Size").as_int();
            col.scale = attrNode.attribute("Scale").as_int();
            col.nullable = attrNode.attribute("Nullable").as_bool(true);
            col.isPrimaryKey = attrNode.attribute("PK").as_bool(false);
            col.defaultValue = attrNode.attribute("Default").as_string();
            col.comment = attrNode.attribute("Comment").as_string();
            table.columns.push_back(col);
        }

        model.tables.push_back(table);
    }

    for (auto relNode : root.children("Relation")) {
        A5ERRelation rel;
        rel.name = relNode.attribute("Name").as_string();
        rel.parentTable = relNode.attribute("ParentEntity").as_string();
        rel.childTable = relNode.attribute("ChildEntity").as_string();
        rel.parentColumn = relNode.attribute("ParentAttribute").as_string();
        rel.childColumn = relNode.attribute("ChildAttribute").as_string();
        rel.cardinality = relNode.attribute("Cardinality").as_string("1:N");
        model.relations.push_back(rel);
    }

    return model;
}

std::string A5ERParser::generateDDL(const A5ERModel& model, const std::string& targetDatabase) {
    std::ostringstream ddl;

    ddl << "-- Generated from A5:ER model: " << model.name << "\n";
    ddl << "-- Target database: " << targetDatabase << "\n\n";

    // Generate table DDLs
    for (const auto& table : model.tables) {
        ddl << generateTableDDL(table, targetDatabase) << "\n\n";
    }

    // Generate foreign keys
    for (const auto& rel : model.relations) {
        ddl << "ALTER TABLE [" << rel.childTable << "]\n";
        ddl << "ADD CONSTRAINT [FK_" << rel.childTable << "_" << rel.parentTable << "]\n";
        ddl << "FOREIGN KEY ([" << rel.childColumn << "])\n";
        ddl << "REFERENCES [" << rel.parentTable << "] ([" << rel.parentColumn << "]);\n\n";
    }

    return ddl.str();
}

std::string A5ERParser::generateTableDDL(const A5ERTable& table, const std::string& targetDatabase) {
    std::ostringstream ddl;

    if (!table.comment.empty()) {
        ddl << "-- " << table.comment << "\n";
    }

    ddl << "CREATE TABLE [" << table.name << "] (\n";

    std::vector<std::string> pkColumns;

    for (size_t i = 0; i < table.columns.size(); ++i) {
        const auto& col = table.columns[i];

        ddl << "    [" << col.name << "] ";
        ddl << mapTypeToSQLServer(col.type, col.size, col.scale);

        if (!col.nullable) {
            ddl << " NOT NULL";
        }

        if (!col.defaultValue.empty()) {
            ddl << " DEFAULT " << col.defaultValue;
        }

        if (col.isPrimaryKey) {
            pkColumns.push_back(col.name);
        }

        if (i < table.columns.size() - 1 || !pkColumns.empty()) {
            ddl << ",";
        }

        if (!col.comment.empty()) {
            ddl << " -- " << col.comment;
        }

        ddl << "\n";
    }

    // Primary key constraint
    if (!pkColumns.empty()) {
        ddl << "    CONSTRAINT [PK_" << table.name << "] PRIMARY KEY (";
        for (size_t i = 0; i < pkColumns.size(); ++i) {
            ddl << "[" << pkColumns[i] << "]";
            if (i < pkColumns.size() - 1) {
                ddl << ", ";
            }
        }
        ddl << ")\n";
    }

    ddl << ");";

    // Create indexes
    for (const auto& idx : table.indexes) {
        ddl << "\n\nCREATE ";
        if (idx.isUnique) {
            ddl << "UNIQUE ";
        }
        ddl << "INDEX [" << idx.name << "] ON [" << table.name << "] (";
        for (size_t i = 0; i < idx.columns.size(); ++i) {
            ddl << "[" << idx.columns[i] << "]";
            if (i < idx.columns.size() - 1) {
                ddl << ", ";
            }
        }
        ddl << ");";
    }

    return ddl.str();
}

std::string A5ERParser::mapTypeToSQLServer(const std::string& a5erType, int size, int scale) const {
    // Map common A5:ER types to SQL Server types
    // Supports both English and Japanese type names from A5:ER
    if (a5erType == "VARCHAR" || a5erType == "string" || a5erType == "NVARCHAR") {
        if (size <= 0 || size > 8000) {
            return "NVARCHAR(MAX)";
        }
        return "NVARCHAR(" + std::to_string(size) + ")";
    }
    if (a5erType == "INT" || a5erType == "integer" || a5erType == "INTEGER") {
        return "INT";
    }
    if (a5erType == "BIGINT" || a5erType == "bigint") {
        return "BIGINT";
    }
    if (a5erType == "DECIMAL" || a5erType == "decimal" || a5erType == "NUMERIC") {
        return "DECIMAL(" + std::to_string(size) + "," + std::to_string(scale) + ")";
    }
    if (a5erType == "DATE" || a5erType == "date") {
        return "DATE";
    }
    if (a5erType == "DATETIME" || a5erType == "datetime" || a5erType == "TIMESTAMP") {
        return "DATETIME2";
    }
    if (a5erType == "BIT" || a5erType == "boolean" || a5erType == "BOOLEAN") {
        return "BIT";
    }
    if (a5erType == "TEXT" || a5erType == "text" || a5erType == "CLOB") {
        return "NVARCHAR(MAX)";
    }
    if (a5erType == "BLOB" || a5erType == "binary" || a5erType == "BINARY") {
        return "VARBINARY(MAX)";
    }

    // Default: return as-is
    return a5erType;
}

}  // namespace predategrip
