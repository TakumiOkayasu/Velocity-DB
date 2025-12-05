#include "webview_app.h"

#include "ipc_handler.h"
#include "simdjson.h"
#include "webview.h"

#include <array>
#include <format>
#include <fstream>

namespace predategrip {

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

WebViewApp::WebViewApp(HINSTANCE hInstance) : m_hInstance(hInstance), m_ipcHandler(std::make_unique<IPCHandler>()), m_webview(nullptr) {}

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

    // Disable browser cache to always load fresh content
    m_webview->set_disable_cache(true);

    m_webview->bind("invoke", [this](const std::string& request) -> std::string {
        // DEBUG: Log raw request to file
        {
            std::ofstream debugLog("predategrip_debug.log", std::ios::app);
            debugLog << "Raw request: " << request << "\n";
        }
        // webview passes arguments as a JSON array, extract the first string argument
        auto actualRequest = extractFirstArgument(request);
        {
            std::ofstream debugLog("predategrip_debug.log", std::ios::app);
            debugLog << "Extracted request: " << actualRequest << "\n\n";
        }
        auto result = m_ipcHandler->dispatchRequest(actualRequest);
        {
            std::ofstream debugLog("predategrip_debug.log", std::ios::app);
            debugLog << "Returning to JS: " << result << "\n\n";
        }
        return result;
    });

    if (auto frontendPath = locateFrontendDirectory()) {
        // Get the directory containing index.html
        auto frontendDir = std::filesystem::absolute(*frontendPath).parent_path();
        m_webview->set_frontend_path(frontendDir.generic_string());

        // Use virtual host to avoid CORS issues with file:// protocol
        m_webview->navigate("https://app.local/index.html");
    } else {
        // Fallback to dev server
        m_webview->navigate("http://localhost:5173");
    }
}

}  // namespace predategrip
