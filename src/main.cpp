#include "webview_app.h"

#include <Windows.h>

int WINAPI wWinMain(_In_ HINSTANCE hInstance, _In_opt_ HINSTANCE hPrevInstance, _In_ LPWSTR lpCmdLine,
                    _In_ int nCmdShow) {
    (void)hPrevInstance;
    (void)lpCmdLine;
    (void)nCmdShow;

    try {
        predategrip::WebViewApp app(hInstance);
        return app.run();
    } catch (const std::exception& e) {
        MessageBoxA(nullptr, e.what(), "Error", MB_OK | MB_ICONERROR);
        return 1;
    } catch (...) {
        MessageBoxA(nullptr, "Unknown exception occurred", "Error", MB_OK | MB_ICONERROR);
        return 1;
    }
}
