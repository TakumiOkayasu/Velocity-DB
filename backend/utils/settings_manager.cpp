#include "settings_manager.h"

#include "credential_protector.h"
#include "json_utils.h"
#include "simdjson.h"

#include <Windows.h>

#include <format>
#include <fstream>
#include <sstream>

#include <ShlObj.h>

namespace predategrip {

SettingsManager::SettingsManager() {
    // Get AppData\Local path
    wchar_t* localAppData = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
        m_settingsPath = std::filesystem::path(localAppData) / "Pre-DateGrip";
        CoTaskMemFree(localAppData);
    } else {
        // Fallback to current directory
        m_settingsPath = std::filesystem::current_path() / ".predategrip";
    }

    // Ensure directory exists
    std::filesystem::create_directories(m_settingsPath);
    m_settingsPath /= "settings.json";
}

bool SettingsManager::load() {
    std::lock_guard lock(m_mutex);

    if (!std::filesystem::exists(m_settingsPath)) {
        // Create default settings file (without lock - saveInternal handles it)
        std::ofstream file(m_settingsPath);
        if (!file.is_open()) {
            return false;
        }
        file << serializeSettings();
        return file.good();
    }

    std::ifstream file(m_settingsPath);
    if (!file.is_open()) {
        return false;
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    return deserializeSettings(buffer.str());
}

bool SettingsManager::save() {
    std::lock_guard lock(m_mutex);

    std::ofstream file(m_settingsPath);
    if (!file.is_open()) {
        return false;
    }

    file << serializeSettings();
    return file.good();
}

void SettingsManager::updateSettings(const AppSettings& settings) {
    std::lock_guard lock(m_mutex);
    m_settings = settings;
}

void SettingsManager::addConnectionProfile(const ConnectionProfile& profile) {
    std::lock_guard lock(m_mutex);
    m_settings.connectionProfiles.push_back(profile);
}

void SettingsManager::updateConnectionProfile(const ConnectionProfile& profile) {
    std::lock_guard lock(m_mutex);
    for (auto& existing : m_settings.connectionProfiles) {
        if (existing.id == profile.id) {
            existing = profile;
            return;
        }
    }
}

void SettingsManager::removeConnectionProfile(const std::string& id) {
    std::lock_guard lock(m_mutex);
    auto& profiles = m_settings.connectionProfiles;
    profiles.erase(std::remove_if(profiles.begin(), profiles.end(), [&id](const ConnectionProfile& p) { return p.id == id; }), profiles.end());
}

std::optional<ConnectionProfile> SettingsManager::getConnectionProfile(const std::string& id) const {
    std::lock_guard lock(m_mutex);
    for (const auto& profile : m_settings.connectionProfiles) {
        if (profile.id == id) {
            return profile;
        }
    }
    return std::nullopt;
}

const std::vector<ConnectionProfile>& SettingsManager::getConnectionProfiles() const {
    return m_settings.connectionProfiles;
}

std::expected<void, std::string> SettingsManager::setProfilePassword(const std::string& profileId, std::string_view plainPassword) {
    std::lock_guard lock(m_mutex);

    for (auto& profile : m_settings.connectionProfiles) {
        if (profile.id == profileId) {
            if (plainPassword.empty()) {
                profile.encryptedPassword.clear();
                profile.savePassword = false;
                return {};
            }

            auto encryptResult = CredentialProtector::encrypt(plainPassword);
            if (!encryptResult) {
                return std::unexpected(encryptResult.error());
            }

            profile.encryptedPassword = encryptResult.value();
            profile.savePassword = true;
            return {};
        }
    }

    return std::unexpected("Profile not found: " + profileId);
}

std::expected<std::string, std::string> SettingsManager::getProfilePassword(const std::string& profileId) const {
    std::lock_guard lock(m_mutex);

    for (const auto& profile : m_settings.connectionProfiles) {
        if (profile.id == profileId) {
            if (profile.encryptedPassword.empty()) {
                return std::string{};
            }

            return CredentialProtector::decrypt(profile.encryptedPassword);
        }
    }

    return std::unexpected("Profile not found: " + profileId);
}

std::filesystem::path SettingsManager::getSettingsPath() const {
    return m_settingsPath;
}

std::expected<void, std::string> SettingsManager::setSshPassword(const std::string& profileId, std::string_view plainPassword) {
    std::lock_guard lock(m_mutex);

    for (auto& profile : m_settings.connectionProfiles) {
        if (profile.id == profileId) {
            if (plainPassword.empty()) {
                profile.ssh.encryptedPassword.clear();
                return {};
            }

            auto encryptResult = CredentialProtector::encrypt(plainPassword);
            if (!encryptResult) {
                return std::unexpected(encryptResult.error());
            }

            profile.ssh.encryptedPassword = encryptResult.value();
            return {};
        }
    }

    return std::unexpected("Profile not found: " + profileId);
}

std::expected<std::string, std::string> SettingsManager::getSshPassword(const std::string& profileId) const {
    std::lock_guard lock(m_mutex);

    for (const auto& profile : m_settings.connectionProfiles) {
        if (profile.id == profileId) {
            if (profile.ssh.encryptedPassword.empty()) {
                return std::string{};
            }

            return CredentialProtector::decrypt(profile.ssh.encryptedPassword);
        }
    }

    return std::unexpected("Profile not found: " + profileId);
}

std::expected<void, std::string> SettingsManager::setSshKeyPassphrase(const std::string& profileId, std::string_view passphrase) {
    std::lock_guard lock(m_mutex);

    for (auto& profile : m_settings.connectionProfiles) {
        if (profile.id == profileId) {
            if (passphrase.empty()) {
                profile.ssh.encryptedKeyPassphrase.clear();
                return {};
            }

            auto encryptResult = CredentialProtector::encrypt(passphrase);
            if (!encryptResult) {
                return std::unexpected(encryptResult.error());
            }

            profile.ssh.encryptedKeyPassphrase = encryptResult.value();
            return {};
        }
    }

    return std::unexpected("Profile not found: " + profileId);
}

std::expected<std::string, std::string> SettingsManager::getSshKeyPassphrase(const std::string& profileId) const {
    std::lock_guard lock(m_mutex);

    for (const auto& profile : m_settings.connectionProfiles) {
        if (profile.id == profileId) {
            if (profile.ssh.encryptedKeyPassphrase.empty()) {
                return std::string{};
            }

            return CredentialProtector::decrypt(profile.ssh.encryptedKeyPassphrase);
        }
    }

    return std::unexpected("Profile not found: " + profileId);
}

std::string SettingsManager::serializeSettings() const {
    std::string json = "{\n";

    // General settings
    json += "  \"general\": {\n";
    json += std::format("    \"autoConnect\": {},\n", m_settings.general.autoConnect ? "true" : "false");
    json += std::format("    \"lastConnectionId\": \"{}\",\n", JsonUtils::escapeString(m_settings.general.lastConnectionId));
    json += std::format("    \"confirmOnExit\": {},\n", m_settings.general.confirmOnExit ? "true" : "false");
    json += std::format("    \"maxQueryHistory\": {},\n", m_settings.general.maxQueryHistory);
    json += std::format("    \"maxRecentConnections\": {},\n", m_settings.general.maxRecentConnections);
    json += std::format("    \"language\": \"{}\"\n", JsonUtils::escapeString(m_settings.general.language));
    json += "  },\n";

    // Editor settings
    json += "  \"editor\": {\n";
    json += std::format("    \"fontSize\": {},\n", m_settings.editor.fontSize);
    json += std::format("    \"fontFamily\": \"{}\",\n", JsonUtils::escapeString(m_settings.editor.fontFamily));
    json += std::format("    \"wordWrap\": {},\n", m_settings.editor.wordWrap ? "true" : "false");
    json += std::format("    \"tabSize\": {},\n", m_settings.editor.tabSize);
    json += std::format("    \"insertSpaces\": {},\n", m_settings.editor.insertSpaces ? "true" : "false");
    json += std::format("    \"showLineNumbers\": {},\n", m_settings.editor.showLineNumbers ? "true" : "false");
    json += std::format("    \"showMinimap\": {},\n", m_settings.editor.showMinimap ? "true" : "false");
    json += std::format("    \"theme\": \"{}\"\n", JsonUtils::escapeString(m_settings.editor.theme));
    json += "  },\n";

    // Grid settings
    json += "  \"grid\": {\n";
    json += std::format("    \"defaultPageSize\": {},\n", m_settings.grid.defaultPageSize);
    json += std::format("    \"showRowNumbers\": {},\n", m_settings.grid.showRowNumbers ? "true" : "false");
    json += std::format("    \"enableCellEditing\": {},\n", m_settings.grid.enableCellEditing ? "true" : "false");
    json += std::format("    \"dateFormat\": \"{}\",\n", JsonUtils::escapeString(m_settings.grid.dateFormat));
    json += std::format("    \"nullDisplay\": \"{}\"\n", JsonUtils::escapeString(m_settings.grid.nullDisplay));
    json += "  },\n";

    // Window settings
    json += "  \"window\": {\n";
    json += std::format("    \"width\": {},\n", m_settings.window.width);
    json += std::format("    \"height\": {},\n", m_settings.window.height);
    json += std::format("    \"x\": {},\n", m_settings.window.x);
    json += std::format("    \"y\": {},\n", m_settings.window.y);
    json += std::format("    \"isMaximized\": {}\n", m_settings.window.isMaximized ? "true" : "false");
    json += "  },\n";

    // Connection profiles
    json += "  \"connectionProfiles\": [\n";
    for (size_t i = 0; i < m_settings.connectionProfiles.size(); ++i) {
        const auto& profile = m_settings.connectionProfiles[i];
        json += "    {\n";
        json += std::format("      \"id\": \"{}\",\n", JsonUtils::escapeString(profile.id));
        json += std::format("      \"name\": \"{}\",\n", JsonUtils::escapeString(profile.name));
        json += std::format("      \"server\": \"{}\",\n", JsonUtils::escapeString(profile.server));
        json += std::format("      \"port\": {},\n", profile.port);
        json += std::format("      \"database\": \"{}\",\n", JsonUtils::escapeString(profile.database));
        json += std::format("      \"username\": \"{}\",\n", JsonUtils::escapeString(profile.username));
        json += std::format("      \"useWindowsAuth\": {},\n", profile.useWindowsAuth ? "true" : "false");
        json += std::format("      \"savePassword\": {},\n", profile.savePassword ? "true" : "false");
        json += std::format("      \"encryptedPassword\": \"{}\",\n", JsonUtils::escapeString(profile.encryptedPassword));
        json += std::format("      \"isProduction\": {},\n", profile.isProduction ? "true" : "false");
        json += std::format("      \"isReadOnly\": {},\n", profile.isReadOnly ? "true" : "false");
        // SSH configuration
        json += "      \"ssh\": {\n";
        json += std::format("        \"enabled\": {},\n", profile.ssh.enabled ? "true" : "false");
        json += std::format("        \"host\": \"{}\",\n", JsonUtils::escapeString(profile.ssh.host));
        json += std::format("        \"port\": {},\n", profile.ssh.port);
        json += std::format("        \"username\": \"{}\",\n", JsonUtils::escapeString(profile.ssh.username));
        json += std::format("        \"authType\": \"{}\",\n", profile.ssh.authType == SshAuthType::Password ? "password" : "privateKey");
        json += std::format("        \"encryptedPassword\": \"{}\",\n", JsonUtils::escapeString(profile.ssh.encryptedPassword));
        json += std::format("        \"privateKeyPath\": \"{}\",\n", JsonUtils::escapeString(profile.ssh.privateKeyPath));
        json += std::format("        \"encryptedKeyPassphrase\": \"{}\"\n", JsonUtils::escapeString(profile.ssh.encryptedKeyPassphrase));
        json += "      }\n";
        json += i < m_settings.connectionProfiles.size() - 1 ? "    },\n" : "    }\n";
    }
    json += "  ]\n";

    json += "}\n";
    return json;
}

bool SettingsManager::deserializeSettings(std::string_view jsonStr) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(jsonStr);

        // General settings
        if (auto general = doc["general"]; !general.error()) {
            if (auto val = general["autoConnect"].get_bool(); !val.error())
                m_settings.general.autoConnect = val.value();
            if (auto val = general["lastConnectionId"].get_string(); !val.error())
                m_settings.general.lastConnectionId = std::string(val.value());
            if (auto val = general["confirmOnExit"].get_bool(); !val.error())
                m_settings.general.confirmOnExit = val.value();
            if (auto val = general["maxQueryHistory"].get_int64(); !val.error())
                m_settings.general.maxQueryHistory = static_cast<int>(val.value());
            if (auto val = general["maxRecentConnections"].get_int64(); !val.error())
                m_settings.general.maxRecentConnections = static_cast<int>(val.value());
            if (auto val = general["language"].get_string(); !val.error())
                m_settings.general.language = std::string(val.value());
        }

        // Editor settings
        if (auto editor = doc["editor"]; !editor.error()) {
            if (auto val = editor["fontSize"].get_int64(); !val.error())
                m_settings.editor.fontSize = static_cast<int>(val.value());
            if (auto val = editor["fontFamily"].get_string(); !val.error())
                m_settings.editor.fontFamily = std::string(val.value());
            if (auto val = editor["wordWrap"].get_bool(); !val.error())
                m_settings.editor.wordWrap = val.value();
            if (auto val = editor["tabSize"].get_int64(); !val.error())
                m_settings.editor.tabSize = static_cast<int>(val.value());
            if (auto val = editor["insertSpaces"].get_bool(); !val.error())
                m_settings.editor.insertSpaces = val.value();
            if (auto val = editor["showLineNumbers"].get_bool(); !val.error())
                m_settings.editor.showLineNumbers = val.value();
            if (auto val = editor["showMinimap"].get_bool(); !val.error())
                m_settings.editor.showMinimap = val.value();
            if (auto val = editor["theme"].get_string(); !val.error())
                m_settings.editor.theme = std::string(val.value());
        }

        // Grid settings
        if (auto grid = doc["grid"]; !grid.error()) {
            if (auto val = grid["defaultPageSize"].get_int64(); !val.error())
                m_settings.grid.defaultPageSize = static_cast<int>(val.value());
            if (auto val = grid["showRowNumbers"].get_bool(); !val.error())
                m_settings.grid.showRowNumbers = val.value();
            if (auto val = grid["enableCellEditing"].get_bool(); !val.error())
                m_settings.grid.enableCellEditing = val.value();
            if (auto val = grid["dateFormat"].get_string(); !val.error())
                m_settings.grid.dateFormat = std::string(val.value());
            if (auto val = grid["nullDisplay"].get_string(); !val.error())
                m_settings.grid.nullDisplay = std::string(val.value());
        }

        // Window settings
        if (auto window = doc["window"]; !window.error()) {
            if (auto val = window["width"].get_int64(); !val.error())
                m_settings.window.width = static_cast<int>(val.value());
            if (auto val = window["height"].get_int64(); !val.error())
                m_settings.window.height = static_cast<int>(val.value());
            if (auto val = window["x"].get_int64(); !val.error())
                m_settings.window.x = static_cast<int>(val.value());
            if (auto val = window["y"].get_int64(); !val.error())
                m_settings.window.y = static_cast<int>(val.value());
            if (auto val = window["isMaximized"].get_bool(); !val.error())
                m_settings.window.isMaximized = val.value();
        }

        // Connection profiles
        m_settings.connectionProfiles.clear();
        if (auto profiles = doc["connectionProfiles"].get_array(); !profiles.error()) {
            for (auto profileEl : profiles.value()) {
                ConnectionProfile profile;
                if (auto val = profileEl["id"].get_string(); !val.error())
                    profile.id = std::string(val.value());
                if (auto val = profileEl["name"].get_string(); !val.error())
                    profile.name = std::string(val.value());
                if (auto val = profileEl["server"].get_string(); !val.error())
                    profile.server = std::string(val.value());
                if (auto val = profileEl["port"].get_int64(); !val.error())
                    profile.port = static_cast<int>(val.value());
                if (auto val = profileEl["database"].get_string(); !val.error())
                    profile.database = std::string(val.value());
                if (auto val = profileEl["username"].get_string(); !val.error())
                    profile.username = std::string(val.value());
                if (auto val = profileEl["useWindowsAuth"].get_bool(); !val.error())
                    profile.useWindowsAuth = val.value();
                if (auto val = profileEl["savePassword"].get_bool(); !val.error())
                    profile.savePassword = val.value();
                if (auto val = profileEl["encryptedPassword"].get_string(); !val.error())
                    profile.encryptedPassword = std::string(val.value());
                if (auto val = profileEl["isProduction"].get_bool(); !val.error())
                    profile.isProduction = val.value();
                if (auto val = profileEl["isReadOnly"].get_bool(); !val.error())
                    profile.isReadOnly = val.value();
                // SSH configuration
                if (auto ssh = profileEl["ssh"]; !ssh.error()) {
                    if (auto val = ssh["enabled"].get_bool(); !val.error())
                        profile.ssh.enabled = val.value();
                    if (auto val = ssh["host"].get_string(); !val.error())
                        profile.ssh.host = std::string(val.value());
                    if (auto val = ssh["port"].get_int64(); !val.error())
                        profile.ssh.port = static_cast<int>(val.value());
                    if (auto val = ssh["username"].get_string(); !val.error())
                        profile.ssh.username = std::string(val.value());
                    if (auto val = ssh["authType"].get_string(); !val.error())
                        profile.ssh.authType = (val.value() == "privateKey") ? SshAuthType::PrivateKey : SshAuthType::Password;
                    if (auto val = ssh["encryptedPassword"].get_string(); !val.error())
                        profile.ssh.encryptedPassword = std::string(val.value());
                    if (auto val = ssh["privateKeyPath"].get_string(); !val.error())
                        profile.ssh.privateKeyPath = std::string(val.value());
                    if (auto val = ssh["encryptedKeyPassphrase"].get_string(); !val.error())
                        profile.ssh.encryptedKeyPassphrase = std::string(val.value());
                }
                m_settings.connectionProfiles.push_back(profile);
            }
        }

        return true;
    } catch (...) {
        return false;
    }
}

}  // namespace predategrip
