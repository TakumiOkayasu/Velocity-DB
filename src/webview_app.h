#pragma once

#include <Windows.h>

#include <expected>
#include <filesystem>
#include <memory>
#include <string>

namespace webview {
class webview;
}

namespace predategrip {

class IPCHandler;
class SettingsManager;

class WebViewApp {
public:
    explicit WebViewApp(HINSTANCE hInstance);
    ~WebViewApp();

    WebViewApp(const WebViewApp&) = delete;
    WebViewApp& operator=(const WebViewApp&) = delete;
    WebViewApp(WebViewApp&&) = delete;
    WebViewApp& operator=(WebViewApp&&) = delete;

    [[nodiscard]] int run();

private:
    void createAndConfigureWebView();
    [[nodiscard]] std::filesystem::path computeExecutablePath() const;
    [[nodiscard]] std::expected<std::filesystem::path, std::string> locateFrontendDirectory() const;

    struct WindowSize {
        int width;
        int height;
        int x;
        int y;
    };
    [[nodiscard]] WindowSize calculateWindowSize() const;
    void saveWindowSettings();

    HINSTANCE m_hInstance;
    std::unique_ptr<IPCHandler> m_ipcHandler;
    std::unique_ptr<webview::webview> m_webview;
    std::unique_ptr<SettingsManager> m_settingsManager;
};

}  // namespace predategrip
