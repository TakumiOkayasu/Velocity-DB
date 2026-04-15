#include "lint_provider.h"

#include "../parsers/sql_linter.h"
#include "../utils/json_utils.h"
#include "../utils/logger.h"
#include "simdjson.h"

#include <format>

namespace velocitydb {

namespace {

[[nodiscard]] std::string serializeDiagnostics(const std::vector<LintDiagnostic>& diags, bool lintUnavailable, std::string_view unavailableReason) {
    auto arr = JsonUtils::buildArray(diags, [](std::string& out, const auto& d) {
        out += std::format(R"({{"line":{},"column":{},"code":"{}","message":"{}"}})", d.line, d.column, JsonUtils::escapeString(d.code), JsonUtils::escapeString(d.message));
    });
    std::string payload;
    payload.reserve(arr.size() + 64);
    payload += R"({"diagnostics":)";
    payload += arr;
    if (lintUnavailable) {
        payload += R"(,"lintUnavailable":true,"reason":")";
        payload += JsonUtils::escapeString(unavailableReason);
        payload += '"';
    }
    payload += '}';
    return JsonUtils::successResponse(payload);
}

}  // namespace

LintProvider::LintProvider() = default;

std::string LintProvider::lintSql(std::string_view params) {
    thread_local static simdjson::dom::parser parser;
    auto doc = parser.parse(params.data(), params.size(), false);
    if (doc.error())
        return JsonUtils::errorResponse("Invalid JSON params");

    auto sqlRes = doc["sql"].get_string();
    auto dbTypeRes = doc["dbType"].get_string();
    if (sqlRes.error())
        return JsonUtils::errorResponse("Missing 'sql' field");
    if (dbTypeRes.error())
        return JsonUtils::errorResponse("Missing 'dbType' field");

    std::string_view sql = sqlRes.value();
    std::string dialect = mapDialectToSqruff(dbTypeRes.value());
    if (dialect.empty())
        return JsonUtils::errorResponse(std::format("Unsupported dbType: {}", dbTypeRes.value()));

    SqlLinterConfig cfg{
        .binary = defaultSqruffBinary(),
        .configFile = defaultSqruffConfig(),
        .timeout = std::chrono::milliseconds{5000},
    };

    auto result = lintSqlForParseErrors(cfg, sql, dialect);
    if (!result) {
        // Infrastructure failure: report as lintUnavailable (caller does NOT block execution).
        get_logger().log<LogLevel::WARNING>(std::format("sqruff lint unavailable: {}", result.error().message));
        return serializeDiagnostics({}, true, result.error().message);
    }
    return serializeDiagnostics(*result, false, {});
}

}  // namespace velocitydb
