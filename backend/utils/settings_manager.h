#pragma once

#include <expected>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace velocitydb {

using SettingValue = std::variant<bool, int, double, std::string>;

enum class SshAuthType { Password, PrivateKey };

struct SshConfig {
    bool enabled = false;
    std::string host;
    int port = 22;
    std::string username;
    SshAuthType authType = SshAuthType::Password;
    std::string encryptedPassword;       // For password auth
    std::string privateKeyPath;          // For key auth
    std::string encryptedKeyPassphrase;  // For encrypted private keys
};

struct ConnectionProfile {
    std::string id;
    std::string name;
    std::string server;
    int port = 1433;
    std::string database;
    std::string username;
    bool useWindowsAuth = true;
    bool savePassword = false;
    std::string encryptedPassword;
    bool isProduction = false;                // Production environment flag - enables safety features
    bool isReadOnly = false;                  // Read-only mode - prevents data modifications
    std::string environment = "development";  // development, staging, production
    std::string dbType = "sqlserver";         // sqlserver, postgresql, mysql
    SshConfig ssh;                            // SSH tunnel configuration
};

struct EditorSettings {
    int fontSize = 14;
    std::string fontFamily = "Consolas";
    bool wordWrap = false;
    int tabSize = 4;
    bool insertSpaces = true;
    bool showLineNumbers = true;
    bool showMinimap = true;
    std::string theme = "vs-dark";
};

struct GridSettings {
    int defaultPageSize = 100000;
    bool showRowNumbers = true;
    bool enableCellEditing = false;
    std::string dateFormat = "yyyy-MM-dd HH:mm:ss";
    std::string nullDisplay = "(NULL)";
};

struct GeneralSettings {
    bool autoConnect = false;
    std::string lastConnectionId;
    bool confirmOnExit = true;
    int maxQueryHistory = 1000;
    int maxRecentConnections = 10;
    std::string language = "en";
};

struct WindowSettings {
    int width = 0;   // 0 means not set (use default)
    int height = 0;  // 0 means not set (use default)
    int x = -1;      // -1 means centered
    int y = -1;      // -1 means centered
    bool isMaximized = false;
};

struct AppSettings {
    GeneralSettings general;
    EditorSettings editor;
    GridSettings grid;
    WindowSettings window;
    std::vector<ConnectionProfile> connectionProfiles;
};

class SettingsManager {
public:
    SettingsManager();
    ~SettingsManager() = default;

    SettingsManager(const SettingsManager&) = delete;
    SettingsManager& operator=(const SettingsManager&) = delete;

    /// Load settings from disk
    bool load();

    /// Save settings to disk
    bool save();

    /// Get current settings
    [[nodiscard]] const AppSettings& getSettings() const { return m_settings; }

    /// Update settings
    void updateSettings(const AppSettings& settings);

    /// Connection profile management
    void addConnectionProfile(const ConnectionProfile& profile);
    void updateConnectionProfile(const ConnectionProfile& profile);
    void removeConnectionProfile(const std::string& id);
    [[nodiscard]] std::optional<ConnectionProfile> getConnectionProfile(const std::string& id) const;
    [[nodiscard]] const std::vector<ConnectionProfile>& getConnectionProfiles() const;

    /// Password management using DPAPI encryption
    /// @param profileId The profile to set password for
    /// @param plainPassword The plaintext password to encrypt and store
    /// @return true on success, error message on failure
    [[nodiscard]] std::expected<void, std::string> setProfilePassword(const std::string& profileId, std::string_view plainPassword);

    /// Get decrypted password for a connection profile
    /// @param profileId The profile to get password for
    /// @return Decrypted password, or error message if decryption fails
    [[nodiscard]] std::expected<std::string, std::string> getProfilePassword(const std::string& profileId) const;

    /// SSH password management using DPAPI encryption
    /// @param profileId The profile to set SSH password for
    /// @param plainPassword The plaintext SSH password to encrypt and store
    [[nodiscard]] std::expected<void, std::string> setSshPassword(const std::string& profileId, std::string_view plainPassword);

    /// Get decrypted SSH password for a connection profile
    [[nodiscard]] std::expected<std::string, std::string> getSshPassword(const std::string& profileId) const;

    /// SSH key passphrase management using DPAPI encryption
    [[nodiscard]] std::expected<void, std::string> setSshKeyPassphrase(const std::string& profileId, std::string_view passphrase);

    /// Get decrypted SSH key passphrase for a connection profile
    [[nodiscard]] std::expected<std::string, std::string> getSshKeyPassphrase(const std::string& profileId) const;

    /// Get settings file path
    [[nodiscard]] std::filesystem::path getSettingsPath() const;

private:
    [[nodiscard]] std::string serializeSettings() const;
    bool deserializeSettings(std::string_view json);

    AppSettings m_settings;
    std::filesystem::path m_settingsPath;
    mutable std::mutex m_mutex;
};

}  // namespace velocitydb
