#include "session_manager.h"

#include "json_utils.h"
#include "simdjson.h"

#include <Windows.h>

#include <format>
#include <fstream>
#include <sstream>

#include <ShlObj.h>

namespace predategrip {

SessionManager::SessionManager() {
    // Get AppData\Local path
    wchar_t* localAppData = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
        m_sessionPath = std::filesystem::path(localAppData) / "Pre-DateGrip";
        CoTaskMemFree(localAppData);
    } else {
        m_sessionPath = std::filesystem::current_path() / ".predategrip";
    }

    std::filesystem::create_directories(m_sessionPath);
    m_sessionPath /= "session.json";
}

bool SessionManager::load() {
    std::lock_guard lock(m_mutex);

    if (!std::filesystem::exists(m_sessionPath)) {
        return true;  // No session to restore, use defaults
    }

    std::ifstream file(m_sessionPath);
    if (!file.is_open()) {
        return false;
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    return deserializeSession(buffer.str());
}

bool SessionManager::save() {
    std::lock_guard lock(m_mutex);

    m_state.lastSaved = std::chrono::system_clock::now();

    std::ofstream file(m_sessionPath);
    if (!file.is_open()) {
        return false;
    }

    file << serializeSession();
    return file.good();
}

void SessionManager::updateState(const SessionState& state) {
    std::lock_guard lock(m_mutex);
    m_state = state;
}

void SessionManager::addTab(const EditorTab& tab) {
    std::lock_guard lock(m_mutex);
    m_state.openTabs.push_back(tab);
}

void SessionManager::updateTab(const EditorTab& tab) {
    std::lock_guard lock(m_mutex);
    for (auto& existing : m_state.openTabs) {
        if (existing.id == tab.id) {
            existing = tab;
            return;
        }
    }
}

void SessionManager::removeTab(const std::string& tabId) {
    std::lock_guard lock(m_mutex);
    auto& tabs = m_state.openTabs;
    tabs.erase(std::remove_if(tabs.begin(), tabs.end(), [&tabId](const EditorTab& t) { return t.id == tabId; }), tabs.end());
}

void SessionManager::setActiveTab(const std::string& tabId) {
    std::lock_guard lock(m_mutex);
    m_state.activeTabId = tabId;
}

void SessionManager::updateWindowState(int x, int y, int width, int height, bool maximized) {
    std::lock_guard lock(m_mutex);
    m_state.windowX = x;
    m_state.windowY = y;
    m_state.windowWidth = width;
    m_state.windowHeight = height;
    m_state.isMaximized = maximized;
}

void SessionManager::updatePanelSizes(int leftWidth, int bottomHeight) {
    std::lock_guard lock(m_mutex);
    m_state.leftPanelWidth = leftWidth;
    m_state.bottomPanelHeight = bottomHeight;
}

void SessionManager::setActiveConnection(const std::string& connectionId) {
    std::lock_guard lock(m_mutex);
    m_state.activeConnectionId = connectionId;
}

void SessionManager::setExpandedNodes(const std::vector<std::string>& nodeIds) {
    std::lock_guard lock(m_mutex);
    m_state.expandedTreeNodes = nodeIds;
}

void SessionManager::enableAutoSave(int intervalSeconds) {
    m_autoSaveEnabled = true;
    m_autoSaveInterval = intervalSeconds;
}

void SessionManager::disableAutoSave() {
    m_autoSaveEnabled = false;
}

std::filesystem::path SessionManager::getSessionPath() const {
    return m_sessionPath;
}

std::string SessionManager::serializeSession() const {
    std::string json = "{\n";

    // Basic state
    json += std::format("  \"activeConnectionId\": \"{}\",\n", JsonUtils::escapeString(m_state.activeConnectionId));
    json += std::format("  \"activeTabId\": \"{}\",\n", JsonUtils::escapeString(m_state.activeTabId));

    // Window state
    json += std::format("  \"windowX\": {},\n", m_state.windowX);
    json += std::format("  \"windowY\": {},\n", m_state.windowY);
    json += std::format("  \"windowWidth\": {},\n", m_state.windowWidth);
    json += std::format("  \"windowHeight\": {},\n", m_state.windowHeight);
    json += std::format("  \"isMaximized\": {},\n", m_state.isMaximized ? "true" : "false");
    json += std::format("  \"leftPanelWidth\": {},\n", m_state.leftPanelWidth);
    json += std::format("  \"bottomPanelHeight\": {},\n", m_state.bottomPanelHeight);

    // Last saved timestamp
    auto timestamp = std::chrono::duration_cast<std::chrono::seconds>(m_state.lastSaved.time_since_epoch()).count();
    json += std::format("  \"lastSaved\": {},\n", timestamp);

    // Open tabs
    json += "  \"openTabs\": [\n";
    for (size_t i = 0; i < m_state.openTabs.size(); ++i) {
        const auto& tab = m_state.openTabs[i];
        json += "    {\n";
        json += std::format("      \"id\": \"{}\",\n", JsonUtils::escapeString(tab.id));
        json += std::format("      \"title\": \"{}\",\n", JsonUtils::escapeString(tab.title));
        json += std::format("      \"content\": \"{}\",\n", JsonUtils::escapeString(tab.content));
        json += std::format("      \"filePath\": \"{}\",\n", JsonUtils::escapeString(tab.filePath));
        json += std::format("      \"isDirty\": {},\n", tab.isDirty ? "true" : "false");
        json += std::format("      \"cursorLine\": {},\n", tab.cursorLine);
        json += std::format("      \"cursorColumn\": {}\n", tab.cursorColumn);
        json += i < m_state.openTabs.size() - 1 ? "    },\n" : "    }\n";
    }
    json += "  ],\n";

    // Expanded tree nodes
    json += "  \"expandedTreeNodes\": [";
    for (size_t i = 0; i < m_state.expandedTreeNodes.size(); ++i) {
        if (i > 0)
            json += ", ";
        json += std::format("\"{}\"", JsonUtils::escapeString(m_state.expandedTreeNodes[i]));
    }
    json += "]\n";

    json += "}\n";
    return json;
}

bool SessionManager::deserializeSession(std::string_view jsonStr) {
    try {
        simdjson::dom::parser parser;
        simdjson::dom::element doc = parser.parse(jsonStr);

        // Basic state
        if (auto val = doc["activeConnectionId"].get_string(); !val.error())
            m_state.activeConnectionId = std::string(val.value());
        if (auto val = doc["activeTabId"].get_string(); !val.error())
            m_state.activeTabId = std::string(val.value());

        // Window state
        if (auto val = doc["windowX"].get_int64(); !val.error())
            m_state.windowX = static_cast<int>(val.value());
        if (auto val = doc["windowY"].get_int64(); !val.error())
            m_state.windowY = static_cast<int>(val.value());
        if (auto val = doc["windowWidth"].get_int64(); !val.error())
            m_state.windowWidth = static_cast<int>(val.value());
        if (auto val = doc["windowHeight"].get_int64(); !val.error())
            m_state.windowHeight = static_cast<int>(val.value());
        if (auto val = doc["isMaximized"].get_bool(); !val.error())
            m_state.isMaximized = val.value();
        if (auto val = doc["leftPanelWidth"].get_int64(); !val.error())
            m_state.leftPanelWidth = static_cast<int>(val.value());
        if (auto val = doc["bottomPanelHeight"].get_int64(); !val.error())
            m_state.bottomPanelHeight = static_cast<int>(val.value());

        // Last saved timestamp
        if (auto val = doc["lastSaved"].get_int64(); !val.error()) {
            m_state.lastSaved = std::chrono::system_clock::time_point(std::chrono::seconds(val.value()));
        }

        // Open tabs
        m_state.openTabs.clear();
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
                    tab.cursorLine = static_cast<int>(val.value());
                if (auto val = tabEl["cursorColumn"].get_int64(); !val.error())
                    tab.cursorColumn = static_cast<int>(val.value());
                m_state.openTabs.push_back(tab);
            }
        }

        // Expanded tree nodes
        m_state.expandedTreeNodes.clear();
        if (auto nodes = doc["expandedTreeNodes"].get_array(); !nodes.error()) {
            for (auto nodeEl : nodes.value()) {
                if (auto val = nodeEl.get_string(); !val.error()) {
                    m_state.expandedTreeNodes.push_back(std::string(val.value()));
                }
            }
        }

        return true;
    } catch (...) {
        return false;
    }
}

}  // namespace predategrip
