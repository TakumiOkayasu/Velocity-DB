#pragma once

#include "../interfaces/providers/settings_provider.h"

#include <memory>
#include <string>
#include <string_view>

namespace velocitydb {

class SettingsAccessor;
class SessionAccessor;
class IConnectionProvider;
class QueryHistory;

/// Provider for application settings and session management
class SettingsProvider : public ISettingsProvider {
public:
    /// @param connections Used to propagate query.timeoutSeconds changes to active drivers.
    ///                    May be nullptr for unit tests that don't exercise timeout propagation.
    explicit SettingsProvider(IConnectionProvider* connections = nullptr);
    ~SettingsProvider() override;

    /// Wire the QueryHistory instance whose maxItems is updated when
    /// general.maxQueryHistory changes via updateSettings().
    /// May be called once after construction; pass nullptr to detach.
    void setQueryHistory(QueryHistory* queryHistory);

    SettingsProvider(const SettingsProvider&) = delete;
    SettingsProvider& operator=(const SettingsProvider&) = delete;
    SettingsProvider(SettingsProvider&&) noexcept;
    SettingsProvider& operator=(SettingsProvider&&) noexcept;

    [[nodiscard]] std::string getSettings() override;
    [[nodiscard]] std::string updateSettings(std::string_view params) override;
    [[nodiscard]] std::string getConnectionProfiles() override;
    [[nodiscard]] std::string saveConnectionProfile(std::string_view params) override;
    [[nodiscard]] std::string deleteConnectionProfile(std::string_view params) override;
    [[nodiscard]] std::string getProfilePassword(std::string_view params) override;
    [[nodiscard]] std::string getSshPassword(std::string_view params) override;
    [[nodiscard]] std::string getSshKeyPassphrase(std::string_view params) override;
    [[nodiscard]] std::string getSessionState() override;
    [[nodiscard]] std::string saveSessionState(std::string_view params) override;

    [[nodiscard]] SettingsAccessor& settingsAccessor() { return *m_settingsAccessor; }
    [[nodiscard]] const SettingsAccessor& settingsAccessor() const { return *m_settingsAccessor; }
    [[nodiscard]] SessionAccessor& sessionAccessor() { return *m_sessionAccessor; }
    [[nodiscard]] const SessionAccessor& sessionAccessor() const { return *m_sessionAccessor; }

private:
    void applyQueryTimeoutToConnections(int seconds);
    void applyMaxQueryHistoryToInstance(int maxItems);

    std::unique_ptr<SettingsAccessor> m_settingsAccessor;
    std::unique_ptr<SessionAccessor> m_sessionAccessor;
    IConnectionProvider* m_connections;      // Non-owning; may be null in tests
    QueryHistory* m_queryHistory = nullptr;  // Non-owning; wired post-construction by SystemContext
};

}  // namespace velocitydb
