#include <gtest/gtest.h>

#include "providers/lint_provider.h"
#include "simdjson.h"

namespace velocitydb {
namespace {

class LintProviderTest : public ::testing::Test {
protected:
    LintProvider provider;

    [[nodiscard]] static simdjson::dom::element parseJson(simdjson::padded_string_view json) {
        thread_local simdjson::dom::parser p;
        return p.parse(json).value();
    }
};

TEST_F(LintProviderTest, InvalidJsonReturnsError) {
    auto response = provider.lintSql("not json");
    simdjson::padded_string padded(response);
    auto doc = parseJson(padded);
    EXPECT_FALSE(doc["success"].get_bool().value());
    std::string_view errMsg = doc["error"].get_string().value();
    EXPECT_NE(errMsg.find("Invalid JSON"), std::string_view::npos);
}

TEST_F(LintProviderTest, MissingSqlFieldReturnsError) {
    auto response = provider.lintSql(R"({"dbType":"sqlserver"})");
    simdjson::padded_string padded(response);
    auto doc = parseJson(padded);
    EXPECT_FALSE(doc["success"].get_bool().value());
    std::string_view errMsg = doc["error"].get_string().value();
    EXPECT_NE(errMsg.find("'sql'"), std::string_view::npos);
}

TEST_F(LintProviderTest, MissingDbTypeFieldReturnsError) {
    auto response = provider.lintSql(R"({"sql":"SELECT 1"})");
    simdjson::padded_string padded(response);
    auto doc = parseJson(padded);
    EXPECT_FALSE(doc["success"].get_bool().value());
    std::string_view errMsg = doc["error"].get_string().value();
    EXPECT_NE(errMsg.find("'dbType'"), std::string_view::npos);
}

TEST_F(LintProviderTest, UnsupportedDbTypeReturnsError) {
    auto response = provider.lintSql(R"({"sql":"SELECT 1","dbType":"oracle"})");
    simdjson::padded_string padded(response);
    auto doc = parseJson(padded);
    EXPECT_FALSE(doc["success"].get_bool().value());
    std::string_view errMsg = doc["error"].get_string().value();
    EXPECT_NE(errMsg.find("Unsupported dbType"), std::string_view::npos);
}

TEST_F(LintProviderTest, FailOpenContractReturnsSuccessRegardlessOfBinary) {
    // Fail-open contract: whether the binary exists (empty diagnostics for valid SQL)
    // or is missing (lintUnavailable:true), the response is always success:true with
    // a diagnostics array. Never success:false for valid-shape input.
    auto response = provider.lintSql(R"({"sql":"SELECT 1","dbType":"sqlserver"})");
    simdjson::padded_string padded(response);
    auto doc = parseJson(padded);
    EXPECT_TRUE(doc["success"].get_bool().value());
    EXPECT_FALSE(doc["data"]["diagnostics"].get_array().error());
}

}  // namespace
}  // namespace velocitydb
