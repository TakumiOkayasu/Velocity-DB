#include "schema_provider.h"

#include "../database/connection_utils.h"
#include "../database/driver_interface.h"
#include "../interfaces/ddl_queryable.h"
#include "../interfaces/providers/connection_provider.h"
#include "../interfaces/relation_queryable.h"
#include "../interfaces/schema_queryable.h"
#include "../interfaces/sql_formattable.h"
#include "../utils/json_utils.h"
#include "../utils/logger.h"
#include "../utils/sql_validation.h"
#include "simdjson.h"

#include <charconv>
#include <format>
#include <ranges>

namespace velocitydb {

namespace {

[[nodiscard]] std::string splitCsvToJsonArray(std::string_view csv) {
    if (csv.empty())
        return "[]";
    std::string result = "[";
    bool first = true;
    for (auto part : csv | std::views::split(',')) {
        if (!first)
            result += ',';
        result += std::format("\"{}\"", JsonUtils::escapeString({part.begin(), part.end()}));
        first = false;
    }
    result += "]";
    return result;
}

struct TableQueryParams {
    std::string schema;
    std::string table;
    std::shared_ptr<IDatabaseDriver> driver;
    DriverType driverType;
    std::unique_ptr<ISqlFormattable> formatter;
};

[[nodiscard]] std::expected<TableQueryParams, std::string> extractTableQueryParams(const simdjson::dom::element& doc, IConnectionProvider& connections) {
    auto connectionIdResult = doc["connectionId"].get_string();
    auto tableNameResult = doc["table"].get_string();
    if (connectionIdResult.error() || tableNameResult.error()) [[unlikely]]
        return std::unexpected("Missing required fields: connectionId or table");

    std::string_view tableName = tableNameResult.value();
    if (!isValidIdentifier(tableName)) [[unlikely]]
        return std::unexpected("Invalid table name");

    std::string_view connectionId = connectionIdResult.value();
    auto driver = connections.getMetadataDriver(connectionId);
    if (!driver) [[unlikely]]
        return std::unexpected(std::format("Connection not found: {}", connectionId));

    auto driverType = connections.getDriverType(connectionId);
    auto formatter = DriverFactory::createSqlFormattable(driverType);
    auto [schema, tbl] = splitSchemaTable(tableName, formatter->defaultSchema());

    return TableQueryParams{std::move(schema), std::move(tbl), std::move(driver), driverType, std::move(formatter)};
}

}  // namespace

SchemaProvider::SchemaProvider(IConnectionProvider& connections) : m_connections(connections) {}

SchemaProvider::~SchemaProvider() = default;

std::optional<std::string> SchemaProvider::getCached(const std::string& key) {
    std::lock_guard lock(m_cacheMutex);
    if (auto it = m_schemaCache.find(key); it != m_schemaCache.end()) {
        if (std::chrono::steady_clock::now() - it->second.timestamp < SCHEMA_CACHE_TTL) {
            return it->second.response;
        }
        m_schemaCache.erase(it);
    }
    return std::nullopt;
}

void SchemaProvider::putCache(const std::string& key, const std::string& response) {
    std::lock_guard lock(m_cacheMutex);
    m_schemaCache[key] = {response, std::chrono::steady_clock::now()};
}

std::string SchemaProvider::clearSchemaCache(std::string_view) {
    std::lock_guard lock(m_cacheMutex);
    m_schemaCache.clear();
    return JsonUtils::successResponse(R"({"cleared":true})");
}

std::string SchemaProvider::getDatabases(std::string_view params) {
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }
    try {
        auto driver = m_connections.getMetadataDriver(*connectionIdResult);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", *connectionIdResult));
        }
        auto driverType = m_connections.getDriverType(*connectionIdResult);
        auto dialect = DriverFactory::createSchemaQueryable(driverType);
        auto sql = dialect->getDatabasesQuery();
        auto queryResult = driver->execute(sql);
        auto jsonResponse = JsonUtils::buildRowArray(queryResult.rows, 1, [](std::string& out, const ResultRow& row) { out += std::format(R"("{}")", JsonUtils::escapeString(row.values[0])); });
        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getTables(std::string_view params) {
    log<LogLevel::DEBUG>(std::format("SchemaProvider::getTables called with params: {}", params));
    auto cacheKey = "getTables:" + std::string(params);
    if (auto cached = getCached(cacheKey)) {
        return *cached;
    }
    auto connectionIdResult = extractConnectionId(params);
    if (!connectionIdResult) {
        return JsonUtils::errorResponse(connectionIdResult.error());
    }
    auto connectionId = *connectionIdResult;
    try {
        auto driver = m_connections.getMetadataDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }
        auto driverType = m_connections.getDriverType(connectionId);
        auto dialect = DriverFactory::createSchemaQueryable(driverType);
        auto sql = dialect->getTablesQuery();
        auto queryResult = driver->execute(sql);
        auto jsonResponse = JsonUtils::buildRowArray(queryResult.rows, 3, [](std::string& out, const ResultRow& row) {
            auto comment = row.values.size() >= 4 ? row.values[3] : std::string{};
            out += std::format(R"({{"schema":"{}","name":"{}","type":"{}","comment":"{}"}})", JsonUtils::escapeString(row.values[0]), JsonUtils::escapeString(row.values[1]),
                               JsonUtils::escapeString(row.values[2]), JsonUtils::escapeString(comment));
        });
        auto result = JsonUtils::successResponse(jsonResponse);
        putCache(cacheKey, result);
        return result;
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getColumns(std::string_view params) {
    auto cacheKey = "getColumns:" + std::string(params);
    if (auto cached = getCached(cacheKey)) {
        return *cached;
    }
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params).value();

        auto extracted = extractTableQueryParams(doc, m_connections);
        if (!extracted) [[unlikely]]
            return JsonUtils::errorResponse(extracted.error());

        auto& [schema, tbl, driver, driverType, formatter] = *extracted;

        auto dialect = DriverFactory::createSchemaQueryable(driverType);
        auto sql = dialect->getColumnsQuery(schema, tbl);
        auto columnResult = driver->execute(sql);

        auto jsonResponse = JsonUtils::buildRowArray(columnResult.rows, 5, [](std::string& out, const ResultRow& row) {
            std::string_view sizeStr = row.values[2];
            int colSize = 0;
            std::from_chars(sizeStr.data(), sizeStr.data() + sizeStr.size(), colSize);
            auto comment = row.values.size() >= 6 ? row.values[5] : std::string{};
            auto nullable = row.values[3] == "1" ? "true" : "false";
            auto isPk = row.values[4] == "1" ? "true" : "false";
            out += std::format(R"({{"name":"{}","type":"{}","size":{},"nullable":{},"isPrimaryKey":{},"comment":"{}"}})", JsonUtils::escapeString(row.values[0]),
                               JsonUtils::escapeString(row.values[1]), colSize, nullable, isPk, JsonUtils::escapeString(comment));
        });
        auto result = JsonUtils::successResponse(jsonResponse);
        putCache(cacheKey, result);
        return result;
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getIndexes(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params).value();

        auto extracted = extractTableQueryParams(doc, m_connections);
        if (!extracted) [[unlikely]]
            return JsonUtils::errorResponse(extracted.error());

        auto& [schema, tbl, driver, driverType, formatter] = *extracted;

        auto dialect = DriverFactory::createRelationQueryable(driverType);
        auto sql = dialect->getIndexesQuery(schema, tbl);
        auto queryResult = driver->execute(sql);

        auto json = JsonUtils::buildRowArray(queryResult.rows, 5, [](std::string& out, const ResultRow& row) {
            out += "{";
            out += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            out += std::format("\"type\":\"{}\",", JsonUtils::escapeString(row.values[1]));
            out += std::format("\"isUnique\":{},", row.values[2] == "1" ? "true" : "false");
            out += std::format("\"isPrimaryKey\":{},", row.values[3] == "1" ? "true" : "false");
            out += "\"columns\":";
            out += splitCsvToJsonArray(row.values[4]);
            out += "}";
        });
        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getConstraints(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params).value();

        auto extracted = extractTableQueryParams(doc, m_connections);
        if (!extracted) [[unlikely]]
            return JsonUtils::errorResponse(extracted.error());

        auto& [schema, tbl, driver, driverType, formatter] = *extracted;

        auto dialect = DriverFactory::createRelationQueryable(driverType);
        auto sql = dialect->getConstraintsQuery(schema, tbl);
        auto queryResult = driver->execute(sql);

        auto json = JsonUtils::buildRowArray(queryResult.rows, 4, [](std::string& out, const ResultRow& row) {
            out += "{";
            out += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            out += std::format("\"type\":\"{}\",", JsonUtils::escapeString(row.values[1]));
            out += "\"columns\":";
            out += splitCsvToJsonArray(row.values[2]);
            out += ",";
            out += std::format("\"definition\":\"{}\"", JsonUtils::escapeString(row.values[3]));
            out += "}";
        });
        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getForeignKeys(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params).value();

        auto extracted = extractTableQueryParams(doc, m_connections);
        if (!extracted) [[unlikely]]
            return JsonUtils::errorResponse(extracted.error());

        auto& [schema, tbl, driver, driverType, formatter] = *extracted;

        auto dialect = DriverFactory::createRelationQueryable(driverType);
        auto sql = dialect->getForeignKeysQuery(schema, tbl);
        auto queryResult = driver->execute(sql);

        auto json = JsonUtils::buildRowArray(queryResult.rows, 6, [](std::string& out, const ResultRow& row) {
            out += "{";
            out += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            out += "\"columns\":";
            out += splitCsvToJsonArray(row.values[1]);
            out += ",";
            out += std::format("\"referencedTable\":\"{}\",", JsonUtils::escapeString(row.values[2]));
            out += "\"referencedColumns\":";
            out += splitCsvToJsonArray(row.values[3]);
            out += ",";
            out += std::format("\"onDelete\":\"{}\",", JsonUtils::escapeString(row.values[4]));
            out += std::format("\"onUpdate\":\"{}\"", JsonUtils::escapeString(row.values[5]));
            out += "}";
        });
        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getReferencingForeignKeys(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params).value();

        auto extracted = extractTableQueryParams(doc, m_connections);
        if (!extracted) [[unlikely]]
            return JsonUtils::errorResponse(extracted.error());

        auto& [schema, tbl, driver, driverType, formatter] = *extracted;

        auto dialect = DriverFactory::createRelationQueryable(driverType);
        auto sql = dialect->getReferencingForeignKeysQuery(schema, tbl);
        auto queryResult = driver->execute(sql);

        auto json = JsonUtils::buildRowArray(queryResult.rows, 6, [](std::string& out, const ResultRow& row) {
            out += "{";
            out += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            out += std::format("\"referencingTable\":\"{}\",", JsonUtils::escapeString(row.values[1]));
            out += "\"referencingColumns\":";
            out += splitCsvToJsonArray(row.values[2]);
            out += ",";
            out += "\"columns\":";
            out += splitCsvToJsonArray(row.values[3]);
            out += ",";
            out += std::format("\"onDelete\":\"{}\",", JsonUtils::escapeString(row.values[4]));
            out += std::format("\"onUpdate\":\"{}\"", JsonUtils::escapeString(row.values[5]));
            out += "}";
        });
        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getTriggers(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params).value();

        auto extracted = extractTableQueryParams(doc, m_connections);
        if (!extracted) [[unlikely]]
            return JsonUtils::errorResponse(extracted.error());

        auto& [schema, tbl, driver, driverType, formatter] = *extracted;

        auto dialect = DriverFactory::createRelationQueryable(driverType);
        auto sql = dialect->getTriggersQuery(schema, tbl);
        auto queryResult = driver->execute(sql);

        auto json = JsonUtils::buildRowArray(queryResult.rows, 5, [](std::string& out, const ResultRow& row) {
            out += "{";
            out += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[0]));
            out += std::format("\"type\":\"{}\",", JsonUtils::escapeString(row.values[1]));
            out += "\"events\":";
            out += splitCsvToJsonArray(row.values[2]);
            out += ",";
            out += std::format("\"isEnabled\":{},", row.values[3] == "1" ? "true" : "false");
            out += std::format("\"definition\":\"{}\"", JsonUtils::escapeString(row.values[4]));
            out += "}";
        });
        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getTableMetadata(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params).value();

        auto extracted = extractTableQueryParams(doc, m_connections);
        if (!extracted) [[unlikely]]
            return JsonUtils::errorResponse(extracted.error());

        auto& [schema, tbl, driver, driverType, formatter] = *extracted;

        auto dialect = DriverFactory::createSchemaQueryable(driverType);
        auto sql = dialect->getTableMetadataQuery(schema, tbl);
        auto queryResult = driver->execute(sql);

        if (queryResult.rows.empty()) {
            return JsonUtils::errorResponse("Table not found");
        }

        const auto& row = queryResult.rows[0];
        if (row.values.size() < 8) {
            return JsonUtils::errorResponse("Unexpected column count in metadata result");
        }
        std::string json = "{";
        json += std::format("\"schema\":\"{}\",", JsonUtils::escapeString(row.values[0]));
        json += std::format("\"name\":\"{}\",", JsonUtils::escapeString(row.values[1]));
        json += std::format("\"type\":\"{}\",", JsonUtils::escapeString(row.values[2]));
        json += std::format("\"rowCount\":{},", row.values[3]);
        json += std::format("\"createdAt\":\"{}\",", JsonUtils::escapeString(row.values[4]));
        json += std::format("\"modifiedAt\":\"{}\",", JsonUtils::escapeString(row.values[5]));
        json += std::format("\"owner\":\"{}\",", JsonUtils::escapeString(row.values[6]));
        json += std::format("\"comment\":\"{}\"", JsonUtils::escapeString(row.values[7]));
        json += "}";
        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getTableDDL(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params).value();

        auto extracted = extractTableQueryParams(doc, m_connections);
        if (!extracted) [[unlikely]]
            return JsonUtils::errorResponse(extracted.error());

        auto& [schema, tbl, driver, driverType, formatter] = *extracted;

        auto dialect = DriverFactory::createDDLQueryable(driverType);
        auto columnQuery = dialect->getDDLColumnsQuery(schema, tbl);
        auto columnResult = driver->execute(columnQuery);

        auto qualifiedName = schema + "." + tbl;
        auto sanitizedTable = formatter->quoteIdentifier(qualifiedName);
        std::string ddl = "CREATE TABLE " + sanitizedTable + " (\n";
        bool first = true;
        for (const auto& row : columnResult.rows) {
            if (row.values.size() < 7)
                continue;
            if (!first)
                ddl += ",\n";
            first = false;
            ddl += "    " + formatter->quoteIdentifier(row.values[0]) + " " + row.values[1];
            if (!row.values[2].empty() && row.values[2] != "-1") {
                ddl += "(" + row.values[2] + ")";
            } else if (!row.values[3].empty() && row.values[3] != "0") {
                ddl += "(" + row.values[3];
                if (!row.values[4].empty() && row.values[4] != "0")
                    ddl += "," + row.values[4];
                ddl += ")";
            }
            if (row.values[5] == "NO")
                ddl += " NOT NULL";
            if (!row.values[6].empty())
                ddl += " DEFAULT " + row.values[6];
        }

        auto pkQuery = dialect->getDDLPrimaryKeyQuery(schema, tbl);
        auto pkResult = driver->execute(pkQuery);
        if (!pkResult.rows.empty()) {
            ddl += ",\n    PRIMARY KEY (";
            bool pkFirst = true;
            for (const auto& row : pkResult.rows) {
                if (row.values.empty())
                    continue;
                if (!pkFirst)
                    ddl += ", ";
                pkFirst = false;
                ddl += formatter->quoteIdentifier(row.values[0]);
            }
            ddl += ")";
        }
        ddl += "\n);";

        return JsonUtils::successResponse(std::format("{{\"ddl\":\"{}\"}}", JsonUtils::escapeString(ddl)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SchemaProvider::getExecutionPlan(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        std::string_view connectionId = connectionIdResult.value();
        std::string_view sqlQuery = sqlQueryResult.value();
        bool actualPlan = false;
        if (auto actual = doc["actual"].get_bool(); !actual.error())
            actualPlan = actual.value();

        auto driver = m_connections.getQueryDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto driverType = m_connections.getDriverType(connectionId);
        auto dialect = DriverFactory::createDDLQueryable(driverType);
        auto planQuery = dialect->getExecutionPlanQuery(sqlQuery, actualPlan);
        auto queryResult = driver->execute(planQuery);

        std::string planText;
        for (const auto& row : queryResult.rows) {
            for (const auto& value : row.values) {
                if (!planText.empty())
                    planText += "\n";
                planText += value;
            }
        }

        auto planJson = std::format(R"({{"plan":"{}","actual":{}}})", JsonUtils::escapeString(planText), actualPlan ? "true" : "false");
        return JsonUtils::successResponse(planJson);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
