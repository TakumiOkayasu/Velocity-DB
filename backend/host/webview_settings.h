#pragma once

namespace velocitydb {

/// Typed startup options shared by the host and persisted application settings.
/// Changes take effect when a new WebView is created on application restart.
struct WebViewSettings {
    bool gpuCompositing = false;
    bool rendererBackgrounding = false;
    bool cacheEnabled = false;
    bool openDevToolsOnStartup = false;

    bool operator==(const WebViewSettings&) const = default;
};

}  // namespace velocitydb
