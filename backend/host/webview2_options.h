#pragma once

#include "webview_settings.h"

#include <string>

namespace velocitydb {

/// Fixed allowlist only. No persisted or user-supplied browser command line is accepted.
[[nodiscard]] inline std::wstring buildWebView2BrowserArguments(const WebViewSettings& settings) {
    std::wstring arguments;
    if (!settings.gpuCompositing) {
        arguments = L"--disable-gpu-compositing";
    }
    if (!settings.rendererBackgrounding) {
        if (!arguments.empty()) {
            arguments += L" ";
        }
        arguments += L"--disable-renderer-backgrounding";
    }
    return arguments;
}

}  // namespace velocitydb
