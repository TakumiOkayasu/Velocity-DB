#include "accessors/glaze_meta.h"
#include "accessors/settings_accessor.h"

#include <string>

#include <glaze/glaze.hpp>
#include <gtest/gtest.h>

namespace velocitydb {
namespace {

TEST(GlazeMetaConnectionProfile, PreservesFolderPathAcrossRoundTrip) {
    ConnectionProfile original;
    original.id = "id-1";
    original.name = "Test";
    original.server = "localhost";
    original.database = "db";
    original.folderPath = "Develop";

    std::string json;
    auto write_err = glz::write_json(original, json);
    ASSERT_FALSE(static_cast<bool>(write_err)) << "serialize should succeed";

    EXPECT_NE(json.find(R"("folderPath":"Develop")"), std::string::npos) << "folderPath should be present in serialized JSON: " << json;

    ConnectionProfile decoded;
    auto read_err = glz::read_json(decoded, json);
    ASSERT_FALSE(static_cast<bool>(read_err)) << "deserialize should succeed";

    EXPECT_EQ(decoded.folderPath, "Develop");
    EXPECT_EQ(decoded.name, original.name);
    EXPECT_EQ(decoded.id, original.id);
}

TEST(GlazeMetaConnectionProfile, PreservesFolderPathThroughAppSettingsRoundTrip) {
    // 本番フロー (SettingsAccessor::serializeSettings/deserializeSettings) と同じ
    // AppSettings → connectionProfiles 経由で folderPath が保持されることを確認する。
    AppSettings original;
    ConnectionProfile a;
    a.id = "id-a";
    a.name = "Test";
    a.folderPath = "Develop";
    ConnectionProfile b;
    b.id = "id-b";
    b.name = "Test";
    b.folderPath = "Staging";
    original.connectionProfiles = {a, b};

    std::string json;
    auto write_err = glz::write_json(original, json);
    ASSERT_FALSE(static_cast<bool>(write_err));

    AppSettings decoded;
    auto read_err = glz::read_json(decoded, json);
    ASSERT_FALSE(static_cast<bool>(read_err));

    ASSERT_EQ(decoded.connectionProfiles.size(), 2u);
    EXPECT_EQ(decoded.connectionProfiles[0].folderPath, "Develop");
    EXPECT_EQ(decoded.connectionProfiles[0].id, "id-a");
    EXPECT_EQ(decoded.connectionProfiles[1].folderPath, "Staging");
    EXPECT_EQ(decoded.connectionProfiles[1].id, "id-b");
}

TEST(GlazeMetaConnectionProfile, DefaultsFolderPathToEmptyWhenMissingInJson) {
    // 既存ユーザーの settings.json には folderPath が無い。
    // deserialize 時に欠落フィールドを空文字列にして落ちないこと (後方互換)。
    constexpr auto json = R"({"id":"id-2","name":"Legacy","server":"s","port":1433,
        "database":"d","username":"u","useWindowsAuth":true,"savePassword":false,
        "encryptedPassword":"","isProduction":false,"isReadOnly":false,
        "environment":"development","dbType":"sqlserver",
        "ssh":{"enabled":false,"host":"","port":22,"username":"",
            "authType":"password","encryptedPassword":"","privateKeyPath":"",
            "encryptedKeyPassphrase":""}})";

    ConnectionProfile decoded;
    auto read_err = glz::read_json(decoded, json);
    ASSERT_FALSE(static_cast<bool>(read_err)) << "deserialize should succeed without folderPath";

    EXPECT_EQ(decoded.folderPath, "");
    EXPECT_EQ(decoded.id, "id-2");
}

TEST(GlazeMetaWebViewSettings, PreservesAllOptionsThroughAppSettingsRoundTrip) {
    AppSettings original;
    original.webview = {true, true, true, true};

    std::string json;
    ASSERT_FALSE(static_cast<bool>(glz::write_json(original, json)));
    EXPECT_NE(json.find(R"("webview":)"), std::string::npos);
    EXPECT_EQ(json.find("webviewStartup"), std::string::npos);
    EXPECT_EQ(json.find("webviewRestartRequired"), std::string::npos);

    AppSettings decoded;
    ASSERT_FALSE(static_cast<bool>(glz::read_json(decoded, json)));
    EXPECT_EQ(decoded.webview, original.webview);
}

TEST(GlazeMetaWebViewSettings, MissingSectionAndMissingOptionsKeepDefaults) {
    for (const auto json : {R"({"general":{"language":"ja"}})", R"({"webview":{}})"}) {
        AppSettings decoded;
        ASSERT_FALSE(static_cast<bool>(glz::read_json(decoded, json)));
        EXPECT_EQ(decoded.webview, WebViewSettings{});
    }
    AppSettings partial;
    ASSERT_FALSE(static_cast<bool>(glz::read_json(partial, R"({"webview":{"gpuCompositing":true}})")));
    EXPECT_TRUE(partial.webview.gpuCompositing);
    EXPECT_FALSE(partial.webview.rendererBackgrounding);
    EXPECT_FALSE(partial.webview.cacheEnabled);
    EXPECT_FALSE(partial.webview.openDevToolsOnStartup);
}

}  // namespace
}  // namespace velocitydb
