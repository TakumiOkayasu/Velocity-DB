#include "webview_app.h"
#include "ipc_handler.h"
#include "webview.h"
#include <filesystem>

namespace predategrip {

WebViewApp::WebViewApp(HINSTANCE hInstance)
    : m_hInstance(hInstance)
    , m_ipcHandler(std::make_unique<IPCHandler>())
{
}

WebViewApp::~WebViewApp() {
    if (m_webview) {
        delete static_cast<webview::webview*>(m_webview);
    }
}

int WebViewApp::run() {
    initializeWebView();

    auto* wv = static_cast<webview::webview*>(m_webview);
    wv->run();

    return 0;
}

void WebViewApp::initializeWebView() {
    auto* wv = new webview::webview(true, nullptr);
    m_webview = wv;

    wv->set_title("Pre-DateGrip");
    wv->set_size(1280, 800, WEBVIEW_HINT_NONE);

    // Bind IPC handler
    wv->bind("invoke", [this](const std::string& request) -> std::string {
        return m_ipcHandler->handle(request);
    });

    // Load frontend
    auto exePath = getExecutablePath();
    auto exeDir = std::filesystem::path(exePath).parent_path();

    // Try multiple paths in order:
    // 1. Built distribution: exe_dir/frontend/index.html (packaged app)
    // 2. Development build: project_root/frontend/dist/index.html
    std::vector<std::filesystem::path> searchPaths = {
        exeDir / "frontend" / "index.html",
        exeDir.parent_path().parent_path().parent_path() / "frontend" / "dist" / "index.html",  // Debug/Release build
        exeDir.parent_path().parent_path() / "frontend" / "dist" / "index.html",
    };

    std::filesystem::path frontendPath;
    for (const auto& path : searchPaths) {
        if (std::filesystem::exists(path)) {
            frontendPath = path;
            break;
        }
    }

    if (!frontendPath.empty()) {
        wv->navigate("file:///" + frontendPath.generic_string());
    } else {
        // Development mode: load from Vite dev server
        wv->navigate("http://localhost:5173");
    }
}

std::wstring WebViewApp::getExecutablePath() const {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(m_hInstance, path, MAX_PATH);
    return std::wstring(path);
}

}  // namespace predategrip
