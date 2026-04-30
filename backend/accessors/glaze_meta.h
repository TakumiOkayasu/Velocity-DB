#pragma once

#include "session_accessor.h"
#include "settings_accessor.h"

#include <glaze/glaze.hpp>

// --- Enum ---

template <>
struct glz::meta<velocitydb::SshAuthType> {
    using enum velocitydb::SshAuthType;
    static constexpr auto value = enumerate("password", Password, "privateKey", PrivateKey);
};

// --- Settings structs ---

template <>
struct glz::meta<velocitydb::SshConfig> {
    using T = velocitydb::SshConfig;
    static constexpr auto value = object("enabled", &T::enabled, "host", &T::host, "port", &T::port, "username", &T::username, "authType", &T::authType, "encryptedPassword", &T::encryptedPassword,
                                         "privateKeyPath", &T::privateKeyPath, "encryptedKeyPassphrase", &T::encryptedKeyPassphrase);
};

template <>
struct glz::meta<velocitydb::ConnectionProfile> {
    using T = velocitydb::ConnectionProfile;
    static constexpr auto value = object("id", &T::id, "name", &T::name, "server", &T::server, "port", &T::port, "database", &T::database, "username", &T::username, "useWindowsAuth",
                                         &T::useWindowsAuth, "savePassword", &T::savePassword, "encryptedPassword", &T::encryptedPassword, "isProduction", &T::isProduction, "isReadOnly",
                                         &T::isReadOnly, "environment", &T::environment, "dbType", &T::dbType, "folderPath", &T::folderPath, "ssh", &T::ssh);
};

template <>
struct glz::meta<velocitydb::EditorSettings> {
    using T = velocitydb::EditorSettings;
    static constexpr auto value = object("fontSize", &T::fontSize, "fontFamily", &T::fontFamily, "wordWrap", &T::wordWrap, "tabSize", &T::tabSize, "insertSpaces", &T::insertSpaces, "showLineNumbers",
                                         &T::showLineNumbers, "showMinimap", &T::showMinimap, "theme", &T::theme);
};

template <>
struct glz::meta<velocitydb::GridSettings> {
    using T = velocitydb::GridSettings;
    static constexpr auto value =
        object("defaultPageSize", &T::defaultPageSize, "showRowNumbers", &T::showRowNumbers, "enableCellEditing", &T::enableCellEditing, "dateFormat", &T::dateFormat, "nullDisplay", &T::nullDisplay);
};

template <>
struct glz::meta<velocitydb::GeneralSettings> {
    using T = velocitydb::GeneralSettings;
    static constexpr auto value = object("autoConnect", &T::autoConnect, "lastConnectionId", &T::lastConnectionId, "confirmOnExit", &T::confirmOnExit, "maxQueryHistory", &T::maxQueryHistory,
                                         "maxRecentConnections", &T::maxRecentConnections, "language", &T::language);
};

template <>
struct glz::meta<velocitydb::WindowSettings> {
    using T = velocitydb::WindowSettings;
    static constexpr auto value = object("width", &T::width, "height", &T::height, "x", &T::x, "y", &T::y, "isMaximized", &T::isMaximized);
};

template <>
struct glz::meta<velocitydb::QuerySettings> {
    using T = velocitydb::QuerySettings;
    static constexpr auto value = object("timeoutSeconds", &T::timeoutSeconds);
};

template <>
struct glz::meta<velocitydb::AppSettings> {
    using T = velocitydb::AppSettings;
    static constexpr auto value = object("general", &T::general, "editor", &T::editor, "grid", &T::grid, "query", &T::query, "window", &T::window, "connectionProfiles", &T::connectionProfiles);
};

// --- Session structs ---

template <>
struct glz::meta<velocitydb::EditorTab> {
    using T = velocitydb::EditorTab;
    static constexpr auto value =
        object("id", &T::id, "title", &T::title, "content", &T::content, "filePath", &T::filePath, "isDirty", &T::isDirty, "cursorLine", &T::cursorLine, "cursorColumn", &T::cursorColumn);
};

template <>
struct glz::meta<velocitydb::SessionState> {
    using T = velocitydb::SessionState;
    static constexpr auto value = object("activeConnectionId", &T::activeConnectionId, "activeTabId", &T::activeTabId, "openTabs", &T::openTabs, "expandedTreeNodes", &T::expandedTreeNodes,
                                         "windowWidth", &T::windowWidth, "windowHeight", &T::windowHeight, "windowX", &T::windowX, "windowY", &T::windowY, "isMaximized", &T::isMaximized,
                                         "leftPanelWidth", &T::leftPanelWidth, "bottomPanelHeight", &T::bottomPanelHeight, "lastSaved", glz::custom<&T::readLastSavedEpoch, &T::writeLastSavedEpoch>);
};
