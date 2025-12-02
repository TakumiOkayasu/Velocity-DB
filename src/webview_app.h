#pragma once

#include <Windows.h>
#include <memory>
#include <string>

namespace predategrip {

class IPCHandler;

class WebViewApp {
public:
    explicit WebViewApp(HINSTANCE hInstance);
    ~WebViewApp();

    WebViewApp(const WebViewApp&) = delete;
    WebViewApp& operator=(const WebViewApp&) = delete;

    int run();

private:
    void initializeWebView();
    std::wstring getExecutablePath() const;

    HINSTANCE m_hInstance;
    std::unique_ptr<IPCHandler> m_ipcHandler;
    void* m_webview = nullptr;  // webview::webview*
};

}  // namespace predategrip
