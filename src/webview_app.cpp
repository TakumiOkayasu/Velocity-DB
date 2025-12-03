#include "webview_app.h"

#include "ipc_handler.h"
#include "webview.h"

#include <array>
#include <format>

namespace predategrip {

WebViewApp::WebViewApp(HINSTANCE hInstance)
    : m_hInstance(hInstance), m_ipcHandler(std::make_unique<IPCHandler>()), m_webview(nullptr) {}

WebViewApp::~WebViewApp() = default;

int WebViewApp::run() {
    createAndConfigureWebView();
    m_webview->run();
    return 0;
}

std::filesystem::path WebViewApp::computeExecutablePath() const {
    std::array<wchar_t, MAX_PATH> pathBuffer{};
    GetModuleFileNameW(m_hInstance, pathBuffer.data(), MAX_PATH);
    return std::filesystem::path(pathBuffer.data());
}

std::expected<std::filesystem::path, std::string> WebViewApp::locateFrontendDirectory() const {
    const auto executableDirectory = computeExecutablePath().parent_path();

    constexpr std::array<const wchar_t*, 3> searchPaths = {
        L"frontend/index.html",
        L"../../../frontend/dist/index.html",
        L"../../frontend/dist/index.html",
    };

    for (const auto* searchPath : searchPaths) {
        auto candidatePath = executableDirectory / searchPath;
        if (std::filesystem::exists(candidatePath)) {
            return candidatePath;
        }
    }

    return std::unexpected("Frontend files not found");
}

void WebViewApp::createAndConfigureWebView() {
    m_webview = std::make_unique<webview::webview>(true, nullptr);

    m_webview->set_title("Pre-DateGrip");
    m_webview->set_size(1280, 800, WEBVIEW_HINT_NONE);

    m_webview->bind(
        "invoke", [this](const std::string& request) -> std::string { return m_ipcHandler->dispatchRequest(request); });

    if (auto frontendPath = locateFrontendDirectory()) {
        auto url = std::format("file:///{}", frontendPath->generic_string());
#ifdef _DEBUG
        MessageBoxA(nullptr, url.c_str(), "Navigating to URL", MB_OK);
#endif
        m_webview->navigate(url);
    } else {
#ifdef _DEBUG
        MessageBoxA(nullptr, "Frontend not found, falling back to localhost:5173", "Debug Info", MB_OK);
#endif
        m_webview->navigate("http://localhost:5173");
    }
}

}  // namespace predategrip
