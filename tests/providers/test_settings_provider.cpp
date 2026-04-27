#include <gtest/gtest.h>

#include "database/query_history.h"
#include "providers/settings_provider.h"
#include "utils/session_manager.h"
#include "utils/settings_manager.h"

namespace velocitydb {
namespace {

class SettingsProviderTest : public ::testing::Test {
protected:
    SettingsProvider provider;
};

TEST_F(SettingsProviderTest, AccessSettingsManager) {
    // Verify direct access to SettingsManager works
    auto& manager = provider.settingsManager();
    const auto& settings = manager.getSettings();

    // Default settings should have reasonable values
    EXPECT_GT(settings.editor.fontSize, 0);
    EXPECT_FALSE(settings.editor.fontFamily.empty());
}

TEST_F(SettingsProviderTest, AccessSessionManager) {
    // Verify direct access to SessionManager works
    auto& manager = provider.sessionManager();
    const auto& state = manager.getState();

    // Default session state should have reasonable values
    EXPECT_GE(state.windowWidth, 0);
    EXPECT_GE(state.windowHeight, 0);
}

TEST_F(SettingsProviderTest, GetProfilePasswordNotFound) {
    // Non-existent profile should return error JSON
    auto result = provider.getProfilePassword(R"({"id":"non_existent_profile_id"})");
    EXPECT_FALSE(result.empty());
    EXPECT_NE(result.find("error"), std::string::npos);
}

TEST_F(SettingsProviderTest, GetSshPasswordNotFound) {
    // Non-existent profile should return error JSON
    auto result = provider.getSshPassword(R"({"id":"non_existent_profile_id"})");
    EXPECT_FALSE(result.empty());
    EXPECT_NE(result.find("error"), std::string::npos);
}

TEST_F(SettingsProviderTest, DeleteNonExistentProfile) {
    // Deleting non-existent profile should succeed (idempotent)
    auto result = provider.deleteConnectionProfile(R"({"id":"non_existent_profile_id"})");
    EXPECT_FALSE(result.empty());
}

TEST_F(SettingsProviderTest, UpdateSettingsAppliesMaxQueryHistoryToInstance) {
    // Issue #426: settings.maxQueryHistory の変更が wired QueryHistory に伝播することを検証する。
    QueryHistory queryHistory{10000};
    for (int i = 0; i < 20; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        // 全て非 favorite (eviction 対象)
        queryHistory.add(item);
    }
    ASSERT_EQ(queryHistory.getAll().size(), 20);

    provider.setQueryHistory(&queryHistory);

    auto result = provider.updateSettings(R"({"general":{"maxQueryHistory":5}})");

    EXPECT_NE(result.find("\"saved\""), std::string::npos);
    EXPECT_EQ(queryHistory.getAll().size(), 5u);
}

TEST_F(SettingsProviderTest, SetQueryHistoryAppliesLoadedMaxToInstance) {
    // wiring 時点の settings.maxQueryHistory が QueryHistory に即時反映されることを検証する。
    // 1) settings を maxQueryHistory=3 に変更 (この時点では m_queryHistory 未 wire のため伝播は no-op)。
    auto updateResult = provider.updateSettings(R"({"general":{"maxQueryHistory":3}})");
    ASSERT_NE(updateResult.find("\"saved\""), std::string::npos);

    // 2) ローカル QueryHistory は上限 1000 で 10 件保持。
    QueryHistory queryHistory{1000};
    for (int i = 0; i < 10; ++i) {
        HistoryItem item;
        item.id = generateHistoryId();
        item.sql = "SELECT " + std::to_string(i);
        item.timestamp = std::chrono::system_clock::now();
        item.success = true;
        queryHistory.add(item);
    }
    ASSERT_EQ(queryHistory.getAll().size(), 10);

    // 3) wire 時点で setMaxItems(3) が呼ばれて 3 件まで縮小される。
    provider.setQueryHistory(&queryHistory);

    EXPECT_EQ(queryHistory.getAll().size(), 3u);
}

}  // namespace
}  // namespace velocitydb
