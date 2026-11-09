#pragma once

#include "../interfaces/parsers/er_diagram_parser.h"
#include "interfaces/parsers/er_model.h"

#include <memory>
#include <string>
#include <vector>

namespace velocitydb {

// Legacy A5:ER model types (kept for backward compatibility with tests)
struct A5ERColumn {
    std::string name;
    std::string logicalName;
    std::string type;
    int size = 0;
    int scale = 0;
    bool nullable = true;
    bool isPrimaryKey = false;
    std::string defaultValue;
    std::string comment;
    std::string color;  // A5:ER raw color (e.g. "$AABBGGRR") or empty
};

struct A5ERIndex {
    std::string name;
    std::vector<std::string> columns;
    bool isUnique = false;
};

struct A5ERTable {
    std::string name;
    std::string logicalName;
    std::string comment;
    std::string page;
    std::vector<A5ERColumn> columns;
    std::vector<A5ERIndex> indexes;
    double posX = 0;
    double posY = 0;
    std::string color;    // A5:ER raw color "$BBGGRR"
    std::string bkColor;  // A5:ER raw color "$BBGGRR"
};

struct A5ERRelation {
    std::string name;
    std::string parentTable;
    std::string childTable;
    std::string parentColumn;
    std::string childColumn;
    std::string cardinality;  // "1:1", "1:N", "N:M"
};

struct A5ERShape {
    std::string shapeType;
    std::string text;
    std::string brushColor;  // A5:ER raw "$BBGGRR"
    std::string fontColor;   // A5:ER raw "$BBGGRR"
    int brushAlpha = 255;
    int fontSize = 9;
    double left = 0;
    double top = 0;
    double width = 0;
    double height = 0;
    std::string page;
};

struct A5ERModel {
    std::string name;
    std::string databaseType;
    std::vector<A5ERTable> tables;
    std::vector<A5ERRelation> relations;
    std::vector<A5ERShape> shapes;
};

class A5ERParser : public IERDiagramParser {
public:
    A5ERParser() = default;
    ~A5ERParser() override = default;

    // IERDiagramParser interface
    [[nodiscard]] std::vector<std::string> extensions() const override;
    [[nodiscard]] bool canParse(const std::string& content) const override;
    [[nodiscard]] ERModel parse(const std::string& content) const override;
    [[nodiscard]] std::string generateDDL(const ERModel& model, TargetDatabase target = TargetDatabase::SQLServer) const override;

    // Legacy API (for tests and backward compat)
    A5ERModel parseFile(const std::string& filepath) const;
    A5ERModel parseFromString(const std::string& content) const;
    std::string generateA5ERDDL(const A5ERModel& model, const std::string& targetDatabase = "SQLServer") const;
    std::string generateTableDDL(const A5ERTable& table, const std::string& targetDatabase = "SQLServer") const;

    // Conversion
    [[nodiscard]] static ERModel toERModel(const A5ERModel& a5model);

private:
    [[nodiscard]] bool isTextFormat(const std::string& content) const;
    A5ERModel parseTextFormat(const std::string& content) const;
    A5ERModel parseXmlFormat(const std::string& content) const;
    static std::vector<std::string> parseQuotedCSV(const std::string& raw);
    /// Resolve A5:ER RelationType pair to cardinality string.
    /// Sets needsSwap=true when Entity1 is the Many side (parent/child should be swapped).
    static std::string resolveCardinality(int type1, int type2, bool& needsSwap);
    std::string mapTypeToSQLServer(const std::string& a5erType, int size, int scale) const;

    enum class ColorSource { Entity, Shape };

    /// A5:ER $BBGGRR or $AABBGGRR → CSS #RRGGBB (empty if default)
    static std::string convertA5erColor(const std::string& raw, ColorSource source = ColorSource::Entity);
};

}  // namespace velocitydb
