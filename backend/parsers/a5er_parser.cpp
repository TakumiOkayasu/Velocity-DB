#include "a5er_parser.h"

#include "a5er_utils.h"

#include <algorithm>
#include <charconv>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <unordered_map>

#include "pugixml.hpp"

namespace velocitydb {

namespace {

/// Escape `]` → `]]` for SQL Server bracket-delimited identifiers
std::string bracketEscape(const std::string& name) {
    std::string result;
    result.reserve(name.size() + 2);
    result += '[';
    for (char c : name) {
        if (c == ']')
            result += ']';
        result += c;
    }
    result += ']';
    return result;
}

}  // namespace

// === IERDiagramParser interface ===

std::vector<std::string> A5ERParser::extensions() const {
    return {".a5er"};
}

bool A5ERParser::canParse(const std::string& content) const {
    return isTextFormat(content) || content.find("<A5ER") != std::string::npos;
}

ERModel A5ERParser::parse(const std::string& content) const {
    return toERModel(parseFromString(content));
}

std::string A5ERParser::generateDDL(const ERModel& model, TargetDatabase target) const {
    std::string targetDb = "SQLServer";
    if (target == TargetDatabase::PostgreSQL)
        targetDb = "PostgreSQL";
    else if (target == TargetDatabase::MySQL)
        targetDb = "MySQL";

    std::ostringstream ddl;
    ddl << "-- Generated from ER model: " << model.name << "\n";
    ddl << "-- Target database: " << targetDb << "\n\n";

    for (const auto& table : model.tables) {
        if (!table.comment.empty())
            ddl << "-- " << table.comment << "\n";

        ddl << "CREATE TABLE " << bracketEscape(table.name) << " (\n";
        std::vector<std::string> pkColumns;

        for (size_t i = 0; i < table.columns.size(); ++i) {
            const auto& col = table.columns[i];
            ddl << "    " << bracketEscape(col.name) << " ";
            ddl << mapTypeToSQLServer(col.type, col.size, col.scale);
            if (!col.nullable)
                ddl << " NOT NULL";
            if (!col.defaultValue.empty())
                ddl << " DEFAULT " << col.defaultValue;
            if (col.isPrimaryKey)
                pkColumns.push_back(col.name);
            if (i + 1 < table.columns.size() || !pkColumns.empty())
                ddl << ",";
            if (!col.comment.empty())
                ddl << " -- " << col.comment;
            ddl << "\n";
        }

        if (!pkColumns.empty()) {
            ddl << "    CONSTRAINT " << bracketEscape("PK_" + table.name) << " PRIMARY KEY (";
            for (size_t i = 0; i < pkColumns.size(); ++i) {
                ddl << bracketEscape(pkColumns[i]);
                if (i + 1 < pkColumns.size())
                    ddl << ", ";
            }
            ddl << ")\n";
        }
        ddl << ");\n\n";

        for (const auto& idx : table.indexes) {
            ddl << "CREATE ";
            if (idx.isUnique)
                ddl << "UNIQUE ";
            ddl << "INDEX " << bracketEscape(idx.name) << " ON " << bracketEscape(table.name) << " (";
            for (size_t i = 0; i < idx.columns.size(); ++i) {
                ddl << bracketEscape(idx.columns[i]);
                if (i + 1 < idx.columns.size())
                    ddl << ", ";
            }
            ddl << ");\n\n";
        }
    }

    for (const auto& rel : model.relations) {
        ddl << "ALTER TABLE " << bracketEscape(rel.childTable) << "\n";
        ddl << "ADD CONSTRAINT " << bracketEscape("FK_" + rel.childTable + "_" + rel.parentTable) << "\n";
        ddl << "FOREIGN KEY (" << bracketEscape(rel.childColumn) << ")\n";
        ddl << "REFERENCES " << bracketEscape(rel.parentTable) << " (" << bracketEscape(rel.parentColumn) << ");\n\n";
    }

    return ddl.str();
}

// === Color conversion ===

std::string A5ERParser::convertA5erColor(const std::string& raw, ColorSource source) {
    if (raw.empty() || raw[0] != '$')
        return "";

    std::string_view hex(raw);
    hex.remove_prefix(1);  // Remove '$'

    if (hex.size() == 8) {
        // Shapes use the full $FFFFFFFF marker; their opacity comes from BrushAlpha.
        // Keep the existing FF-prefix convention for entity and field colors.
        const auto marker = source == ColorSource::Shape ? hex : hex.substr(0, 2);
        if (marker.find_first_not_of("Ff") == std::string_view::npos)
            return "";
        hex.remove_prefix(2);
    }

    if (hex.size() != 6)
        return "";

    // Validate hex characters
    unsigned int val = 0;
    auto [ptr, ec] = std::from_chars(hex.data(), hex.data() + hex.size(), val, 16);
    if (ec != std::errc{} || ptr != hex.data() + hex.size())
        return "";

    // $BBGGRR → #RRGGBB
    std::string result = "#";
    result += hex.substr(4, 2);  // RR
    result += hex.substr(2, 2);  // GG
    result += hex.substr(0, 2);  // BB

    // Uppercase for consistency
    std::ranges::transform(result, result.begin(), [](unsigned char c) { return std::toupper(c); });
    return result;
}

// === A5ERModel → ERModel conversion ===

ERModel A5ERParser::toERModel(const A5ERModel& a5model) {
    ERModel model;
    model.name = a5model.name;
    model.databaseType = a5model.databaseType;

    for (const auto& t : a5model.tables) {
        ERModelTable table;
        table.name = t.name;
        table.logicalName = t.logicalName;
        table.comment = t.comment;
        table.page = t.page;
        table.posX = t.posX;
        table.posY = t.posY;
        table.color = convertA5erColor(t.color);
        table.bkColor = convertA5erColor(t.bkColor);

        for (const auto& c : t.columns) {
            ERModelColumn col;
            col.name = c.name;
            col.logicalName = c.logicalName;
            col.type = c.type;
            col.size = c.size;
            col.scale = c.scale;
            col.nullable = c.nullable;
            col.isPrimaryKey = c.isPrimaryKey;
            col.defaultValue = c.defaultValue;
            col.comment = c.comment;
            col.color = convertA5erColor(c.color);
            table.columns.push_back(std::move(col));
        }

        for (const auto& idx : t.indexes) {
            ERModelIndex erIdx;
            erIdx.name = idx.name;
            erIdx.columns = idx.columns;
            erIdx.isUnique = idx.isUnique;
            table.indexes.push_back(std::move(erIdx));
        }

        model.tables.push_back(std::move(table));
    }

    for (const auto& r : a5model.relations) {
        ERModelRelation rel;
        rel.name = r.name;
        rel.parentTable = r.parentTable;
        rel.childTable = r.childTable;
        rel.parentColumn = r.parentColumn;
        rel.childColumn = r.childColumn;
        rel.cardinality = r.cardinality;
        model.relations.push_back(std::move(rel));
    }

    for (const auto& s : a5model.shapes) {
        ERModelShape shape;
        shape.shapeType = s.shapeType;
        // Normalize shapeType to lowercase
        std::ranges::transform(shape.shapeType, shape.shapeType.begin(), [](unsigned char c) { return std::tolower(c); });
        shape.text = s.text;
        shape.fillColor = convertA5erColor(s.brushColor, ColorSource::Shape);
        shape.fontColor = convertA5erColor(s.fontColor, ColorSource::Shape);
        shape.fillAlpha = s.brushAlpha;
        shape.fontSize = s.fontSize;
        shape.left = s.left;
        shape.top = s.top;
        shape.width = s.width;
        shape.height = s.height;
        shape.page = s.page;
        model.shapes.push_back(std::move(shape));
    }

    return model;
}

// === Legacy API ===

bool A5ERParser::isTextFormat(const std::string& content) const {
    // XML形式は除外
    std::string_view sv(content);
    auto pos = sv.find_first_not_of(" \t\r\n\xEF\xBB\xBF");
    if (pos != std::string_view::npos) {
        if (sv.substr(pos).starts_with("<?xml") || sv[pos] == '<') {
            return false;
        }
    }
    // A5:ERヘッダ必須（[Entity]だけでは他INI形式と誤検知しうる）
    return content.find("# A5:ER") != std::string::npos;
}

A5ERModel A5ERParser::parseFile(const std::string& filepath) const {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open file: " + filepath);
    }
    std::string content((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    return parseFromString(content);
}

A5ERModel A5ERParser::parseFromString(const std::string& content) const {
    // UTF-8 BOM除去（BOMなし時はコピー回避）
    const bool hasBom = content.size() >= 3 && content[0] == '\xEF' && content[1] == '\xBB' && content[2] == '\xBF';
    const std::string stripped = hasBom ? content.substr(3) : std::string{};
    const std::string& input = hasBom ? stripped : content;

    if (isTextFormat(input)) {
        return parseTextFormat(input);
    }
    return parseXmlFormat(input);
}

A5ERModel A5ERParser::parseXmlFormat(const std::string& content) const {
    pugi::xml_document doc;
    pugi::xml_parse_result result = doc.load_string(content.c_str());

    if (!result) {
        throw std::runtime_error("Failed to parse A5:ER content: " + std::string(result.description()));
    }

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
        table.page = entityNode.attribute("Page").as_string();
        table.posX = entityNode.attribute("X").as_double();
        table.posY = entityNode.attribute("Y").as_double();
        table.color = entityNode.attribute("Color").as_string();
        table.bkColor = entityNode.attribute("BkColor").as_string();

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

// === テキスト形式パース ===

std::vector<std::string> A5ERParser::parseQuotedCSV(const std::string& raw) {
    std::vector<std::string> result;
    size_t i = 0;
    const size_t len = raw.size();

    while (i < len) {
        // 先頭空白スキップ
        while (i < len && raw[i] == ' ')
            ++i;
        if (i >= len)
            break;

        if (raw[i] == '"') {
            ++i;  // 開始引用符スキップ
            std::string value;
            value.reserve(64);
            while (i < len) {
                if (raw[i] == '"') {
                    if (i + 1 < len && raw[i + 1] == '"') {
                        value += '"';
                        i += 2;
                    } else {
                        ++i;
                        break;
                    }
                } else {
                    value += raw[i];
                    ++i;
                }
            }
            result.push_back(std::move(value));
        } else {
            std::string value;
            while (i < len && raw[i] != ',') {
                value += raw[i];
                ++i;
            }
            result.push_back(std::move(value));
        }

        // カンマスキップ
        if (i < len && raw[i] == ',')
            ++i;
    }

    return result;
}

std::string A5ERParser::resolveCardinality(int type1, int type2, bool& needsSwap) {
    auto isMany = [](int t) { return t == 3 || t == 4; };
    auto isOne = [](int t) { return t == 1 || t == 2; };
    needsSwap = false;

    if (isMany(type1) && isMany(type2))
        return "N:M";
    if (isOne(type1) && isMany(type2))
        return "1:N";
    if (isMany(type1) && isOne(type2)) {
        // Entity1 is the Many side → swap parent/child to normalize as 1:N
        needsSwap = true;
        return "1:N";
    }
    if (isOne(type1) && isOne(type2))
        return "1:1";
    return "1:N";
}

A5ERModel A5ERParser::parseTextFormat(const std::string& content) const {
    A5ERModel model;
    std::istringstream stream(content);
    std::string line;

    struct Section {
        std::string type;
        std::vector<std::string> lines;
    };

    std::vector<Section> sections;
    std::string currentType;
    std::vector<std::string> currentLines;

    while (std::getline(stream, line)) {
        // Remove trailing \r
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        // セクションヘッダ判定: [Entity], [Relation], [Shape] 等
        if (line.size() >= 3 && line.front() == '[' && line.back() == ']') {
            // 前セクションを保存（新ヘッダが暗黙の区切り）
            if (!currentType.empty() && (currentType == "Entity" || currentType == "Relation" || currentType == "Shape")) {
                sections.push_back({currentType, std::move(currentLines)});
            }
            currentType = line.substr(1, line.size() - 2);
            currentLines.clear();
            continue;
        }

        // 明示的セクション終端（DEL行）
        if (line == "DEL" && !currentType.empty()) {
            if (currentType == "Entity" || currentType == "Relation" || currentType == "Shape") {
                sections.push_back({currentType, std::move(currentLines)});
            }
            currentType.clear();
            currentLines.clear();
            continue;
        }

        if (!currentType.empty()) {
            currentLines.push_back(line);
        }
    }

    // 最終セクション保存（DELなしファイル対応）
    if (!currentType.empty() && (currentType == "Entity" || currentType == "Relation" || currentType == "Shape")) {
        sections.push_back({currentType, std::move(currentLines)});
    }

    // props から値を取得するヘルパー
    auto getProp = [](const std::unordered_map<std::string, std::string>& props, const std::string& key) -> std::string {
        auto it = props.find(key);
        return it != props.end() ? it->second : "";
    };

    auto getPropInt = [&getProp](const std::unordered_map<std::string, std::string>& props, const std::string& key) -> int {
        auto val = getProp(props, key);
        int result = 0;
        if (!val.empty()) {
            std::from_chars(val.data(), val.data() + val.size(), result);
        }
        return result;
    };

    auto getPropDouble = [&getProp](const std::unordered_map<std::string, std::string>& props, const std::string& key) -> double {
        auto val = getProp(props, key);
        if (val.empty())
            return 0.0;
        double result = 0.0;
        std::from_chars(val.data(), val.data() + val.size(), result);
        return result;
    };

    // セクション解析
    for (const auto& section : sections) {
        if (section.type == "Entity") {
            A5ERTable table{};
            std::unordered_map<std::string, std::string> props;

            for (const auto& sline : section.lines) {
                if (sline.starts_with("Field=")) {
                    auto parts = parseQuotedCSV(sline.substr(6));
                    A5ERColumn col{};
                    if (!parts.empty())
                        col.name = parts[0];
                    if (parts.size() > 1)
                        col.logicalName = parts[1];
                    if (parts.size() > 2)
                        col.type = parts[2];
                    if (parts.size() > 3)
                        col.nullable = (parts[3] != "NOT NULL");
                    if (parts.size() > 4) {
                        // A5:ER Field[4]: PK順序。数値(0,1,...)=PK、空文字=非PK
                        col.isPrimaryKey = !parts[4].empty();
                    }
                    if (parts.size() > 5)
                        col.defaultValue = a5er::unescape(parts[5]);
                    if (parts.size() > 6)
                        col.comment = a5er::unescape(parts[6]);
                    // Field[7]: column color ($AABBGGRR format)
                    if (parts.size() > 7)
                        col.color = parts[7];
                    col.size = 0;
                    col.scale = 0;
                    table.columns.push_back(std::move(col));
                } else if (sline.starts_with("Index=")) {
                    auto raw = sline.substr(6);
                    auto eqPos = raw.find('=');
                    if (eqPos != std::string::npos) {
                        A5ERIndex idx{};
                        idx.name = raw.substr(0, eqPos);
                        auto rest = raw.substr(eqPos + 1);
                        std::istringstream iss(rest);
                        std::string part;
                        bool first = true;
                        while (std::getline(iss, part, ',')) {
                            if (first) {
                                idx.isUnique = (part == "1");
                                first = false;
                            } else {
                                idx.columns.push_back(part);
                            }
                        }
                        table.indexes.push_back(std::move(idx));
                    }
                } else {
                    auto eqPos = sline.find('=');
                    if (eqPos != std::string::npos) {
                        props[sline.substr(0, eqPos)] = sline.substr(eqPos + 1);
                    }
                }
            }

            table.name = getProp(props, "PName");
            table.logicalName = getProp(props, "LName");
            table.comment = getProp(props, "Comment");
            table.page = getProp(props, "Page");
            table.posX = getPropDouble(props, "Left");
            table.posY = getPropDouble(props, "Top");
            table.color = getProp(props, "Color");
            table.bkColor = getProp(props, "BkColor");

            model.tables.push_back(std::move(table));
        } else if (section.type == "Relation") {
            std::unordered_map<std::string, std::string> props;
            for (const auto& sline : section.lines) {
                auto eqPos = sline.find('=');
                if (eqPos != std::string::npos) {
                    props[sline.substr(0, eqPos)] = sline.substr(eqPos + 1);
                }
            }

            A5ERRelation rel{};
            rel.parentTable = getProp(props, "Entity1");
            rel.childTable = getProp(props, "Entity2");
            rel.parentColumn = getProp(props, "Fields1");
            rel.childColumn = getProp(props, "Fields2");
            rel.name = rel.parentTable + "_" + rel.childTable;

            int type1 = getPropInt(props, "RelationType1");
            int type2 = getPropInt(props, "RelationType2");
            bool needsSwap = false;
            rel.cardinality = resolveCardinality(type1, type2, needsSwap);
            if (needsSwap) {
                std::swap(rel.parentTable, rel.childTable);
                std::swap(rel.parentColumn, rel.childColumn);
                rel.name = rel.parentTable + "_" + rel.childTable;
            }

            model.relations.push_back(std::move(rel));
        } else if (section.type == "Shape") {
            std::unordered_map<std::string, std::string> props;
            for (const auto& sline : section.lines) {
                auto eqPos = sline.find('=');
                if (eqPos != std::string::npos) {
                    props[sline.substr(0, eqPos)] = sline.substr(eqPos + 1);
                }
            }

            A5ERShape shape{};
            shape.shapeType = getProp(props, "ShapeType");
            shape.text = a5er::unescape(getProp(props, "Text"));
            shape.brushColor = getProp(props, "BrushColor");
            shape.fontColor = getProp(props, "FontColor");
            shape.brushAlpha = getPropInt(props, "BrushAlpha");
            if (shape.brushAlpha == 0 && getProp(props, "BrushAlpha").empty()) {
                shape.brushAlpha = 255;
            }
            shape.fontSize = getPropInt(props, "FontSize");
            if (shape.fontSize == 0)
                shape.fontSize = 9;
            shape.left = getPropDouble(props, "Left");
            shape.top = getPropDouble(props, "Top");
            shape.width = getPropDouble(props, "Width");
            shape.height = getPropDouble(props, "Height");
            shape.page = getProp(props, "Page");

            model.shapes.push_back(std::move(shape));
        }
    }

    return model;
}

std::string A5ERParser::generateA5ERDDL(const A5ERModel& model, const std::string& targetDatabase) const {
    std::ostringstream ddl;

    ddl << "-- Generated from A5:ER model: " << model.name << "\n";
    ddl << "-- Target database: " << targetDatabase << "\n\n";

    // Generate table DDLs
    for (const auto& table : model.tables) {
        ddl << generateTableDDL(table, targetDatabase) << "\n\n";
    }

    // Generate foreign keys
    for (const auto& rel : model.relations) {
        ddl << "ALTER TABLE " << bracketEscape(rel.childTable) << "\n";
        ddl << "ADD CONSTRAINT " << bracketEscape("FK_" + rel.childTable + "_" + rel.parentTable) << "\n";
        ddl << "FOREIGN KEY (" << bracketEscape(rel.childColumn) << ")\n";
        ddl << "REFERENCES " << bracketEscape(rel.parentTable) << " (" << bracketEscape(rel.parentColumn) << ");\n\n";
    }

    return ddl.str();
}

std::string A5ERParser::generateTableDDL(const A5ERTable& table, const std::string& /*targetDatabase*/) const {
    std::ostringstream ddl;

    if (!table.comment.empty()) {
        ddl << "-- " << table.comment << "\n";
    }

    ddl << "CREATE TABLE " << bracketEscape(table.name) << " (\n";

    std::vector<std::string> pkColumns;

    for (size_t i = 0; i < table.columns.size(); ++i) {
        const auto& col = table.columns[i];

        ddl << "    " << bracketEscape(col.name) << " ";
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

        if (i + 1 < table.columns.size() || !pkColumns.empty()) {
            ddl << ",";
        }

        if (!col.comment.empty()) {
            ddl << " -- " << col.comment;
        }

        ddl << "\n";
    }

    // Primary key constraint
    if (!pkColumns.empty()) {
        ddl << "    CONSTRAINT " << bracketEscape("PK_" + table.name) << " PRIMARY KEY (";
        for (size_t i = 0; i < pkColumns.size(); ++i) {
            ddl << bracketEscape(pkColumns[i]);
            if (i + 1 < pkColumns.size()) {
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
        ddl << "INDEX " << bracketEscape(idx.name) << " ON " << bracketEscape(table.name) << " (";
        for (size_t i = 0; i < idx.columns.size(); ++i) {
            ddl << bracketEscape(idx.columns[i]);
            if (i + 1 < idx.columns.size()) {
                ddl << ", ";
            }
        }
        ddl << ");";
    }

    return ddl.str();
}

std::string A5ERParser::mapTypeToSQLServer(const std::string& a5erType, int size, int scale) const {
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

}  // namespace velocitydb
