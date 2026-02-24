#include "async_query_provider.h"

#include "../database/async_query_executor.h"
#include "../database/driver_interface.h"
#include "../interfaces/providers/connection_provider.h"
#include "../utils/json_utils.h"
#include "simdjson.h"

#include <format>

namespace velocitydb {

AsyncQueryProvider::AsyncQueryProvider(IConnectionProvider& connections) : m_connections(connections), m_asyncExecutor(std::make_unique<AsyncQueryExecutor>()) {}

AsyncQueryProvider::~AsyncQueryProvider() = default;

std::string AsyncQueryProvider::handleExecuteAsyncQuery(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto connectionIdResult = doc["connectionId"].get_string();
        auto sqlQueryResult = doc["sql"].get_string();
        if (connectionIdResult.error() || sqlQueryResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: connectionId or sql");
        }
        auto connectionId = std::string(connectionIdResult.value());
        auto sqlQuery = std::string(sqlQueryResult.value());

        auto driver = m_connections.getQueryDriver(connectionId);
        if (!driver) [[unlikely]] {
            return JsonUtils::errorResponse(std::format("Connection not found: {}", connectionId));
        }

        std::string queryId = m_asyncExecutor->submitQuery(driver, sqlQuery);
        return JsonUtils::successResponse(std::format(R"({{"queryId":"{}"}})", queryId));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string AsyncQueryProvider::handleGetAsyncQueryResult(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto queryIdResult = doc["queryId"].get_string();
        if (queryIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: queryId");
        }
        auto queryId = std::string(queryIdResult.value());

        [[maybe_unused]] auto evicted = m_asyncExecutor->evictStaleQueries();

        AsyncQueryResult asyncResult = m_asyncExecutor->getQueryResult(queryId);

        std::string statusStr;
        switch (asyncResult.status) {
            case QueryStatus::Pending:
                statusStr = "pending";
                break;
            case QueryStatus::Running:
                statusStr = "running";
                break;
            case QueryStatus::Completed:
                statusStr = "completed";
                break;
            case QueryStatus::Cancelled:
                statusStr = "cancelled";
                break;
            case QueryStatus::Failed:
                statusStr = "failed";
                break;
        }

        std::string jsonResponse = "{";
        jsonResponse += std::format(R"("queryId":"{}","status":"{}")", asyncResult.queryId, statusStr);

        if (!asyncResult.errorMessage.empty()) {
            jsonResponse += std::format(R"(,"error":"{}")", JsonUtils::escapeString(asyncResult.errorMessage));
        }

        if (asyncResult.multipleResults && !asyncResult.results.empty()) {
            jsonResponse += R"(,"multipleResults":true,"results":[)";
            for (size_t i = 0; i < asyncResult.results.size(); ++i) {
                if (i > 0)
                    jsonResponse += ",";
                const auto& stmtResult = asyncResult.results[i];
                jsonResponse += R"({"statement":")";
                jsonResponse += JsonUtils::escapeString(stmtResult.statement);
                jsonResponse += R"(","data":)";
                jsonResponse += JsonUtils::serializeResultSet(stmtResult.result, false);
                jsonResponse += "}";
            }
            jsonResponse += "]";
        } else if (asyncResult.result.has_value()) {
            jsonResponse += ',';
            JsonUtils::appendResultSetFields(jsonResponse, *asyncResult.result);
        }

        jsonResponse += "}";
        return JsonUtils::successResponse(jsonResponse);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string AsyncQueryProvider::handleCancelAsyncQuery(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto queryIdResult = doc["queryId"].get_string();
        if (queryIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: queryId");
        }
        bool cancelled = m_asyncExecutor->cancelQuery(std::string(queryIdResult.value()));
        return JsonUtils::successResponse(std::format(R"({{"cancelled":{}}})", cancelled ? "true" : "false"));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string AsyncQueryProvider::handleRemoveAsyncQuery(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto queryIdResult = doc["queryId"].get_string();
        if (queryIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: queryId");
        }
        bool removed = m_asyncExecutor->removeQuery(std::string(queryIdResult.value()));
        return JsonUtils::successResponse(std::format(R"({{"removed":{}}})", removed ? "true" : "false"));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string AsyncQueryProvider::handleGetActiveQueries(std::string_view) {
    auto activeIds = m_asyncExecutor->getActiveQueryIds();
    auto jsonResponse = JsonUtils::buildArray(activeIds, [](std::string& out, const std::string& id) { out += std::format(R"("{}")", id); });
    return JsonUtils::successResponse(jsonResponse);
}

}  // namespace velocitydb
