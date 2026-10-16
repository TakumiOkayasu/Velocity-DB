/*
 * MIT License
 * Copyright (c) 2017 Serge Zaitsev
 * Simplified WebView2 wrapper for Velocity-DB
 */

#ifndef WEBVIEW_H
#define WEBVIEW_H

#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <format>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <utility>
#include <vector>
#include "simdjson.h"

#define WEBVIEW_HINT_NONE 0
#define WEBVIEW_HINT_MIN 1
#define WEBVIEW_HINT_MAX 2
#define WEBVIEW_HINT_FIXED 3

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <Windows.h>
#include <wrl.h>
#include <WebView2.h>
#include <WebView2EnvironmentOptions.h>
#include <shlwapi.h>
#include <dwmapi.h>
// WebView2LoaderStatic.lib is linked via CMake (third_party/CMakeLists.txt)
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "dwmapi.lib")

namespace webview {

// UTF-8 <-> UTF-16 conversion helpers
inline std::wstring utf8_to_utf16(const std::string& str) {
    if (str.empty()) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), nullptr, 0);
    std::wstring result(size, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), &result[0], size);
    return result;
}

inline std::string utf16_to_utf8(const std::wstring& wstr) {
    if (wstr.empty()) return std::string();
    int size = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), (int)wstr.size(), nullptr, 0, nullptr, nullptr);
    std::string result(size, 0);
    WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), (int)wstr.size(), &result[0], size, nullptr, nullptr);
    return result;
}

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

// Custom Windows message for async IPC responses
constexpr UINT WM_IPC_RESPONSE = WM_USER + 1;

struct IPCResponse {
    int64_t requestId;
    std::string response;
};

class webview {
public:
    webview(bool debug = false, void* window = nullptr)
        : m_debug(debug)
        , m_hwnd(nullptr)
        , m_webviewController(nullptr)
        , m_webviewWindow(nullptr)
        , m_disableCache(false)
    {
        if (window) {
            m_hwnd = static_cast<HWND>(window);
        }
    }

    void set_user_data_folder(const std::string& path) { m_userDataFolder = path; }

    void set_disable_cache(bool disable) { m_disableCache = disable; }

    // Supplied only by the native adapter's fixed boolean-to-arguments allowlist.
    void set_browser_arguments(std::wstring arguments) { m_browserArguments = std::move(arguments); }

    void set_diagnostic_callback(std::function<void(bool, const std::string&)> callback) {
        m_diagnosticCallback = std::move(callback);
    }

    ~webview() {
        // COM completions may arrive after Close. They retain only this independent
        // token and return before touching this object once teardown starts.
        // Browser callbacks and destruction run on the creating UI apartment.
        m_callbackAlive->store(false);
        stopWorkerPool();
        if (m_webviewWindow) {
            m_webviewWindow->remove_NewWindowRequested(m_newWindowRequestedToken);
        }
        if (m_webviewController) {
            m_webviewController->Close();
        }
        if (m_hwnd && !m_externalWindow) {
            DestroyWindow(m_hwnd);
        }
    }

    void set_title(const std::string& title) {
        m_title = title;
        if (m_hwnd) {
            SetWindowTextA(m_hwnd, title.c_str());
        }
    }

    void set_size(int width, int height, int hints) {
        m_width = width;
        m_height = height;
        m_hints = hints;
    }

    void navigate(const std::string& url) {
        m_url = url;
        if (m_webviewWindow) {
            std::wstring wurl = utf8_to_utf16(url);
            m_webviewWindow->Navigate(wurl.c_str());
        }
    }

    void bind(const std::string& name, std::function<std::string(const std::string&)> fn) {
        m_bindings[name] = fn;
    }

    int run() {
        if (!m_hwnd) {
            createWindow();
        }
        if (!m_hwnd) {
            reportDiagnostic("[WebView2] Failed to create host window", true);
            return 1;
        }

        initWebView2();

        MSG msg{};
        BOOL messageResult;
        while ((messageResult = GetMessage(&msg, nullptr, 0, 0)) > 0) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
        return messageResult == -1 ? 1 : static_cast<int>(msg.wParam);
    }

    void terminate() {
        PostQuitMessage(0);
    }

private:
    void reportDiagnostic(const std::string& message, bool warning = false) const {
        if (m_diagnosticCallback) {
            m_diagnosticCallback(warning, message);
        } else {
            fprintf(stderr, "%s\n", message.c_str());
        }
    }

    void reportResult(const char* operation, HRESULT result) const {
        reportDiagnostic(std::format("[WebView2] {}: {} (HRESULT: 0x{:08X})", operation,
                                     SUCCEEDED(result) ? "applied" : "failed", static_cast<unsigned long>(result)), FAILED(result));
    }

    void createWindow() {
        WNDCLASSEXW wc = {};
        wc.cbSize = sizeof(WNDCLASSEXW);
        wc.lpfnWndProc = WndProc;
        wc.hInstance = GetModuleHandle(nullptr);
        wc.lpszClassName = L"VelocityDBWindow";
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        // IDI_APP_ICON (101) defined in backend/resources/resource.h
        // Use system metrics for DPI-aware icon sizes (taskbar: SM_CXICON, titlebar: SM_CXSMICON)
        wc.hIcon = static_cast<HICON>(LoadImage(wc.hInstance, MAKEINTRESOURCE(101), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), 0));
        wc.hIconSm = static_cast<HICON>(LoadImage(wc.hInstance, MAKEINTRESOURCE(101), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0));
        static HBRUSH darkBrush = CreateSolidBrush(RGB(30, 30, 30));
        wc.hbrBackground = darkBrush;
        RegisterClassExW(&wc);

        DWORD style = WS_OVERLAPPEDWINDOW;
        RECT rect = { 0, 0, m_width, m_height };
        AdjustWindowRect(&rect, style, FALSE);

        m_hwnd = CreateWindowExW(
            0,
            L"VelocityDBWindow",
            L"Velocity-DB",
            style,
            CW_USEDEFAULT, CW_USEDEFAULT,
            rect.right - rect.left,
            rect.bottom - rect.top,
            nullptr,
            nullptr,
            GetModuleHandle(nullptr),
            this
        );

        if (!m_title.empty()) {
            SetWindowTextA(m_hwnd, m_title.c_str());
        }

        // Enable dark mode for window title bar and frame
        enableDarkMode(m_hwnd);

        ShowWindow(m_hwnd, SW_SHOW);
        UpdateWindow(m_hwnd);
        m_externalWindow = false;
    }

    // Enable dark mode for window title bar (Windows 10/11)
    static void enableDarkMode(HWND hwnd) {
        // DWMWA_USE_IMMERSIVE_DARK_MODE for Windows 10 Build 19041+ (20H1)
        constexpr DWORD DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        // For older Windows 10 builds
        constexpr DWORD DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;

        BOOL useDarkMode = TRUE;

        // Try newer attribute first (Windows 10 20H1+)
        HRESULT hr = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &useDarkMode, sizeof(useDarkMode));

        // If failed, try older attribute for compatibility
        if (FAILED(hr)) {
            DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, &useDarkMode, sizeof(useDarkMode));
        }
    }

    void initWebView2() {
        // Use %LOCALAPPDATA%/VelocityDB/WebView2 to avoid lock issues
        // when user data folder defaults to exe directory
        std::wstring wUserDataFolder;
        if (!m_userDataFolder.empty()) {
            wUserDataFolder = utf8_to_utf16(m_userDataFolder);
        } else {
            wchar_t localAppData[MAX_PATH]{};
            if (GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH) > 0) {
                wUserDataFolder = std::wstring(localAppData) + L"\\VelocityDB\\WebView2";
            }
        }
        LPCWSTR userDataFolderPtr = wUserDataFolder.empty() ? nullptr : wUserDataFolder.c_str();

        // Browser arguments are startup-only. The native adapter derives them from
        // a fixed allowlist of booleans; there is no raw command-line setting.
        auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
        if (!options) {
            reportDiagnostic("[WebView2] Cannot create environment options; startup settings were not applied", true);
            PostQuitMessage(1);
            return;
        }
        const HRESULT optionsResult = options->put_AdditionalBrowserArguments(m_browserArguments.c_str());
        if (FAILED(optionsResult)) {
            reportResult("Set startup browser arguments", optionsResult);
            PostQuitMessage(1);
            return;
        }

        HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
            nullptr, userDataFolderPtr, options.Get(),
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [this, alive = m_callbackAlive](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                    if (!alive->load()) return S_OK;
                    return onEnvironmentCreated(result, env);
                }
            ).Get()
        );

        if (FAILED(hr)) {
            auto msg = std::format(
                "WebView2 runtime not found. (HRESULT: 0x{:08X})\n"
                "Please install Microsoft Edge WebView2 Runtime.", static_cast<unsigned long>(hr));
            reportDiagnostic(std::format("[WebView2] {}", msg), true);
            MessageBoxA(m_hwnd, msg.c_str(), "Error", MB_OK | MB_ICONERROR);
            PostQuitMessage(1);
        }
    }

    HRESULT onEnvironmentCreated(HRESULT result, ICoreWebView2Environment* env) {
        if (FAILED(result) || !env) {
            auto msg = std::format(
                "Failed to create WebView2 environment. (HRESULT: 0x{:08X})", static_cast<unsigned long>(result));
            reportDiagnostic(std::format("[WebView2] {}", msg), true);
            MessageBoxA(m_hwnd, msg.c_str(), "Error", MB_OK | MB_ICONERROR);
            PostQuitMessage(1);
            return FAILED(result) ? result : E_POINTER;
        }

        LPWSTR version = nullptr;
        const HRESULT versionResult = env->get_BrowserVersionString(&version);
        if (SUCCEEDED(versionResult) && version) {
            reportDiagnostic(std::format("[WebView2] Runtime version: {}", utf16_to_utf8(version)));
        } else {
            reportDiagnostic("[WebView2] Runtime version unavailable", true);
        }
        CoTaskMemFree(version);
        reportDiagnostic(std::format("[WebView2] Environment created with requested browser arguments: {}",
                                     m_browserArguments.empty() ? "(browser defaults)" : utf16_to_utf8(m_browserArguments)));

        const HRESULT controllerResult = env->CreateCoreWebView2Controller(
            m_hwnd,
            Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [this, alive = m_callbackAlive](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                    if (!alive->load()) {
                        if (controller) controller->Close();
                        return S_OK;
                    }
                    if (FAILED(result) || !controller) {
                        reportDiagnostic(std::format("[WebView2] Failed to create controller (HRESULT: 0x{:08X})", static_cast<unsigned long>(result)), true);
                        MessageBoxA(m_hwnd, "Failed to create WebView2 controller.", "Error", MB_OK | MB_ICONERROR);
                        PostQuitMessage(1);
                        return result;
                    }

                    m_webviewController = controller;
                    const HRESULT coreResult = m_webviewController->get_CoreWebView2(&m_webviewWindow);
                    if (FAILED(coreResult) || !m_webviewWindow) {
                        reportDiagnostic(std::format("[WebView2] Browser interface unavailable (HRESULT: 0x{:08X})", static_cast<unsigned long>(coreResult)), true);
                        PostQuitMessage(1);
                        return FAILED(coreResult) ? coreResult : E_POINTER;
                    }

                    // Disable cache via DevTools protocol if requested
                    if (m_disableCache) {
                        disableCacheViaDevTools();
                    } else {
                        reportDiagnostic("[WebView2] Cache: enabled (browser default)");
                    }

                    // Resize WebView to fill window
                    RECT bounds;
                    GetClientRect(m_hwnd, &bounds);
                    m_webviewController->put_Bounds(bounds);

                    // Disable browser accelerator keys (Ctrl+N, Ctrl+T, etc.)
                    // Let JavaScript handle all keyboard shortcuts instead
                    disableBrowserAcceleratorKeys();

                    // Block new window requests (e.g. Ctrl+N default behavior)
                    blockNewWindowRequests();

                    // Setup virtual host mapping for local files (fixes CORS)
                    setupVirtualHostMapping();

                    // Setup bindings
                    setupBindings();

                    // This controls automatic opening only; it does not disable DevTools access.
                    if (m_debug) {
                        reportResult("Open DevTools on startup", m_webviewWindow->OpenDevToolsWindow());
                    } else {
                        reportDiagnostic("[WebView2] Automatic DevTools opening: off");
                    }

                    // Navigation event handler (debug logging)
                    EventRegistrationToken navToken;
                    m_webviewWindow->add_NavigationCompleted(
                        Callback<ICoreWebView2NavigationCompletedEventHandler>(
                            [this, alive = m_callbackAlive](ICoreWebView2* /*sender*/, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                if (!alive->load()) return S_OK;
                                BOOL success = FALSE;
                                args->get_IsSuccess(&success);
                                COREWEBVIEW2_WEB_ERROR_STATUS status{};
                                args->get_WebErrorStatus(&status);
                                auto msg = std::format(
                                    "[WebView2] NavigationCompleted: success={}, errorStatus={}, url={}, frontendPath={}\n",
                                    success ? "true" : "false", static_cast<int>(status), m_url, m_frontendPath);
                                fprintf(stderr, "%s", msg.c_str());
                                return S_OK;
                            }
                        ).Get(),
                        &navToken
                    );

                    fprintf(stderr, "%s", std::format(
                        "[WebView2] Bounds: {}x{}, URL: {}, FrontendPath: {}\n",
                        bounds.right, bounds.bottom, m_url, m_frontendPath).c_str());

                    // Navigate to URL
                    if (!m_url.empty()) {
                        std::wstring wurl = utf8_to_utf16(m_url);
                        m_webviewWindow->Navigate(wurl.c_str());
                    }

                    // WebView2準備完了 → 再描画
                    UpdateWindow(m_hwnd);

                    return S_OK;
                }
            ).Get()
        );
        if (FAILED(controllerResult)) {
            reportResult("Create controller", controllerResult);
            PostQuitMessage(1);
        }
        return controllerResult;
    }

    void disableCacheViaDevTools() {
        if (!m_webviewWindow) return;

        // Report asynchronous CDP failure rather than claiming the requested policy took effect.
        const HRESULT result = m_webviewWindow->CallDevToolsProtocolMethod(
            L"Network.setCacheDisabled", L"{\"cacheDisabled\": true}",
            Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                [this, alive = m_callbackAlive](HRESULT errorCode, LPCWSTR /*resultJson*/) -> HRESULT {
                    if (!alive->load()) return S_OK;
                    reportResult("Disable browser cache", errorCode);
                    return S_OK;
                }
            ).Get()
        );
        if (FAILED(result)) {
            reportResult("Request browser cache disable", result);
        }
    }

    void disableBrowserAcceleratorKeys() {
        if (!m_webviewWindow) return;

        ComPtr<ICoreWebView2Settings> settings;
        m_webviewWindow->get_Settings(&settings);
        if (!settings) return;

        ComPtr<ICoreWebView2Settings3> settings3;
        if (SUCCEEDED(settings->QueryInterface(IID_PPV_ARGS(&settings3))) && settings3) {
            reportResult("Disable browser accelerator keys", settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE));
        } else {
            reportDiagnostic("[WebView2] ICoreWebView2Settings3 unavailable; browser accelerator keys remain enabled", true);
        }
    }

    void blockNewWindowRequests() {
        if (!m_webviewWindow) return;

        m_webviewWindow->add_NewWindowRequested(
            Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                [](ICoreWebView2* /*sender*/, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                    args->put_Handled(TRUE);
                    return S_OK;
                }
            ).Get(),
            &m_newWindowRequestedToken
        );
    }

    void setupVirtualHostMapping() {
        if (!m_webviewWindow) return;

        // Get ICoreWebView2_3 interface for SetVirtualHostNameToFolderMapping
        ComPtr<ICoreWebView2_3> webview3;
        HRESULT hr = m_webviewWindow->QueryInterface(IID_PPV_ARGS(&webview3));
        if (SUCCEEDED(hr) && webview3) {
            // Map "app.local" to the frontend folder
            // This allows loading local files without CORS issues
            if (!m_frontendPath.empty()) {
                std::wstring wpath = utf8_to_utf16(m_frontendPath);
                webview3->SetVirtualHostNameToFolderMapping(
                    L"app.local",
                    wpath.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW
                );
            }
        }
    }

    void setupBindings() {
        if (!m_webviewWindow) return;

        // Inject JavaScript bridge with promise-based IPC
        std::wstring script = LR"(
(function() {
    let requestId = 0;
    const pendingRequests = new Map();

    window.invoke = function(request) {
        return new Promise((resolve, reject) => {
            const id = ++requestId;
            const wrappedRequest = JSON.stringify({ __id: id, __data: request });
            pendingRequests.set(id, { resolve, reject });
            window.chrome.webview.postMessage(wrappedRequest);
        });
    };

    window.__webview_response__ = function(id, response) {
        const pending = pendingRequests.get(id);
        if (pending) {
            pendingRequests.delete(id);
            pending.resolve(response);
        }
    };
})();
)";
        m_webviewWindow->AddScriptToExecuteOnDocumentCreated(script.c_str(), nullptr);

        // Start worker thread pool for async IPC processing
        startWorkerPool();

        // Handle messages from JavaScript - dispatch to worker thread
        m_webviewWindow->add_WebMessageReceived(
            Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                [this, alive = m_callbackAlive](ICoreWebView2* /*sender*/, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                    if (!alive->load()) return S_OK;
                    LPWSTR messageRaw = nullptr;
                    args->TryGetWebMessageAsString(&messageRaw);

                    if (messageRaw) {
                        std::wstring wmessage(messageRaw);
                        std::string message = utf16_to_utf8(wmessage);
                        CoTaskMemFree(messageRaw);

                        // Parse wrapped request to extract id and data
                        simdjson::dom::parser parser;
                        auto doc_result = parser.parse(message);
                        if (!doc_result.error()) {
                            auto doc = doc_result.value();
                            int64_t id = 0;
                            std::string data;

                            auto id_result = doc["__id"].get_int64();
                            if (!id_result.error()) {
                                id = id_result.value();
                            }

                            auto data_result = doc["__data"].get_string();
                            if (!data_result.error()) {
                                data = std::string(data_result.value());
                            }

                            // Dispatch to worker thread to keep UI responsive
                            auto it = m_bindings.find("invoke");
                            if (it != m_bindings.end()) {
                                auto fn = it->second;
                                auto hwnd = m_hwnd;
                                dispatchToWorker([fn, data = std::move(data), id, hwnd]() {
                                    std::string response = fn(data);
                                    auto* resp = new IPCResponse{id, std::move(response)};
                                    if (!PostMessage(hwnd, WM_IPC_RESPONSE, 0, reinterpret_cast<LPARAM>(resp))) {
                                        delete resp;
                                    }
                                });
                            }
                        }
                    }
                    return S_OK;
                }
            ).Get(),
            nullptr
        );
    }

    static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
        webview* self = nullptr;

        if (msg == WM_CREATE) {
            CREATESTRUCT* cs = reinterpret_cast<CREATESTRUCT*>(lParam);
            self = static_cast<webview*>(cs->lpCreateParams);
            SetWindowLongPtr(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        } else {
            self = reinterpret_cast<webview*>(GetWindowLongPtr(hwnd, GWLP_USERDATA));
        }

        switch (msg) {
        case WM_SIZE:
            if (self && self->m_webviewController) {
                RECT bounds;
                GetClientRect(hwnd, &bounds);
                self->m_webviewController->put_Bounds(bounds);
            }
            return 0;

        case WM_IPC_RESPONSE: {
            auto* resp = reinterpret_cast<IPCResponse*>(lParam);
            if (self && self->m_webviewWindow && resp) {
                std::wstring wresponse = utf8_to_utf16(resp->response);
                std::wstring script = L"window.__webview_response__(" +
                    std::to_wstring(resp->requestId) + L", " + wresponse + L");";
                self->m_webviewWindow->ExecuteScript(script.c_str(), nullptr);
            }
            delete resp;
            return 0;
        }

        case WM_DESTROY:
            if (self) {
                self->m_callbackAlive->store(false);
                self->stopWorkerPool();
            }
            PostQuitMessage(0);
            return 0;
        }

        return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    void startWorkerPool() {
        static constexpr size_t WORKER_POOL_SIZE = 4;
        m_workerRunning = true;
        m_workerThreads.reserve(WORKER_POOL_SIZE);
        for (size_t i = 0; i < WORKER_POOL_SIZE; ++i) {
            m_workerThreads.emplace_back([this]() {
                while (m_workerRunning) {
                    std::function<void()> task;
                    {
                        std::unique_lock lock(m_taskMutex);
                        m_taskCv.wait(lock, [this] { return !m_taskQueue.empty() || !m_workerRunning; });
                        if (!m_workerRunning && m_taskQueue.empty())
                            break;
                        task = std::move(m_taskQueue.front());
                        m_taskQueue.pop();
                    }
                    task();
                }
            });
        }
    }

    void stopWorkerPool() {
        if (m_workerThreads.empty()) return;
        m_workerRunning = false;
        m_taskCv.notify_all();
        for (auto& thread : m_workerThreads) {
            if (thread.joinable()) {
                thread.join();
            }
        }
        m_workerThreads.clear();
        // WM_DESTROY can stop the UI loop before queued responses are dispatched.
        // All workers have joined, so no further responses can be posted now.
        MSG message{};
        while (m_hwnd && PeekMessage(&message, m_hwnd, WM_IPC_RESPONSE, WM_IPC_RESPONSE, PM_REMOVE)) {
            delete reinterpret_cast<IPCResponse*>(message.lParam);
        }
    }

    void dispatchToWorker(std::function<void()> task) {
        {
            std::lock_guard lock(m_taskMutex);
            m_taskQueue.push(std::move(task));
        }
        m_taskCv.notify_one();
    }

    bool m_debug;
    bool m_externalWindow = true;
    bool m_disableCache;
    HWND m_hwnd;
    std::string m_title;
    std::string m_url;
    std::string m_frontendPath;
    std::string m_userDataFolder;
    std::wstring m_browserArguments = L"--disable-gpu-compositing --disable-renderer-backgrounding";
    std::function<void(bool, const std::string&)> m_diagnosticCallback;
    std::shared_ptr<std::atomic<bool>> m_callbackAlive = std::make_shared<std::atomic<bool>>(true);
    int m_width = 800;
    int m_height = 600;
    int m_hints = WEBVIEW_HINT_NONE;
    std::map<std::string, std::function<std::string(const std::string&)>> m_bindings;

    // Worker thread pool for async IPC processing
    std::vector<std::thread> m_workerThreads;
    std::queue<std::function<void()>> m_taskQueue;
    std::mutex m_taskMutex;
    std::condition_variable m_taskCv;
    std::atomic<bool> m_workerRunning{false};

    ComPtr<ICoreWebView2Controller> m_webviewController;
    ComPtr<ICoreWebView2> m_webviewWindow;
    EventRegistrationToken m_newWindowRequestedToken{};

public:
    void set_frontend_path(const std::string& path) {
        m_frontendPath = path;
    }
};

}  // namespace webview

#endif  // _WIN32
#endif  // WEBVIEW_H
