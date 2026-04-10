#pragma once

#include <chrono>
#include <expected>
#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

namespace velocitydb {

struct EditorTab {
    std::string id;
    std::string title;
    std::string content;
    std::string filePath;
    bool isDirty = false;
    int cursorLine = 1;
    int cursorColumn = 1;
};

struct SessionState {
    std::string activeConnectionId;
    std::string activeTabId;
    std::vector<EditorTab> openTabs;
    std::vector<std::string> expandedTreeNodes;
    int windowWidth = 1280;
    int windowHeight = 720;
    int windowX = 100;
    int windowY = 100;
    bool isMaximized = false;
    int leftPanelWidth = 250;
    int bottomPanelHeight = 200;
    std::chrono::system_clock::time_point lastSaved;

    // Glaze custom serialization (lastSaved as Unix epoch seconds)
    void readLastSavedEpoch(int64_t epoch) { lastSaved = std::chrono::system_clock::time_point(std::chrono::seconds(epoch)); }
    [[nodiscard]] int64_t writeLastSavedEpoch() const { return std::chrono::duration_cast<std::chrono::seconds>(lastSaved.time_since_epoch()).count(); }
};

class SessionManager {
public:
    SessionManager();
    ~SessionManager() = default;

    SessionManager(const SessionManager&) = delete;
    SessionManager& operator=(const SessionManager&) = delete;

    /// Load session state from disk
    [[nodiscard]] std::expected<void, std::string> load();

    /// Save session state to disk
    [[nodiscard]] std::expected<void, std::string> save();

    /// Get current session state
    [[nodiscard]] const SessionState& getState() const { return m_state; }

    /// Update session state
    void updateState(const SessionState& state);

    /// Tab management
    void addTab(const EditorTab& tab);
    void updateTab(const EditorTab& tab);
    void removeTab(const std::string& tabId);
    void setActiveTab(const std::string& tabId);

    /// Window state
    void updateWindowState(int x, int y, int width, int height, bool maximized);
    void updatePanelSizes(int leftWidth, int bottomHeight);

    /// Connection state
    void setActiveConnection(const std::string& connectionId);

    /// Tree state
    void setExpandedNodes(const std::vector<std::string>& nodeIds);

    /// Auto-save support
    void enableAutoSave(int intervalSeconds = 30);
    void disableAutoSave();

    /// Get session file path
    [[nodiscard]] std::filesystem::path getSessionPath() const;

private:
    [[nodiscard]] std::string serializeSession() const;
    bool deserializeSession(std::string_view json);

    SessionState m_state;
    std::filesystem::path m_sessionPath;
    mutable std::mutex m_mutex;
    bool m_autoSaveEnabled = false;
    int m_autoSaveInterval = 30;
};

}  // namespace velocitydb
