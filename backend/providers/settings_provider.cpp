#include "settings_provider.h"

#include "../database/query_history.h"
#include "../interfaces/providers/connection_provider.h"
#include "../utils/glaze_meta.h"
#include "../utils/json_utils.h"
#include "../utils/session_manager.h"
#include "../utils/settings_manager.h"
#include "simdjson.h"

#include <algorithm>
#include <chrono>
#include <climits>
#include <format>
#include <ranges>

// --- Response DTOs (exclude sensitive fields from API responses) ---
// Lifetime: string_view/pointer members reference source objects.
//           Callers must serialize within the same scope as the source.
// Design:   SettingsResponse copies sub-structs (small, infrequent reads).
//           ConnectionProfile/SessionState DTOs use views (larger, avoids heap allocs).

namespace velocitydb::dto {

struct SettingsResponse {
    GeneralSettings general;
    EditorSettings editor;
    GridSettings grid;
    QuerySettings query;
};

struct SshConfigResponse {
    bool enabled = false;
    std::string_view host;
    int port = 22;
    std::string_view username;
    SshAuthType authType = SshAuthType::Password;
    std::string_view privateKeyPath;
    bool savePassword = false;
};

// Non-owning view of a ConnectionProfile for JSON serialization.
// All std::string_view members point into the source ConnectionProfile;
// that source must outlive this response until JSON serialization completes.
struct ConnectionProfileResponse {
    std::string_view id;
    std::string_view name;
    std::string_view server;
    int port = 1433;
    std::string_view database;
    std::string_view username;
    bool useWindowsAuth = true;
    bool savePassword = false;
    bool isProduction = false;
    bool isReadOnly = false;
    std::string_view environment;
    std::string_view dbType;
    std::string_view folderPath;
    SshConfigResponse ssh;
};

struct SessionStateResponse {
    std::string_view activeConnectionId;
    std::string_view activeTabId;
    const std::vector<EditorTab>* openTabs = nullptr;
    const std::vector<std::string>* expandedTreeNodes = nullptr;
    int windowWidth = 1280;
    int windowHeight = 720;
    int windowX = 100;
    int windowY = 100;
    bool isMaximized = false;
    int leftPanelWidth = 250;
    int bottomPanelHeight = 200;
};

[[nodiscard]] ConnectionProfileResponse toProfileResponse(const ConnectionProfile& p) {
    return {
        .id = p.id,
        .name = p.name,
        .server = p.server,
        .port = p.port,
        .database = p.database,
        .username = p.username,
        .useWindowsAuth = p.useWindowsAuth,
        .savePassword = p.savePassword,
        .isProduction = p.isProduction,
        .isReadOnly = p.isReadOnly,
        .environment = p.environment,
        .dbType = p.dbType,
        .folderPath = p.folderPath,
        .ssh =
            {
                .enabled = p.ssh.enabled,
                .host = p.ssh.host,
                .port = p.ssh.port,
                .username = p.ssh.username,
                .authType = p.ssh.authType,
                .privateKeyPath = p.ssh.privateKeyPath,
                .savePassword = !p.ssh.encryptedPassword.empty() || !p.ssh.encryptedKeyPassphrase.empty(),
            },
    };
}

[[nodiscard]] SessionStateResponse toSessionResponse(const SessionState& s) {
    return {
        .activeConnectionId = s.activeConnectionId,
        .activeTabId = s.activeTabId,
        .openTabs = &s.openTabs,
        .expandedTreeNodes = &s.expandedTreeNodes,
        .windowWidth = s.windowWidth,
        .windowHeight = s.windowHeight,
        .windowX = s.windowX,
        .windowY = s.windowY,
        .isMaximized = s.isMaximized,
        .leftPanelWidth = s.leftPanelWidth,
        .bottomPanelHeight = s.bottomPanelHeight,
    };
}

}  // namespace velocitydb::dto

template <>
struct glz::meta<velocitydb::dto::SettingsResponse> {
    using T = velocitydb::dto::SettingsResponse;
    static constexpr auto value = glz::object("general", &T::general, "editor", &T::editor, "grid", &T::grid, "query", &T::query);
};

template <>
struct glz::meta<velocitydb::dto::SshConfigResponse> {
    using T = velocitydb::dto::SshConfigResponse;
    static constexpr auto value = glz::object("enabled", &T::enabled, "host", &T::host, "port", &T::port, "username", &T::username, "authType", &T::authType, "privateKeyPath", &T::privateKeyPath,
                                              "savePassword", &T::savePassword);
};

template <>
struct glz::meta<velocitydb::dto::ConnectionProfileResponse> {
    using T = velocitydb::dto::ConnectionProfileResponse;
    static constexpr auto value = glz::object("id", &T::id, "name", &T::name, "server", &T::server, "port", &T::port, "database", &T::database, "username", &T::username, "useWindowsAuth",
                                              &T::useWindowsAuth, "savePassword", &T::savePassword, "isProduction", &T::isProduction, "isReadOnly", &T::isReadOnly, "environment", &T::environment,
                                              "dbType", &T::dbType, "folderPath", &T::folderPath, "ssh", &T::ssh);
};

template <>
struct glz::meta<velocitydb::dto::SessionStateResponse> {
    using T = velocitydb::dto::SessionStateResponse;
    static constexpr auto value = glz::object("activeConnectionId", &T::activeConnectionId, "activeTabId", &T::activeTabId, "openTabs", &T::openTabs, "expandedTreeNodes", &T::expandedTreeNodes,
                                              "windowWidth", &T::windowWidth, "windowHeight", &T::windowHeight, "windowX", &T::windowX, "windowY", &T::windowY, "isMaximized", &T::isMaximized,
                                              "leftPanelWidth", &T::leftPanelWidth, "bottomPanelHeight", &T::bottomPanelHeight);
};

namespace velocitydb {

namespace {

[[nodiscard]] constexpr int narrowToInt(int64_t val) noexcept {
    return static_cast<int>(std::clamp(val, static_cast<int64_t>(INT_MIN), static_cast<int64_t>(INT_MAX)));
}

}  // namespace

SettingsProvider::SettingsProvider(IConnectionProvider* connections)
    : m_settingsManager(std::make_unique<SettingsManager>()), m_sessionManager(std::make_unique<SessionManager>()), m_connections(connections) {
    (void)m_settingsManager->load();
    (void)m_sessionManager->load();
    applyQueryTimeoutToConnections(m_settingsManager->getSettings().query.timeoutSeconds);
}

void SettingsProvider::applyQueryTimeoutToConnections(int seconds) {
    if (m_connections) {
        m_connections->setDefaultQueryTimeoutSeconds(seconds);
    }
}

void SettingsProvider::applyMaxQueryHistoryToInstance(int maxItems) {
    if (m_queryHistory && maxItems > 0) {
        m_queryHistory->setMaxItems(static_cast<size_t>(maxItems));
    }
}

void SettingsProvider::setQueryHistory(QueryHistory* queryHistory) {
    m_queryHistory = queryHistory;
    // 初回 wiring 時に load 済み settings を即時反映する。
    if (m_queryHistory) {
        applyMaxQueryHistoryToInstance(m_settingsManager->getSettings().general.maxQueryHistory);
    }
}

SettingsProvider::~SettingsProvider() = default;
SettingsProvider::SettingsProvider(SettingsProvider&&) noexcept = default;
SettingsProvider& SettingsProvider::operator=(SettingsProvider&&) noexcept = default;

std::string SettingsProvider::getSettings() {
    const auto& s = m_settingsManager->getSettings();
    dto::SettingsResponse resp{s.general, s.editor, s.grid, s.query};
    std::string json;
    if (auto ec = glz::write_json(resp, json); bool(ec)) {
        return JsonUtils::errorResponse("Failed to serialize settings");
    }
    return JsonUtils::successResponse(json);
}

std::string SettingsProvider::updateSettings(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        AppSettings settings = m_settingsManager->getSettings();

        if (auto general = doc["general"]; !general.error()) {
            if (auto val = general["autoConnect"].get_bool(); !val.error())
                settings.general.autoConnect = val.value();
            if (auto val = general["confirmOnExit"].get_bool(); !val.error())
                settings.general.confirmOnExit = val.value();
            if (auto val = general["maxQueryHistory"].get_int64(); !val.error())
                settings.general.maxQueryHistory = narrowToInt(val.value());
            if (auto val = general["language"].get_string(); !val.error())
                settings.general.language = std::string(val.value());
        }

        if (auto editor = doc["editor"]; !editor.error()) {
            if (auto val = editor["fontSize"].get_int64(); !val.error())
                settings.editor.fontSize = narrowToInt(val.value());
            if (auto val = editor["fontFamily"].get_string(); !val.error())
                settings.editor.fontFamily = std::string(val.value());
            if (auto val = editor["wordWrap"].get_bool(); !val.error())
                settings.editor.wordWrap = val.value();
            if (auto val = editor["tabSize"].get_int64(); !val.error())
                settings.editor.tabSize = narrowToInt(val.value());
            if (auto val = editor["theme"].get_string(); !val.error())
                settings.editor.theme = std::string(val.value());
        }

        if (auto grid = doc["grid"]; !grid.error()) {
            if (auto val = grid["defaultPageSize"].get_int64(); !val.error())
                settings.grid.defaultPageSize = narrowToInt(val.value());
            if (auto val = grid["showRowNumbers"].get_bool(); !val.error())
                settings.grid.showRowNumbers = val.value();
            if (auto val = grid["nullDisplay"].get_string(); !val.error())
                settings.grid.nullDisplay = std::string(val.value());
        }

        if (auto query = doc["query"]; !query.error()) {
            if (auto val = query["timeoutSeconds"].get_int64(); !val.error())
                settings.query.timeoutSeconds = std::clamp(narrowToInt(val.value()), kQueryTimeoutMinSec, kQueryTimeoutMaxSec);
        }

        if (auto window = doc["window"]; !window.error()) {
            if (auto val = window["width"].get_int64(); !val.error())
                settings.window.width = narrowToInt(val.value());
            if (auto val = window["height"].get_int64(); !val.error())
                settings.window.height = narrowToInt(val.value());
            if (auto val = window["x"].get_int64(); !val.error())
                settings.window.x = narrowToInt(val.value());
            if (auto val = window["y"].get_int64(); !val.error())
                settings.window.y = narrowToInt(val.value());
            if (auto val = window["isMaximized"].get_bool(); !val.error())
                settings.window.isMaximized = val.value();
        }

        m_settingsManager->updateSettings(settings);
        (void)m_settingsManager->save();

        applyQueryTimeoutToConnections(settings.query.timeoutSeconds);
        applyMaxQueryHistoryToInstance(settings.general.maxQueryHistory);

        return JsonUtils::successResponse(R"({"saved":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SettingsProvider::getConnectionProfiles() {
    const auto& profiles = m_settingsManager->getConnectionProfiles();
    auto responses = profiles | std::views::transform(dto::toProfileResponse) | std::ranges::to<std::vector>();
    std::string profilesJson;
    if (auto ec = glz::write_json(responses, profilesJson); bool(ec)) {
        return JsonUtils::errorResponse("Failed to serialize connection profiles");
    }
    return JsonUtils::successResponse(std::format(R"({{"profiles":{}}})", profilesJson));
}

std::string SettingsProvider::saveConnectionProfile(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        ConnectionProfile profile;
        if (auto val = doc["id"].get_string(); !val.error())
            profile.id = std::string(val.value());
        if (auto val = doc["name"].get_string(); !val.error())
            profile.name = std::string(val.value());
        if (auto val = doc["server"].get_string(); !val.error())
            profile.server = std::string(val.value());
        if (auto val = doc["port"].get_int64(); !val.error())
            profile.port = narrowToInt(val.value());
        if (auto val = doc["database"].get_string(); !val.error())
            profile.database = std::string(val.value());
        if (auto val = doc["username"].get_string(); !val.error())
            profile.username = std::string(val.value());
        if (auto val = doc["useWindowsAuth"].get_bool(); !val.error())
            profile.useWindowsAuth = val.value();
        if (auto val = doc["savePassword"].get_bool(); !val.error())
            profile.savePassword = val.value();
        if (auto val = doc["isProduction"].get_bool(); !val.error())
            profile.isProduction = val.value();
        if (auto val = doc["isReadOnly"].get_bool(); !val.error())
            profile.isReadOnly = val.value();
        if (auto val = doc["environment"].get_string(); !val.error())
            profile.environment = std::string(val.value());
        if (auto val = doc["dbType"].get_string(); !val.error())
            profile.dbType = std::string(val.value());
        if (auto val = doc["folderPath"].get_string(); !val.error())
            profile.folderPath = std::string(val.value());

        if (auto ssh = doc["ssh"]; !ssh.error()) {
            if (auto val = ssh["enabled"].get_bool(); !val.error())
                profile.ssh.enabled = val.value();
            if (auto val = ssh["host"].get_string(); !val.error())
                profile.ssh.host = std::string(val.value());
            if (auto val = ssh["port"].get_int64(); !val.error())
                profile.ssh.port = narrowToInt(val.value());
            if (auto val = ssh["username"].get_string(); !val.error())
                profile.ssh.username = std::string(val.value());
            if (auto val = ssh["authType"].get_string(); !val.error())
                profile.ssh.authType = (val.value() == "privateKey") ? SshAuthType::PrivateKey : SshAuthType::Password;
            if (auto val = ssh["privateKeyPath"].get_string(); !val.error())
                profile.ssh.privateKeyPath = std::string(val.value());
        }

        if (profile.id.empty()) {
            profile.id = std::format("profile_{}", std::chrono::system_clock::now().time_since_epoch().count());
        }

        if (m_settingsManager->getConnectionProfile(profile.id).has_value()) {
            m_settingsManager->updateConnectionProfile(profile);
        } else {
            m_settingsManager->addConnectionProfile(profile);
        }

        if (profile.savePassword) {
            if (auto val = doc["password"].get_string(); !val.error()) {
                auto password = std::string(val.value());
                if (!password.empty()) {
                    (void)m_settingsManager->setProfilePassword(profile.id, password);
                }
            }
        } else {
            (void)m_settingsManager->setProfilePassword(profile.id, "");
        }

        if (auto ssh = doc["ssh"]; !ssh.error()) {
            if (auto savePass = ssh["savePassword"].get_bool(); !savePass.error() && savePass.value()) {
                if (auto val = ssh["password"].get_string(); !val.error()) {
                    auto sshPassword = std::string(val.value());
                    if (!sshPassword.empty()) {
                        (void)m_settingsManager->setSshPassword(profile.id, sshPassword);
                    }
                }
                if (auto val = ssh["keyPassphrase"].get_string(); !val.error()) {
                    auto keyPassphrase = std::string(val.value());
                    if (!keyPassphrase.empty()) {
                        (void)m_settingsManager->setSshKeyPassphrase(profile.id, keyPassphrase);
                    }
                }
            } else {
                (void)m_settingsManager->setSshPassword(profile.id, "");
                (void)m_settingsManager->setSshKeyPassphrase(profile.id, "");
            }
        }

        (void)m_settingsManager->save();

        return JsonUtils::successResponse(std::format(R"({{"id":"{}"}})", JsonUtils::escapeString(profile.id)));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SettingsProvider::deleteConnectionProfile(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto profileIdResult = doc["id"].get_string();
        if (profileIdResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: id");
        }
        auto profileId = std::string(profileIdResult.value());
        m_settingsManager->removeConnectionProfile(profileId);
        (void)m_settingsManager->save();

        return JsonUtils::successResponse(R"({"deleted":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SettingsProvider::getProfilePassword(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto idResult = doc["id"].get_string();
        if (idResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: id");
        }
        auto profileId = std::string(idResult.value());

        auto passwordResult = m_settingsManager->getProfilePassword(profileId);
        if (!passwordResult) {
            return JsonUtils::errorResponse(passwordResult.error());
        }

        return JsonUtils::successResponse(std::format(R"({{"password":"{}"}})", JsonUtils::escapeString(passwordResult.value())));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SettingsProvider::getSshPassword(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto idResult = doc["id"].get_string();
        if (idResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: id");
        }
        auto profileId = std::string(idResult.value());

        auto passwordResult = m_settingsManager->getSshPassword(profileId);
        if (!passwordResult) {
            return JsonUtils::errorResponse(passwordResult.error());
        }

        return JsonUtils::successResponse(std::format(R"({{"password":"{}"}})", JsonUtils::escapeString(passwordResult.value())));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SettingsProvider::getSshKeyPassphrase(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto idResult = doc["id"].get_string();
        if (idResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: id");
        }
        auto profileId = std::string(idResult.value());

        auto passphraseResult = m_settingsManager->getSshKeyPassphrase(profileId);
        if (!passphraseResult) {
            return JsonUtils::errorResponse(passphraseResult.error());
        }

        return JsonUtils::successResponse(std::format(R"({{"passphrase":"{}"}})", JsonUtils::escapeString(passphraseResult.value())));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string SettingsProvider::getSessionState() {
    const auto& state = m_sessionManager->getState();
    auto resp = dto::toSessionResponse(state);
    std::string json;
    if (auto ec = glz::write_json(resp, json); bool(ec)) {
        return JsonUtils::errorResponse("Failed to serialize session state");
    }
    return JsonUtils::successResponse(json);
}

std::string SettingsProvider::saveSessionState(std::string_view params) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        SessionState state = m_sessionManager->getState();

        if (auto val = doc["activeConnectionId"].get_string(); !val.error())
            state.activeConnectionId = std::string(val.value());
        if (auto val = doc["activeTabId"].get_string(); !val.error())
            state.activeTabId = std::string(val.value());
        if (auto val = doc["windowX"].get_int64(); !val.error())
            state.windowX = narrowToInt(val.value());
        if (auto val = doc["windowY"].get_int64(); !val.error())
            state.windowY = narrowToInt(val.value());
        if (auto val = doc["windowWidth"].get_int64(); !val.error())
            state.windowWidth = narrowToInt(val.value());
        if (auto val = doc["windowHeight"].get_int64(); !val.error())
            state.windowHeight = narrowToInt(val.value());
        if (auto val = doc["isMaximized"].get_bool(); !val.error())
            state.isMaximized = val.value();
        if (auto val = doc["leftPanelWidth"].get_int64(); !val.error())
            state.leftPanelWidth = narrowToInt(val.value());
        if (auto val = doc["bottomPanelHeight"].get_int64(); !val.error())
            state.bottomPanelHeight = narrowToInt(val.value());

        state.openTabs.clear();
        if (auto tabs = doc["openTabs"].get_array(); !tabs.error()) {
            for (auto tabEl : tabs.value()) {
                EditorTab tab;
                if (auto val = tabEl["id"].get_string(); !val.error())
                    tab.id = std::string(val.value());
                if (auto val = tabEl["title"].get_string(); !val.error())
                    tab.title = std::string(val.value());
                if (auto val = tabEl["content"].get_string(); !val.error())
                    tab.content = std::string(val.value());
                if (auto val = tabEl["filePath"].get_string(); !val.error())
                    tab.filePath = std::string(val.value());
                if (auto val = tabEl["isDirty"].get_bool(); !val.error())
                    tab.isDirty = val.value();
                if (auto val = tabEl["cursorLine"].get_int64(); !val.error())
                    tab.cursorLine = narrowToInt(val.value());
                if (auto val = tabEl["cursorColumn"].get_int64(); !val.error())
                    tab.cursorColumn = narrowToInt(val.value());
                state.openTabs.push_back(tab);
            }
        }

        state.expandedTreeNodes.clear();
        if (auto nodes = doc["expandedTreeNodes"].get_array(); !nodes.error()) {
            for (auto nodeEl : nodes.value()) {
                if (auto val = nodeEl.get_string(); !val.error()) {
                    state.expandedTreeNodes.push_back(std::string(val.value()));
                }
            }
        }

        m_sessionManager->updateState(state);
        (void)m_sessionManager->save();

        return JsonUtils::successResponse(R"({"saved":true})");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
