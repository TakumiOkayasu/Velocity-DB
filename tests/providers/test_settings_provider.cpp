#include <gtest/gtest.h>

#include <format>
#include <memory>

#include "database/query_history.h"
#include "interfaces/providers/app_settings_accessor.h"
#include "interfaces/providers/connection_profile_accessor.h"
#include "interfaces/providers/session_state_accessor.h"
#include "providers/settings_provider.h"
#include "accessors/session_accessor.h"
#include "accessors/settings_accessor.h"

namespace velocitydb {
namespace {

class SettingsProviderTest : public ::testing::Test {
protected:
    // settings.json は %LOCALAPPDATA%\Velocity-DB\ に永続化されるため、テスト間および
    // ユーザー設定との state リークを防ぐ。SetUp で元の maxQueryHistory を退避してから
    // 1000 にリセット、TearDown で退避値に復元する (ユーザー設定を破壊しない)。
    // m_queryHistory は provider より先に宣言: SettingsProvider が QueryHistory& を保持するため
    // (ライフタイム順序保証)。
    void SetUp() override {
        auto settingsAccessor = std::make_unique<SettingsAccessor>();
        (void)settingsAccessor->load();
        m_savedMaxQueryHistory = settingsAccessor->getSettings().general.maxQueryHistory;
        auto sessionAccessor = std::make_unique<SessionAccessor>();
        (void)sessionAccessor->load();

        m_queryHistory = std::make_unique<QueryHistory>(1000);
        provider = std::make_unique<SettingsProvider>(std::move(settingsAccessor), std::move(sessionAccessor), nullptr, *m_queryHistory);

        auto resetResult = provider->updateSettings(R"({"general":{"maxQueryHistory":1000}})");
        ASSERT_NE(resetResult.find("\"saved\""), std::string::npos);
    }

    void TearDown() override {
        const auto restoreJson = std::format(R"({{"general":{{"maxQueryHistory":{}}}}})", m_savedMaxQueryHistory);
        (void)provider->updateSettings(restoreJson);
    }

    std::unique_ptr<QueryHistory> m_queryHistory;
    std::unique_ptr<SettingsProvider> provider;
    int m_savedMaxQueryHistory = 1000;
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
    auto freshSettings = std::make_unique<SettingsAccessor>();
    (void)freshSettings->load();
    auto freshSession = std::make_unique<SessionAccessor>();
    (void)freshSession->load();
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
