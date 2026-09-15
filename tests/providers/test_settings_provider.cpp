#include "accessors/session_accessor.h"
#include "accessors/settings_accessor.h"
#include "database/query_history.h"
#include "interfaces/providers/app_settings_accessor.h"
#include "interfaces/providers/connection_profile_accessor.h"
#include "interfaces/providers/session_state_accessor.h"
#include "providers/settings_provider.h"

#include <filesystem>
#include <format>
#include <memory>
#include <random>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

class SettingsProviderTest : public ::testing::Test {
protected:
    void SetUp() override {
        const auto directory = std::format("velocitydb-settings-{}-{}", std::random_device{}(), std::chrono::steady_clock::now().time_since_epoch().count());
        m_directory = std::filesystem::temp_directory_path() / directory;
        m_settingsPath = m_directory / "settings.json";
        auto settingsAccessor = std::make_unique<SettingsAccessor>(m_settingsPath);
        ASSERT_TRUE(settingsAccessor->load().has_value());
        auto sessionAccessor = std::make_unique<SessionAccessor>();
        m_queryHistory = std::make_unique<QueryHistory>(1000);
        provider = std::make_unique<SettingsProvider>(std::move(settingsAccessor), std::move(sessionAccessor), nullptr, *m_queryHistory);
    }

    void TearDown() override {
        provider.reset();
        std::error_code error;
        std::filesystem::remove_all(m_directory, error);
    }

    std::filesystem::path m_directory;
    std::filesystem::path m_settingsPath;

    std::unique_ptr<QueryHistory> m_queryHistory;
    std::unique_ptr<SettingsProvider> provider;
};

TEST_F(SettingsProviderTest, AccessSettingsAccessor) {
    // Verify direct access to SettingsAccessor works
    auto& accessor = provider->settingsAccessor();
    const auto& settings = accessor.getSettings();

    // Default settings should have reasonable values
    EXPECT_GT(settings.editor.fontSize, 0);
    EXPECT_FALSE(settings.editor.fontFamily.empty());
}

TEST_F(SettingsProviderTest, AccessSessionAccessor) {
    // Verify direct access to SessionAccessor works
    auto& accessor = provider->sessionAccessor();
    const auto& state = accessor.getState();

    // Default session state should have reasonable values
    EXPECT_GE(state.windowWidth, 0);
    EXPECT_GE(state.windowHeight, 0);
}

TEST_F(SettingsProviderTest, GetProfilePasswordNotFound) {
    // Non-existent profile should return error JSON
    auto result = provider->getProfilePassword(R"({"id":"non_existent_profile_id"})");
    EXPECT_FALSE(result.empty());
    EXPECT_NE(result.find("error"), std::string::npos);
}

TEST_F(SettingsProviderTest, GetSshPasswordNotFound) {
    // Non-existent profile should return error JSON
    auto result = provider->getSshPassword(R"({"id":"non_existent_profile_id"})");
    EXPECT_FALSE(result.empty());
    EXPECT_NE(result.find("error"), std::string::npos);
}

TEST_F(SettingsProviderTest, DeleteNonExistentProfile) {
    // Deleting non-existent profile should succeed (idempotent)
    auto result = provider->deleteConnectionProfile(R"({"id":"non_existent_profile_id"})");
    EXPECT_FALSE(result.empty());
}

TEST_F(SettingsProviderTest, UpdateSettingsAppliesMaxQueryHistoryToInstance) {
    // Issue #426: settings.maxQueryHistory の変更が wired QueryHistory に伝播することを検証する。
    for (int i = 0; i < 20; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        // 全て非 favorite (eviction 対象)
        m_queryHistory->add(item);
    }
    ASSERT_EQ(m_queryHistory->getAll().size(), 20);

    auto result = provider->updateSettings(R"({"general":{"maxQueryHistory":5}})");

    EXPECT_NE(result.find("\"saved\""), std::string::npos);
    EXPECT_EQ(m_queryHistory->getAll().size(), 5u);
}

TEST_F(SettingsProviderTest, ConstructionAppliesLoadedMaxToInstance) {
    // SettingsProvider 構築時点の settings.maxQueryHistory が wire された QueryHistory に
    // 即時反映されることを検証する (load 済み設定が新規 instance に適用される保証)。
    // 1) fixture の provider 経由で settings を maxQueryHistory=3 に変更し disk に永続化。
    auto updateResult = provider->updateSettings(R"({"general":{"maxQueryHistory":3}})");
    ASSERT_NE(updateResult.find("\"saved\""), std::string::npos);

    // 2) 別の SettingsAccessor を新規 load (disk から maxQueryHistory=3 を取得)。
    auto freshSettings = std::make_unique<SettingsAccessor>(m_settingsPath);
    (void)freshSettings->load();
    auto freshSession = std::make_unique<SessionAccessor>();
    ASSERT_EQ(freshSettings->getSettings().general.maxQueryHistory, 3);

    // 3) ローカル QueryHistory は上限 1000 で 10 件保持。
    QueryHistory localHistory{1000};
    for (int i = 0; i < 10; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        localHistory.add(item);
    }
    ASSERT_EQ(localHistory.getAll().size(), 10);

    // 4) 新規 SettingsProvider を構築 → ctor 内で applyMaxQueryHistoryToInstance(3) 呼出 → 3 件に縮小。
    SettingsProvider freshProvider{std::move(freshSettings), std::move(freshSession), nullptr, localHistory};

    EXPECT_EQ(localHistory.getAll().size(), 3u);
}

TEST_F(SettingsProviderTest, MissingSavedPasswordAndDecryptionFailureAreDistinct) {
    ConnectionProfile profile;
    profile.id = "p";
    provider->settingsAccessor().addConnectionProfile(profile);
    EXPECT_EQ(provider->settingsAccessor().getProfilePassword("p"), "");
    profile.encryptedPassword = "not valid base64!";
    provider->settingsAccessor().updateConnectionProfile(profile);
    const auto result = provider->getProfilePassword(R"({"id":"p"})");
    EXPECT_NE(result.find("\"success\":false"), std::string::npos);
    EXPECT_EQ(result.find("\"password\""), std::string::npos);
}

TEST_F(SettingsProviderTest, ProfileMetadataUpdatePreservesSavedPasswords) {
    const auto created = provider->saveConnectionProfile(
        R"({"id":"p","name":"before","dbType":"postgresql","useWindowsAuth":false,"savePassword":true,"password":"db-secret","ssh":{"enabled":true,"savePassword":true,"password":"ssh-secret","keyPassphrase":"key-secret"}})");
    ASSERT_NE(created.find("\"success\":true"), std::string::npos);

    // Both an omitted value and an empty form field mean no replacement.
    for (
        const auto request :
        {R"({"id":"p","name":"renamed","dbType":"postgresql","useWindowsAuth":false,"savePassword":true,"ssh":{"enabled":true,"savePassword":true}})",
         R"({"id":"p","name":"renamed","dbType":"postgresql","useWindowsAuth":false,"savePassword":true,"password":"","ssh":{"enabled":true,"savePassword":true,"password":"","keyPassphrase":""}})"}) {
        const auto saved = provider->saveConnectionProfile(request);
        ASSERT_NE(saved.find("\"success\":true"), std::string::npos);
        EXPECT_NE(provider->getProfilePassword(R"({"id":"p"})").find("db-secret"), std::string::npos);
        EXPECT_NE(provider->getSshPassword(R"({"id":"p"})").find("ssh-secret"), std::string::npos);
        EXPECT_NE(provider->getSshKeyPassphrase(R"({"id":"p"})").find("key-secret"), std::string::npos);

        SettingsAccessor reloaded(m_settingsPath);
        ASSERT_TRUE(reloaded.load().has_value());
        EXPECT_EQ(reloaded.getProfilePassword("p"), "db-secret");
        EXPECT_EQ(reloaded.getSshPassword("p"), "ssh-secret");
        EXPECT_EQ(reloaded.getSshKeyPassphrase("p"), "key-secret");
        ASSERT_TRUE(reloaded.getConnectionProfile("p").has_value());
        EXPECT_EQ(reloaded.getConnectionProfile("p")->name, "renamed");
    }
}

TEST_F(SettingsProviderTest, ProfilePasswordsCanBeReplacedAndExplicitlyForgotten) {
    for (const auto password : {"original", "replacement"}) {
        const auto request = std::format(R"({{"id":"p","savePassword":true,"password":"{}","ssh":{{"savePassword":true,"password":"{}","keyPassphrase":"{}"}}}})", password, password, password);
        ASSERT_NE(provider->saveConnectionProfile(request).find("\"success\":true"), std::string::npos);
        EXPECT_EQ(provider->settingsAccessor().getProfilePassword("p"), password);
        EXPECT_EQ(provider->settingsAccessor().getSshPassword("p"), password);
        EXPECT_EQ(provider->settingsAccessor().getSshKeyPassphrase("p"), password);
    }
    ASSERT_NE(provider->saveConnectionProfile(R"({"id":"p","savePassword":false,"ssh":{"savePassword":false}})").find("\"success\":true"), std::string::npos);
    SettingsAccessor reloaded(m_settingsPath);
    ASSERT_TRUE(reloaded.load().has_value());
    EXPECT_EQ(reloaded.getProfilePassword("p"), "");
    EXPECT_EQ(reloaded.getSshPassword("p"), "");
    EXPECT_EQ(reloaded.getSshKeyPassphrase("p"), "");
    EXPECT_FALSE(reloaded.getConnectionProfile("p")->savePassword);
}

TEST_F(SettingsProviderTest, FailedProfileSaveReturnsErrorAndRestoresInMemoryCredentials) {
    ASSERT_NE(provider->saveConnectionProfile(R"({"id":"p","name":"before","savePassword":true,"password":"original"})").find("\"success\":true"), std::string::npos);
    // A directory at the file path deterministically prevents opening it for writing.
    std::filesystem::remove(m_settingsPath);
    std::filesystem::create_directory(m_settingsPath);
    const auto result = provider->saveConnectionProfile(R"({"id":"p","name":"after","savePassword":true,"password":"replacement"})");
    EXPECT_NE(result.find("\"success\":false"), std::string::npos);
    EXPECT_EQ(provider->settingsAccessor().getProfilePassword("p"), "original");
    EXPECT_EQ(provider->settingsAccessor().getConnectionProfile("p")->name, "before");
    const auto newResult = provider->saveConnectionProfile(R"({"id":"new","savePassword":true,"password":"new-secret"})");
    EXPECT_NE(newResult.find("\"success\":false"), std::string::npos);
    EXPECT_FALSE(provider->settingsAccessor().getConnectionProfile("new").has_value());
}

TEST_F(SettingsProviderTest, SubInterfacesAreUsableIndependently) {
    // ISP 分割 (#450) の検証: SettingsProvider が各サブ IF として個別に受け取れ、
    // それぞれの代表メソッドが集約 IF 経由と同じ結果を返すことを保証する。Phase 4
    // (#456) で SystemContext がサブ IF を直接公開する際の前提を固める。
    IAppSettingsAccessor& asAppSettings = *provider;
    IConnectionProfileAccessor& asProfile = *provider;
    ISessionStateAccessor& asSession = *provider;

    // 集約 IF 経由とサブ IF 経由で同一値が返ることを検証する。
    // Phase 4 (#456) でサブ IF を直接公開した際の振る舞い等価性を保証する。
    EXPECT_EQ(asAppSettings.getSettings(), provider->getSettings());
    EXPECT_EQ(asProfile.getConnectionProfiles(), provider->getConnectionProfiles());
    EXPECT_EQ(asSession.getSessionState(), provider->getSessionState());
}

}  // namespace
}  // namespace velocitydb
