#pragma once

#include "webview_settings.h"

#include <functional>
#include <string>
#include <string_view>

namespace velocitydb {

struct WebViewHostConfig {
    std::string title;
    int width = 800;
    int height = 600;
    std::string frontendDirectory;
    std::string url;
    WebViewSettings webview;
};

/// Native host boundary. The host owns browser setup, transport and worker/UI-thread dispatch.
/// run blocks until the window closes and must finish all callbacks before returning.
/// The caller must keep requestHandler's dependencies alive throughout run.
class IWebViewHost {
public:
    using RequestHandler = std::function<std::string(std::string_view)>;

    virtual ~IWebViewHost() = default;
    [[nodiscard]] virtual int run(const WebViewHostConfig& config, RequestHandler requestHandler) = 0;
};

}  // namespace velocitydb
