#include "webview_app.h"

#include "accessors/settings_accessor.h"
#include "contexts/system_context.h"
#include "host/webview2_host.h"
#include "ipc_handler.h"
#include "utils/build_identity.h"
#include "utils/frontend_build_identity.h"
#include "utils/logger.h"
#include "version_config.h"

#include <array>
#include <format>
#include <stdexcept>
#include <utility>

namespace velocitydb {

WebViewApp::WebViewApp(HINSTANCE hInstance) : WebViewApp(hInstance, makeWebView2Host()) {}

WebViewApp::WebViewApp(HINSTANCE hInstance, std::unique_ptr<IWebViewHost> host) : m_hInstance(hInstance), m_host(std::move(host)) {
    if (!m_host) {
        throw std::invalid_argument("WebView host is required");
    }
    auto settingsAccessor = std::make_unique<SettingsAccessor>();
    // Load once: host configuration and SettingsProvider's startup snapshot share these values.
    (void)settingsAccessor->load();
    const auto windowSize = calculateWindowSize(settingsAccessor->getSettings().window);
    m_hostConfig.title = std::format("Velocity-DB - v{} [{}]", kAppVersion, backendBuildIdentity());
    m_hostConfig.width = windowSize.width;
    m_hostConfig.height = windowSize.height;
    m_hostConfig.webview = settingsAccessor->getSettings().webview;
    m_systemContext = std::make_unique<SystemContext>(std::move(settingsAccessor));
    m_ipcHandler = std::make_unique<IPCHandler>(*m_systemContext);
}

WebViewApp::~WebViewApp() = default;

int WebViewApp::run() {
    configureFrontend();
    return m_host->run(m_hostConfig, [this](std::string_view request) { return m_ipcHandler->dispatchRequest(request); });
}

std::filesystem::path WebViewApp::computeExecutablePath() const {
    std::array<wchar_t, MAX_PATH> pathBuffer{};
    GetModuleFileNameW(m_hInstance, pathBuffer.data(), MAX_PATH);
    return std::filesystem::path(pathBuffer.data());
}

std::expected<std::filesystem::path, std::string> WebViewApp::locateFrontendDirectory() const {
    const auto executableDirectory = computeExecutablePath().parent_path();

    constexpr std::array<const wchar_t*, 3> searchPaths = {
        L"../../frontend/dist/index.html",  // Dev: source dist (always fresh)
        L"frontend/index.html",             // Release: copied by CMake POST_BUILD
        L"../../../frontend/dist/index.html",
    };

    for (const auto* searchPath : searchPaths) {
        auto candidatePath = executableDirectory / searchPath;
        if (std::filesystem::exists(candidatePath)) {
            return candidatePath;
        }
    }

    return std::unexpected("Frontend files not found");
}

WebViewApp::WindowSize WebViewApp::calculateWindowSize(const WindowSettings& windowSettings) const {
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

void WebViewApp::configureFrontend() {
    if (auto frontendPath = locateFrontendDirectory()) {
        // Get the directory containing index.html
        auto frontendDir = std::filesystem::absolute(*frontendPath).parent_path();
        auto pathStr = frontendDir.string();
        m_hostConfig.frontendDirectory = pathStr;

        log<LogLevel::INFO>(std::format("[WebView] Frontend path: {}", pathStr));
        log<LogLevel::INFO>(std::format("[WebView] index.html: {}", frontendPath->string()));
        if (const auto identity = readFrontendBuildIdentity(frontendDir)) {
            m_hostConfig.title += std::format(" [UI {} / {}]", identity->source, identity->fingerprint.substr(0, 12));
            log<LogLevel::INFO>(std::format("[Build] Frontend source {} / SHA256 {}", identity->source, identity->fingerprint));
        } else {
            m_hostConfig.title += " [UI unknown]";
            log<LogLevel::WARNING>("[Build] Frontend identity unknown: build-info.json is missing or invalid");
        }
        log_flush();

        // Use virtual host to avoid CORS issues with file:// protocol
        m_hostConfig.url = "https://app.local/index.html";
    } else {
        // Fallback to dev server
        m_hostConfig.title += " [UI dev server]";
        log<LogLevel::WARNING>("[WebView] Frontend not found, falling back to dev server");
        log_flush();
        m_hostConfig.url = "http://localhost:5173";
    }
}

}  // namespace velocitydb
