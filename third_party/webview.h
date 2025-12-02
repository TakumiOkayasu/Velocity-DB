/*
 * MIT License
 * Copyright (c) 2017 Serge Zaitsev
 * Simplified WebView2 wrapper for Pre-DateGrip
 */

#ifndef WEBVIEW_H
#define WEBVIEW_H

#include <functional>
#include <string>
#include <map>
#include <atomic>

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
#pragma comment(lib, "WebView2Loader.dll.lib")
#pragma comment(lib, "shlwapi.lib")

namespace webview {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

class webview {
public:
    webview(bool debug = false, void* window = nullptr)
        : m_debug(debug)
        , m_hwnd(nullptr)
        , m_webviewController(nullptr)
        , m_webviewWindow(nullptr)
    {
        if (window) {
            m_hwnd = static_cast<HWND>(window);
        }
    }

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
            std::wstring wurl(url.begin(), url.end());
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
        wc.lpszClassName = L"PreDateGripWindow";
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
        RegisterClassExW(&wc);

        DWORD style = WS_OVERLAPPEDWINDOW;
        RECT rect = { 0, 0, m_width, m_height };
        AdjustWindowRect(&rect, style, FALSE);

        m_hwnd = CreateWindowExW(
            0,
            L"PreDateGripWindow",
            L"Pre-DateGrip",
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

        ShowWindow(m_hwnd, SW_SHOW);
        UpdateWindow(m_hwnd);
        m_externalWindow = false;
    }

    void initWebView2() {
        HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
            nullptr, nullptr, nullptr,
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [this](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                    if (FAILED(result)) {
                        MessageBoxA(m_hwnd, "Failed to create WebView2 environment", "Error", MB_OK | MB_ICONERROR);
                        PostQuitMessage(1);
                        return result;
                    }

                    env->CreateCoreWebView2Controller(
                        m_hwnd,
                        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                            [this](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                                if (FAILED(result) || !controller) {
                                    MessageBoxA(m_hwnd, "Failed to create WebView2 controller", "Error", MB_OK | MB_ICONERROR);
                                    PostQuitMessage(1);
                                    return result;
                                }

                                m_webviewController = controller;
                                m_webviewController->get_CoreWebView2(&m_webviewWindow);

                                // Resize WebView to fill window
                                RECT bounds;
                                GetClientRect(m_hwnd, &bounds);
                                m_webviewController->put_Bounds(bounds);

                                // Setup bindings
                                setupBindings();

                                // Navigate to URL
                                if (!m_url.empty()) {
                                    std::wstring wurl(m_url.begin(), m_url.end());
                                    m_webviewWindow->Navigate(wurl.c_str());
                                }

                                return S_OK;
                            }
                        ).Get()
                    );
                    return S_OK;
                }
            ).Get()
        );

        if (FAILED(hr)) {
            MessageBoxA(m_hwnd, "WebView2 runtime not found.\nPlease install Microsoft Edge WebView2 Runtime.", "Error", MB_OK | MB_ICONERROR);
            PostQuitMessage(1);
        }
    }

    void setupBindings() {
        if (!m_webviewWindow) return;

        // Inject JavaScript bridge
        std::wstring script = L"window.invoke = function(request) { return window.chrome.webview.postMessage(request); };";
        m_webviewWindow->AddScriptToExecuteOnDocumentCreated(script.c_str(), nullptr);

        // Handle messages from JavaScript
        m_webviewWindow->add_WebMessageReceived(
            Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                [this](ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                    LPWSTR messageRaw;
                    args->TryGetWebMessageAsString(&messageRaw);

                    if (messageRaw) {
                        std::wstring wmessage(messageRaw);
                        std::string message(wmessage.begin(), wmessage.end());
                        CoTaskMemFree(messageRaw);

                        // Call the "invoke" binding if it exists
                        auto it = m_bindings.find("invoke");
                        if (it != m_bindings.end()) {
                            std::string response = it->second(message);

                            // Send response back to JavaScript
                            std::wstring wresponse(response.begin(), response.end());
                            std::wstring script = L"window.__webview_response__(" + wresponse + L");";
                            m_webviewWindow->ExecuteScript(script.c_str(), nullptr);
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
    HWND m_hwnd;
    std::string m_title;
    std::string m_url;
    int m_width = 800;
    int m_height = 600;
    int m_hints = WEBVIEW_HINT_NONE;
    std::map<std::string, std::function<std::string(const std::string&)>> m_bindings;

    ComPtr<ICoreWebView2Controller> m_webviewController;
    ComPtr<ICoreWebView2> m_webviewWindow;
};

}  // namespace webview

#endif  // _WIN32
#endif  // WEBVIEW_H
