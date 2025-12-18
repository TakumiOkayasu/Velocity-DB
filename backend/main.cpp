#include "utils/logger.h"
#include "webview_app.h"

#include <Windows.h>

// Window title for finding existing instance
constexpr const wchar_t* WINDOW_TITLE = L"Pre-DateGrip";

// Callback function to find existing window
BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
    wchar_t windowTitle[256];
    GetWindowTextW(hwnd, windowTitle, sizeof(windowTitle) / sizeof(wchar_t));

    if (wcsstr(windowTitle, WINDOW_TITLE) != nullptr) {
        // Found existing window, bring it to front
        if (IsIconic(hwnd)) {
            ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd);
        *reinterpret_cast<bool*>(lParam) = true;
        return FALSE;  // Stop enumeration
    }
    return TRUE;  // Continue enumeration
}

int WINAPI wWinMain(_In_ HINSTANCE hInstance, _In_opt_ HINSTANCE hPrevInstance, _In_ LPWSTR lpCmdLine, _In_ int nCmdShow) {
    (void)hPrevInstance;
    (void)lpCmdLine;
    (void)nCmdShow;

    // Initialize logger
    predategrip::initialize_logger();

    // Single instance check using named mutex
    constexpr const wchar_t* MUTEX_NAME = L"Global\\PreDateGrip-{8F5E9C2A-1B3D-4E7F-9A6C-2D8B4E1F3C5A}";
    HANDLE hMutex = CreateMutexW(nullptr, TRUE, MUTEX_NAME);

    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        // Another instance is already running
        predategrip::log<predategrip::LogLevel::INFO>("Another instance is already running. Bringing existing window to front.");

        // Try to find and activate existing window
        bool foundWindow = false;
        EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&foundWindow));

        if (!foundWindow) {
            MessageBoxW(nullptr, L"Pre-DateGrip is already running.", L"Already Running", MB_OK | MB_ICONINFORMATION);
        }

        if (hMutex) {
            CloseHandle(hMutex);
        }
        return 0;
    }

    try {
        predategrip::WebViewApp app(hInstance);
        int result = app.run();

        // Release mutex before exit
        if (hMutex) {
            ReleaseMutex(hMutex);
            CloseHandle(hMutex);
        }

        return result;
    } catch (const std::exception& e) {
        MessageBoxA(nullptr, e.what(), "Error", MB_OK | MB_ICONERROR);

        // Release mutex on error
        if (hMutex) {
            ReleaseMutex(hMutex);
            CloseHandle(hMutex);
        }

        return 1;
    } catch (...) {
        MessageBoxA(nullptr, "Unknown exception occurred", "Error", MB_OK | MB_ICONERROR);

        // Release mutex on error
        if (hMutex) {
            ReleaseMutex(hMutex);
            CloseHandle(hMutex);
        }

        return 1;
    }
}
