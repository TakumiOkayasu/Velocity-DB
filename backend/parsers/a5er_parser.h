#pragma once

#include <memory>
#include <string>
#include <vector>

namespace predategrip {

struct A5ERColumn {
    std::string name;
    std::string logicalName;
    std::string type;
    int size;
    int scale;
    bool nullable;
    bool isPrimaryKey;
    std::string defaultValue;
    std::string comment;
};

struct A5ERIndex {
    std::string name;
    std::vector<std::string> columns;
    bool isUnique;
};

struct A5ERTable {
    std::string name;
    std::string logicalName;
    std::string comment;
    std::vector<A5ERColumn> columns;
    std::vector<A5ERIndex> indexes;
    double posX;
    double posY;
};

struct A5ERRelation {
    std::string name;
    std::string parentTable;
    std::string childTable;
    std::string parentColumn;
    std::string childColumn;
    std::string cardinality;  // "1:1", "1:N", "N:M"
};

struct A5ERModel {
    std::string name;
    std::string databaseType;
    std::vector<A5ERTable> tables;
    std::vector<A5ERRelation> relations;
};

class A5ERParser {
public:
    A5ERParser() = default;
    ~A5ERParser() = default;

    A5ERModel parse(const std::string& filepath);
    A5ERModel parseFromString(const std::string& content);

    std::string generateDDL(const A5ERModel& model, const std::string& targetDatabase = "SQLServer");
    std::string generateTableDDL(const A5ERTable& table, const std::string& targetDatabase = "SQLServer");

private:
    std::string mapTypeToSQLServer(const std::string& a5erType, int size, int scale) const;
};

}  // namespace predategrip
