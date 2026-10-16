#pragma once

#include "host/webview_host.h"

#include <Windows.h>

#include <expected>
#include <filesystem>
#include <memory>
#include <string>

namespace velocitydb {

class IPCHandler;
class SystemContext;
struct WindowSettings;

class WebViewApp {
public:
    explicit WebViewApp(HINSTANCE hInstance);
    WebViewApp(HINSTANCE hInstance, std::unique_ptr<IWebViewHost> host);
    ~WebViewApp();

    WebViewApp(const WebViewApp&) = delete;
    WebViewApp& operator=(const WebViewApp&) = delete;
    WebViewApp(WebViewApp&&) = delete;
    WebViewApp& operator=(WebViewApp&&) = delete;

    [[nodiscard]] int run();

private:
    void configureFrontend();
    [[nodiscard]] std::filesystem::path computeExecutablePath() const;
    [[nodiscard]] std::expected<std::filesystem::path, std::string> locateFrontendDirectory() const;

    struct WindowSize {
        int width;
        int height;
        int x;
        int y;
    };
    [[nodiscard]] WindowSize calculateWindowSize(const WindowSettings& windowSettings) const;

    HINSTANCE m_hInstance;
    // Destruction order: host first, then handler, then its context.
    std::unique_ptr<SystemContext> m_systemContext;
    std::unique_ptr<IPCHandler> m_ipcHandler;
    WebViewHostConfig m_hostConfig;
    std::unique_ptr<IWebViewHost> m_host;
};

}  // namespace velocitydb
