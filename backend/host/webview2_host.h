#pragma once

#include "webview_host.h"

#include <memory>

namespace velocitydb {

/// Only the current WebView2 implementation is provided. Other hosts can implement IWebViewHost.
[[nodiscard]] std::unique_ptr<IWebViewHost> makeWebView2Host();

}  // namespace velocitydb
