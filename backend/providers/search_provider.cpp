#include "search_provider.h"

#include "../database/driver_interface.h"
#include "../interfaces/object_searchable.h"
#include "../interfaces/providers/connection_provider.h"
#include "../search/global_search.h"
#include "../utils/json_utils.h"
#include "simdjson.h"

#include <format>

namespace velocitydb {

SearchProvider::SearchProvider(IConnectionProvider& connections) : m_connections(connections), m_globalSearch(std::make_unique<GlobalSearch>()) {}

SearchProvider::~SearchProvider() = default;

std::string SearchProvider::searchObjects(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto patternResult = doc["pattern"].get_string();
        if (connectionIdResult.error() || patternResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or pattern");
        }
        std::string_view connectionId = connectionIdResult.value();
        auto pattern = std::string(patternResult.value());

        auto driver = m_connections.getMetadataDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto driverType = m_connections.getDriverType(connectionId);
        auto dialect = DriverFactory::createObjectSearchable(driverType);

        SearchOptions options{};
        if (auto val = doc["searchTables"].get_bool(); !val.error())
            options.searchTables = val.value();
        if (auto val = doc["searchViews"].get_bool(); !val.error())
            options.searchViews = val.value();
        if (auto val = doc["searchProcedures"].get_bool(); !val.error())
            options.searchProcedures = val.value();
        if (auto val = doc["searchFunctions"].get_bool(); !val.error())
            options.searchFunctions = val.value();
        if (auto val = doc["searchColumns"].get_bool(); !val.error())
            options.searchColumns = val.value();
        if (auto val = doc["caseSensitive"].get_bool(); !val.error())
            options.caseSensitive = val.value();
        if (auto val = doc["maxResults"].get_int64(); !val.error())
            options.maxResults = static_cast<int>(val.value());

        auto results = m_globalSearch->searchObjects(driver.get(), dialect.get(), pattern, options);

        auto json = JsonUtils::buildArray(results, [](std::string& out, const SearchResult& r) {
            out += std::format(R"({{"objectType":"{}","schemaName":"{}","objectName":"{}","parentName":"{}"}})", JsonUtils::escapeString(r.objectType), JsonUtils::escapeString(r.schemaName),
                               JsonUtils::escapeString(r.objectName), JsonUtils::escapeString(r.parentName));
        });

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SearchProvider::quickSearch(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto prefixResult = doc["prefix"].get_string();
        if (connectionIdResult.error() || prefixResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or prefix");
        }
        std::string_view connectionId = connectionIdResult.value();
        auto prefix = std::string(prefixResult.value());
        int limit = 20;
        if (auto val = doc["limit"].get_int64(); !val.error())
            limit = static_cast<int>(val.value());

        auto driver = m_connections.getMetadataDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        auto driverType = m_connections.getDriverType(connectionId);
        auto dialect = DriverFactory::createObjectSearchable(driverType);

        auto results = m_globalSearch->quickSearch(driver.get(), dialect.get(), prefix, limit);

        auto json = JsonUtils::buildArray(results, [](std::string& out, const std::string& r) { out += std::format(R"("{}")", JsonUtils::escapeString(r)); });

        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
