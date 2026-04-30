#include "accessors/session_accessor.h"

#include "accessors/glaze_meta.h"
#include "utils/logger.h"

#include <Windows.h>

#include <algorithm>
#include <format>
#include <fstream>
#include <sstream>

#include <ShlObj.h>

namespace velocitydb {

SessionAccessor::SessionAccessor() {
    // Get AppData\Local path
    wchar_t* localAppData = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
        m_sessionPath = std::filesystem::path(localAppData) / "Velocity-DB";
        CoTaskMemFree(localAppData);
    } else {
        m_sessionPath = std::filesystem::current_path() / ".velocitydb";
    }

    std::filesystem::create_directories(m_sessionPath);
    m_sessionPath /= "session.json";
}

std::expected<void, std::string> SessionAccessor::load() {
    std::lock_guard lock(m_mutex);

    if (!std::filesystem::exists(m_sessionPath)) {
        return {};  // No session to restore, use defaults
    }

    std::ifstream file(m_sessionPath);
    if (!file.is_open()) {
        return std::unexpected(std::format("Failed to open session file: {}", m_sessionPath.string()));
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    if (!deserializeSession(buffer.str())) {
        return std::unexpected("Failed to parse session file");
    }
    return {};
}

std::expected<void, std::string> SessionAccessor::save() {
    std::lock_guard lock(m_mutex);

    m_state.lastSaved = std::chrono::system_clock::now();

    auto json = serializeSession();
    if (json.empty()) {
        return std::unexpected("Serialization failed — preserving existing file");
    }

    std::ofstream file(m_sessionPath);
    if (!file.is_open()) {
        return std::unexpected(std::format("Failed to open session file for writing: {}", m_sessionPath.string()));
    }

    file << json;
    if (!file.good()) {
        return std::unexpected(std::format("Failed to write session file: {}", m_sessionPath.string()));
    }
    return {};
}

void SessionAccessor::updateState(const SessionState& state) {
    std::lock_guard lock(m_mutex);
    m_state = state;
}

void SessionAccessor::addTab(const EditorTab& tab) {
    std::lock_guard lock(m_mutex);
    m_state.openTabs.push_back(tab);
}

void SessionAccessor::updateTab(const EditorTab& tab) {
    std::lock_guard lock(m_mutex);
    if (auto it = std::ranges::find(m_state.openTabs, tab.id, &EditorTab::id); it != m_state.openTabs.end()) {
        *it = tab;
    }
}

void SessionAccessor::removeTab(const std::string& tabId) {
    std::lock_guard lock(m_mutex);
    std::erase_if(m_state.openTabs, [&tabId](const EditorTab& t) { return t.id == tabId; });
}

void SessionAccessor::setActiveTab(const std::string& tabId) {
    std::lock_guard lock(m_mutex);
    m_state.activeTabId = tabId;
}

void SessionAccessor::updateWindowState(int x, int y, int width, int height, bool maximized) {
    std::lock_guard lock(m_mutex);
    m_state.windowX = x;
    m_state.windowY = y;
    m_state.windowWidth = width;
    m_state.windowHeight = height;
    m_state.isMaximized = maximized;
}

void SessionAccessor::updatePanelSizes(int leftWidth, int bottomHeight) {
    std::lock_guard lock(m_mutex);
    m_state.leftPanelWidth = leftWidth;
    m_state.bottomPanelHeight = bottomHeight;
}

void SessionAccessor::setActiveConnection(const std::string& connectionId) {
    std::lock_guard lock(m_mutex);
    m_state.activeConnectionId = connectionId;
}

void SessionAccessor::setExpandedNodes(const std::vector<std::string>& nodeIds) {
    std::lock_guard lock(m_mutex);
    m_state.expandedTreeNodes = nodeIds;
}

void SessionAccessor::enableAutoSave(int intervalSeconds) {
    m_autoSaveEnabled = true;
    m_autoSaveInterval = intervalSeconds;
}

void SessionAccessor::disableAutoSave() {
    m_autoSaveEnabled = false;
}

std::filesystem::path SessionAccessor::getSessionPath() const {
    return m_sessionPath;
}

std::string SessionAccessor::serializeSession() const {
    std::string buffer;
    if (auto ec = glz::write<glz::opts{.prettify = true}>(m_state, buffer); bool(ec)) {
        log<LogLevel::WARNING>("Failed to serialize session state");
        return {};
    }
    return buffer;
}

bool SessionAccessor::deserializeSession(std::string_view json) {
    auto ec = glz::read_json(m_state, json);
    if (bool(ec)) {
        log<LogLevel::WARNING>(std::format("Failed to parse session.json: {}", glz::format_error(ec, json)));
        return false;
    }
    return true;
}

}  // namespace velocitydb
