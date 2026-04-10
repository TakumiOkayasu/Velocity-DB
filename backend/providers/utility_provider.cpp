#include "utility_provider.h"

#include "../parsers/er_diagram_parser_factory.h"
#include "../parsers/sql_formatter.h"
#include "../utils/json_utils.h"
#include "interfaces/parsers/er_model.h"
#include "simdjson.h"

#include <format>
#include <fstream>

namespace velocitydb {

namespace {

std::string serializeERModelToJson(const ERModel& model, const std::string& ddl = "") {
    auto tablesJson = JsonUtils::buildArray(model.tables, [](std::string& out, const auto& table) {
        auto columnsJson = JsonUtils::buildArray(table.columns, [](std::string& out, const auto& col) {
            out += std::format(R"({{"name":"{}","logicalName":"{}","type":"{}","size":{},"scale":{},"nullable":{},"isPrimaryKey":{},"defaultValue":"{}","comment":"{}","color":"{}"}})",
                               JsonUtils::escapeString(col.name), JsonUtils::escapeString(col.logicalName), JsonUtils::escapeString(col.type), col.size, col.scale, col.nullable ? "true" : "false",
                               col.isPrimaryKey ? "true" : "false", JsonUtils::escapeString(col.defaultValue), JsonUtils::escapeString(col.comment), JsonUtils::escapeString(col.color));
        });
        auto indexesJson = JsonUtils::buildArray(table.indexes, [](std::string& out, const auto& idx) {
            auto idxColumnsJson = JsonUtils::buildArray(idx.columns, [](std::string& out, const auto& colName) { out += std::format(R"("{}")", JsonUtils::escapeString(colName)); });
            out += std::format(R"({{"name":"{}","columns":{},"isUnique":{}}})", JsonUtils::escapeString(idx.name), idxColumnsJson, idx.isUnique ? "true" : "false");
        });
        out += std::format(R"({{"name":"{}","logicalName":"{}","comment":"{}","page":"{}","columns":{},"indexes":{},"posX":{},"posY":{},"color":"{}","bkColor":"{}"}})",
                           JsonUtils::escapeString(table.name), JsonUtils::escapeString(table.logicalName), JsonUtils::escapeString(table.comment), JsonUtils::escapeString(table.page), columnsJson,
                           indexesJson, table.posX, table.posY, JsonUtils::escapeString(table.color), JsonUtils::escapeString(table.bkColor));
    });

    auto relationsJson = JsonUtils::buildArray(model.relations, [](std::string& out, const auto& rel) {
        out += std::format(R"({{"name":"{}","parentTable":"{}","childTable":"{}","parentColumn":"{}","childColumn":"{}","cardinality":"{}"}})", JsonUtils::escapeString(rel.name),
                           JsonUtils::escapeString(rel.parentTable), JsonUtils::escapeString(rel.childTable), JsonUtils::escapeString(rel.parentColumn), JsonUtils::escapeString(rel.childColumn),
                           JsonUtils::escapeString(rel.cardinality));
    });

    auto shapesJson = JsonUtils::buildArray(model.shapes, [](std::string& out, const auto& shape) {
        out += std::format(R"({{"shapeType":"{}","text":"{}","fillColor":"{}","fontColor":"{}","fillAlpha":{},"fontSize":{},"left":{},"top":{},"width":{},"height":{},"page":"{}"}})",
                           JsonUtils::escapeString(shape.shapeType), JsonUtils::escapeString(shape.text), JsonUtils::escapeString(shape.fillColor), JsonUtils::escapeString(shape.fontColor),
                           shape.fillAlpha, shape.fontSize, shape.left, shape.top, shape.width, shape.height, JsonUtils::escapeString(shape.page));
    });

    return std::format(R"({{"name":"{}","databaseType":"{}","tables":{},"relations":{},"shapes":{},"ddl":"{}"}})", JsonUtils::escapeString(model.name), JsonUtils::escapeString(model.databaseType),
                       tablesJson, relationsJson, shapesJson, JsonUtils::escapeString(ddl));
}

}  // namespace

UtilityProvider::UtilityProvider() : m_sqlFormatter(std::make_unique<SQLFormatter>()), m_parserFactory(std::make_unique<ERDiagramParserFactory>()) {}

UtilityProvider::~UtilityProvider() = default;
UtilityProvider::UtilityProvider(UtilityProvider&&) noexcept = default;
UtilityProvider& UtilityProvider::operator=(UtilityProvider&&) noexcept = default;

std::string UtilityProvider::uppercaseKeywords(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto sqlResult = doc["sql"].get_string();
        if (sqlResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing sql field");
        }
        std::string sqlQuery = std::string(sqlResult.value());

        auto uppercasedSQL = m_sqlFormatter->uppercaseKeywords(sqlQuery);
        return JsonUtils::successResponse(std::format(R"({{"sql":"{}"}})", JsonUtils::escapeString(uppercasedSQL)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string UtilityProvider::parseERDiagram(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        std::string content;
        std::string filename;

        // Support both content-based and filepath-based parsing
        auto contentResult = doc["content"].get_string();
        if (!contentResult.error()) {
            content = std::string(contentResult.value());
            auto filenameResult = doc["filename"].get_string();
            if (!filenameResult.error()) {
                filename = std::string(filenameResult.value());
            }
        } else {
            auto filepathResult = doc["filepath"].get_string();
            if (filepathResult.error()) [[unlikely]] {
                return JsonUtils::errorResponse("Missing content or filepath field");
            }
            auto filepath = std::string(filepathResult.value());

            // Validate: reject paths with traversal patterns
            if (filepath.find("..") != std::string::npos) [[unlikely]] {
                return JsonUtils::errorResponse("Invalid file path");
            }

            // Extract filename from full path for parser dispatch and model name
            auto lastSlash = filepath.find_last_of("/\\");
            filename = (lastSlash != std::string::npos) ? filepath.substr(lastSlash + 1) : filepath;

            std::ifstream file(filepath);
            if (!file.is_open()) {
                return JsonUtils::errorResponse("Failed to open file: " + filepath);
            }
            content = std::string((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        }

        auto [model, ddl] = m_parserFactory->parseWithDDL(content, filename);
        if (model.name.empty() && !filename.empty()) {
            model.name = filename;
        }

        return JsonUtils::successResponse(serializeERModelToJson(model, ddl));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
