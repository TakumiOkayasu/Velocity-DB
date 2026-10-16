#include "webview2_host.h"

#include "../utils/logger.h"
#include "webview.h"
#include "webview2_options.h"
#include "webview_request.h"

#include <format>
#include <utility>

namespace velocitydb {

namespace {

class WebView2Host final : public IWebViewHost {
public:
    int run(const WebViewHostConfig& config, RequestHandler requestHandler) override {
        // This local host is destroyed (joining workers and closing the controller) before
        // run returns, while the caller's IPCHandler/SystemContext are still alive.
        webview::webview host(config.webview.openDevToolsOnStartup, nullptr);
        host.set_diagnostic_callback([](bool warning, const std::string& message) {
            if (warning) {
                log<LogLevel::WARNING>(message);
            } else {
                log<LogLevel::INFO>(message);
            }
            log_flush();
        });
        log<LogLevel::INFO>(std::format("[WebView2] Startup requested: gpuCompositing={}, rendererBackgrounding={}, cacheEnabled={}, openDevToolsOnStartup={}", config.webview.gpuCompositing,
                                        config.webview.rendererBackgrounding, config.webview.cacheEnabled, config.webview.openDevToolsOnStartup));
        log_flush();
        host.set_title(config.title);
        host.set_size(config.width, config.height, WEBVIEW_HINT_NONE);
        host.set_disable_cache(!config.webview.cacheEnabled);
        host.set_browser_arguments(buildWebView2BrowserArguments(config.webview));
        host.bind("invoke", [handler = std::move(requestHandler)](const std::string& request) { return handler(normalizeWebViewRequest(request)); });
        host.set_frontend_path(config.frontendDirectory);
        host.navigate(config.url);
        return host.run();
    }
};

}  // namespace

std::unique_ptr<IWebViewHost> makeWebView2Host() {
    return std::make_unique<WebView2Host>();
}

}  // namespace velocitydb
