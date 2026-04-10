#include "settings_manager.h"

#include "credential_protector.h"
#include "glaze_meta.h"
#include "logger.h"

#include <Windows.h>

#include <algorithm>
#include <format>
#include <fstream>
#include <sstream>

#include <ShlObj.h>

namespace velocitydb {

SettingsManager::SettingsManager() {
    // Get AppData\Local path
    wchar_t* localAppData = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
        m_settingsPath = std::filesystem::path(localAppData) / "Velocity-DB";
        CoTaskMemFree(localAppData);
    } else {
        // Fallback to current directory
        m_settingsPath = std::filesystem::current_path() / ".velocitydb";
    }

    // Ensure directory exists
    std::filesystem::create_directories(m_settingsPath);
    m_settingsPath /= "settings.json";
}

std::expected<void, std::string> SettingsManager::load() {
    std::lock_guard lock(m_mutex);

    if (!std::filesystem::exists(m_settingsPath)) {
        std::ofstream file(m_settingsPath);
        if (!file.is_open()) {
            return std::unexpected(std::format("Failed to create default settings file: {}", m_settingsPath.string()));
        }
        file << serializeSettings();
        if (!file.good()) {
            return std::unexpected(std::format("Failed to write default settings file: {}", m_settingsPath.string()));
        }
        return {};
    }

    std::ifstream file(m_settingsPath);
    if (!file.is_open()) {
        return std::unexpected(std::format("Failed to open settings file: {}", m_settingsPath.string()));
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    if (!deserializeSettings(buffer.str())) {
        return std::unexpected("Failed to parse settings file");
    }
    return {};
}

std::expected<void, std::string> SettingsManager::save() {
    std::lock_guard lock(m_mutex);

    auto json = serializeSettings();
    if (json.empty()) {
        return std::unexpected("Serialization failed — preserving existing file");
    }

    std::ofstream file(m_settingsPath);
    if (!file.is_open()) {
        return std::unexpected(std::format("Failed to open settings file for writing: {}", m_settingsPath.string()));
    }

    file << json;
    if (!file.good()) {
        return std::unexpected(std::format("Failed to write settings file: {}", m_settingsPath.string()));
    }
    return {};
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
    if (auto it = std::ranges::find(m_settings.connectionProfiles, profile.id, &ConnectionProfile::id); it != m_settings.connectionProfiles.end()) {
        *it = profile;
    }
}

void SettingsManager::removeConnectionProfile(const std::string& id) {
    std::lock_guard lock(m_mutex);
    std::erase_if(m_settings.connectionProfiles, [&id](const ConnectionProfile& p) { return p.id == id; });
}

std::optional<ConnectionProfile> SettingsManager::getConnectionProfile(const std::string& id) const {
    std::lock_guard lock(m_mutex);
    if (auto it = std::ranges::find(m_settings.connectionProfiles, id, &ConnectionProfile::id); it != m_settings.connectionProfiles.end()) {
        return *it;
    }
    return std::nullopt;
}

const std::vector<ConnectionProfile>& SettingsManager::getConnectionProfiles() const {
    return m_settings.connectionProfiles;
}

std::expected<void, std::string> SettingsManager::setProfilePassword(const std::string& profileId, std::string_view plainPassword) {
    std::lock_guard lock(m_mutex);

    auto it = std::ranges::find(m_settings.connectionProfiles, profileId, &ConnectionProfile::id);
    if (it == m_settings.connectionProfiles.end()) {
        return std::unexpected("Profile not found: " + profileId);
    }

    if (plainPassword.empty()) {
        it->encryptedPassword.clear();
        it->savePassword = false;
        return {};
    }

    auto encryptResult = CredentialProtector::encrypt(plainPassword);
    if (!encryptResult) {
        return std::unexpected(encryptResult.error());
    }

    it->encryptedPassword = encryptResult.value();
    it->savePassword = true;
    return {};
}

std::expected<std::string, std::string> SettingsManager::getProfilePassword(const std::string& profileId) const {
    std::lock_guard lock(m_mutex);

    auto it = std::ranges::find(m_settings.connectionProfiles, profileId, &ConnectionProfile::id);
    if (it == m_settings.connectionProfiles.end()) {
        return std::unexpected("Profile not found: " + profileId);
    }

    if (it->encryptedPassword.empty()) {
        return std::string{};
    }
    return CredentialProtector::decrypt(it->encryptedPassword);
}

std::filesystem::path SettingsManager::getSettingsPath() const {
    return m_settingsPath;
}

std::expected<void, std::string> SettingsManager::setSshPassword(const std::string& profileId, std::string_view plainPassword) {
    std::lock_guard lock(m_mutex);

    auto it = std::ranges::find(m_settings.connectionProfiles, profileId, &ConnectionProfile::id);
    if (it == m_settings.connectionProfiles.end()) {
        return std::unexpected("Profile not found: " + profileId);
    }

    if (plainPassword.empty()) {
        it->ssh.encryptedPassword.clear();
        return {};
    }

    auto encryptResult = CredentialProtector::encrypt(plainPassword);
    if (!encryptResult) {
        return std::unexpected(encryptResult.error());
    }

    it->ssh.encryptedPassword = encryptResult.value();
    return {};
}

std::expected<std::string, std::string> SettingsManager::getSshPassword(const std::string& profileId) const {
    std::lock_guard lock(m_mutex);

    auto it = std::ranges::find(m_settings.connectionProfiles, profileId, &ConnectionProfile::id);
    if (it == m_settings.connectionProfiles.end()) {
        return std::unexpected("Profile not found: " + profileId);
    }

    if (it->ssh.encryptedPassword.empty()) {
        return std::string{};
    }
    return CredentialProtector::decrypt(it->ssh.encryptedPassword);
}

std::expected<void, std::string> SettingsManager::setSshKeyPassphrase(const std::string& profileId, std::string_view passphrase) {
    std::lock_guard lock(m_mutex);

    auto it = std::ranges::find(m_settings.connectionProfiles, profileId, &ConnectionProfile::id);
    if (it == m_settings.connectionProfiles.end()) {
        return std::unexpected("Profile not found: " + profileId);
    }

    if (passphrase.empty()) {
        it->ssh.encryptedKeyPassphrase.clear();
        return {};
    }

    auto encryptResult = CredentialProtector::encrypt(passphrase);
    if (!encryptResult) {
        return std::unexpected(encryptResult.error());
    }

    it->ssh.encryptedKeyPassphrase = encryptResult.value();
    return {};
}

std::expected<std::string, std::string> SettingsManager::getSshKeyPassphrase(const std::string& profileId) const {
    std::lock_guard lock(m_mutex);

    auto it = std::ranges::find(m_settings.connectionProfiles, profileId, &ConnectionProfile::id);
    if (it == m_settings.connectionProfiles.end()) {
        return std::unexpected("Profile not found: " + profileId);
    }

    if (it->ssh.encryptedKeyPassphrase.empty()) {
        return std::string{};
    }
    return CredentialProtector::decrypt(it->ssh.encryptedKeyPassphrase);
}

std::string SettingsManager::serializeSettings() const {
    std::string buffer;
    if (auto ec = glz::write<glz::opts{.prettify = true}>(m_settings, buffer); bool(ec)) {
        log<LogLevel::WARNING>("Failed to serialize settings");
        return {};
    }
    return buffer;
}

bool SettingsManager::deserializeSettings(std::string_view json) {
    auto ec = glz::read_json(m_settings, json);
    if (bool(ec)) {
        log<LogLevel::WARNING>(std::format("Failed to parse settings.json: {}", glz::format_error(ec, json)));
        return false;
    }
    return true;
}

}  // namespace velocitydb
