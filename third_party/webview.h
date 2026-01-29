/*
 * MIT License
 * Copyright (c) 2017 Serge Zaitsev
 * Simplified WebView2 wrapper for Velocity-DB
 */

#ifndef WEBVIEW_H
#define WEBVIEW_H

#include <cstdio>
#include <format>
#include <functional>
#include <string>
#include <map>
#include <atomic>
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

    ~webview() {
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

    void run() {
        if (!m_hwnd) {
            createWindow();
        }

        initWebView2();

        MSG msg;
        while (GetMessage(&msg, nullptr, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }

    void terminate() {
        PostQuitMessage(0);
    }

private:
    void createWindow() {
        WNDCLASSEXW wc = {};
        wc.cbSize = sizeof(WNDCLASSEXW);
        wc.lpfnWndProc = WndProc;
        wc.hInstance = GetModuleHandle(nullptr);
        wc.lpszClassName = L"VelocityDBWindow";
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
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
        HRESULT hr = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE,
                                           &useDarkMode, sizeof(useDarkMode));

        // If failed, try older attribute for compatibility
        if (FAILED(hr)) {
            DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1,
                                 &useDarkMode, sizeof(useDarkMode));
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

        HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
            nullptr, userDataFolderPtr, nullptr,
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [this](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                    return onEnvironmentCreated(result, env);
                }
            ).Get()
        );

        if (FAILED(hr)) {
            auto msg = std::format(
                "WebView2 runtime not found. (HRESULT: 0x{:08X})\n"
                "Please install Microsoft Edge WebView2 Runtime.", static_cast<unsigned long>(hr));
            MessageBoxA(m_hwnd, msg.c_str(), "Error", MB_OK | MB_ICONERROR);
            PostQuitMessage(1);
        }
    }

    HRESULT onEnvironmentCreated(HRESULT result, ICoreWebView2Environment* env) {
        if (FAILED(result)) {
            auto msg = std::format(
                "Failed to create WebView2 environment. (HRESULT: 0x{:08X})", static_cast<unsigned long>(result));
            MessageBoxA(m_hwnd, msg.c_str(), "Error", MB_OK | MB_ICONERROR);
            PostQuitMessage(1);
            return result;
        }

        env->CreateCoreWebView2Controller(
            m_hwnd,
            Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [this](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                    if (FAILED(result) || !controller) {
                        MessageBoxA(m_hwnd, "Failed to create WebView2 controller.", "Error", MB_OK | MB_ICONERROR);
                        PostQuitMessage(1);
                        return result;
                    }

                    m_webviewController = controller;
                    m_webviewController->get_CoreWebView2(&m_webviewWindow);

                    // Disable cache via DevTools protocol if requested
                    if (m_disableCache) {
                        disableCacheViaDevTools();
                    }

                    // Resize WebView to fill window
                    RECT bounds;
                    GetClientRect(m_hwnd, &bounds);
                    m_webviewController->put_Bounds(bounds);

                    // Setup virtual host mapping for local files (fixes CORS)
                    setupVirtualHostMapping();

                    // Setup bindings
                    setupBindings();

                    // Open DevTools in debug builds
                    if (m_debug) {
                        m_webviewWindow->OpenDevToolsWindow();
                    }

                    // Navigation event handler (debug logging)
                    EventRegistrationToken navToken;
                    m_webviewWindow->add_NavigationCompleted(
                        Callback<ICoreWebView2NavigationCompletedEventHandler>(
                            [this](ICoreWebView2* /*sender*/, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
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
        return S_OK;
    }

    void disableCacheViaDevTools() {
        if (!m_webviewWindow) return;

        // Call DevTools protocol to disable cache
        ComPtr<ICoreWebView2> webview;
        m_webviewWindow->QueryInterface(IID_PPV_ARGS(&webview));
        if (webview) {
            // Network.setCacheDisabled disables the browser cache
            webview->CallDevToolsProtocolMethod(
                L"Network.setCacheDisabled",
                L"{\"cacheDisabled\": true}",
                nullptr
            );
        }
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

        // Handle messages from JavaScript
        m_webviewWindow->add_WebMessageReceived(
            Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                [this](ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                    LPWSTR messageRaw;
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

                            // Call the "invoke" binding if it exists
                            auto it = m_bindings.find("invoke");
                            if (it != m_bindings.end()) {
                                std::string response = it->second(data);

                                // Send response back to JavaScript with request id
                                std::wstring wresponse = utf8_to_utf16(response);
                                std::wstring script = L"window.__webview_response__(" +
                                    std::to_wstring(id) + L", " + wresponse + L");";
                                m_webviewWindow->ExecuteScript(script.c_str(), nullptr);
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

        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
        }

        return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    bool m_debug;
    bool m_externalWindow = true;
    bool m_disableCache;
    HWND m_hwnd;
    std::string m_title;
    std::string m_url;
    std::string m_frontendPath;
    std::string m_userDataFolder;
    int m_width = 800;
    int m_height = 600;
    int m_hints = WEBVIEW_HINT_NONE;
    std::map<std::string, std::function<std::string(const std::string&)>> m_bindings;

    ComPtr<ICoreWebView2Controller> m_webviewController;
    ComPtr<ICoreWebView2> m_webviewWindow;

public:
    void set_frontend_path(const std::string& path) {
        m_frontendPath = path;
    }
};

}  // namespace webview

#endif  // _WIN32
#endif  // WEBVIEW_H
