#include "webview_app.h"

#include "ipc_handler.h"
#include "simdjson.h"
#include "utils/logger.h"
#include "utils/settings_manager.h"
#include "webview.h"

#include <array>
#include <format>
#include <fstream>

namespace velocitydb {

namespace {

// Extract the first string argument from a JSON array
// webview's bind passes arguments as a JSON array, e.g., ["arg1", "arg2"]
std::string extractFirstArgument(const std::string& jsonArray) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(jsonArray);
        auto arr = doc.get_array();
        if (arr.error()) {
            return jsonArray;  // Fallback: treat as raw string
        }
        auto firstElem = arr.at(0);
        if (firstElem.error()) {
            return "";
        }
        auto strValue = firstElem.get_string();
        if (strValue.error()) {
            return "";
        }
        return std::string(strValue.value());
    } catch (...) {
        return jsonArray;  // Fallback: treat as raw string
    }
}

}  // namespace

WebViewApp::WebViewApp(HINSTANCE hInstance) : m_hInstance(hInstance), m_ipcHandler(std::make_unique<IPCHandler>()), m_webview(nullptr), m_settingsManager(std::make_unique<SettingsManager>()) {
    // Load settings
    m_settingsManager->load();
}

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

WebViewApp::WindowSize WebViewApp::calculateWindowSize() const {
    const auto& windowSettings = m_settingsManager->getSettings().window;

    // If we have saved settings and they are valid, use them
    if (windowSettings.width > 0 && windowSettings.height > 0) {
        return WindowSize{.width = windowSettings.width, .height = windowSettings.height, .x = windowSettings.x, .y = windowSettings.y};
    }

    // First launch: use 80% of screen size
    const int screenWidth = GetSystemMetrics(SM_CXSCREEN);
    const int screenHeight = GetSystemMetrics(SM_CYSCREEN);

    const int width = static_cast<int>(screenWidth * 0.8);
    const int height = static_cast<int>(screenHeight * 0.8);

    // Center the window
    const int x = (screenWidth - width) / 2;
    const int y = (screenHeight - height) / 2;

    return WindowSize{.width = width, .height = height, .x = x, .y = y};
}

void WebViewApp::saveWindowSettings() {
    // Note: webview library doesn't provide API to get window size/position
    // This would need to be implemented by getting the window handle and using Win32 APIs
    // For now, this is a placeholder that would be called on window close
}

void WebViewApp::createAndConfigureWebView() {
    m_webview = std::make_unique<webview::webview>(true, nullptr);

    m_webview->set_title("Velocity-DB");

    // Calculate and set window size
    const auto windowSize = calculateWindowSize();
    m_webview->set_size(windowSize.width, windowSize.height, WEBVIEW_HINT_NONE);

    // Disable browser cache to always load fresh content
    m_webview->set_disable_cache(true);

    m_webview->bind("invoke", [this](const std::string& request) -> std::string {
        // webview passes arguments as a JSON array, extract the first string argument
        auto actualRequest = extractFirstArgument(request);
        auto result = m_ipcHandler->dispatchRequest(actualRequest);
        return result;
    });

    if (auto frontendPath = locateFrontendDirectory()) {
        // Get the directory containing index.html
        auto frontendDir = std::filesystem::absolute(*frontendPath).parent_path();
        auto pathStr = frontendDir.string();
        m_webview->set_frontend_path(pathStr);

        log<LogLevel::INFO>(std::format("[WebView] Frontend path: {}", pathStr));
        log<LogLevel::INFO>(std::format("[WebView] index.html: {}", frontendPath->string()));
        log_flush();

        // Use virtual host to avoid CORS issues with file:// protocol
        m_webview->navigate("https://app.local/index.html");
    } else {
        // Fallback to dev server
        log<LogLevel::WARNING>("[WebView] Frontend not found, falling back to dev server");
        log_flush();
        m_webview->navigate("http://localhost:5173");
    }
}

}  // namespace velocitydb
