#include "host/webview2_options.h"
#include "host/webview_host.h"
#include "host/webview_request.h"

#include <string>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

// Exercises the host contract without COM, HWND or an installed browser runtime.
class FakeWebViewHost final : public IWebViewHost {
public:
    WebViewHostConfig received;
    std::string request;
    std::string response;
    int exitCode = 0;

    int run(const WebViewHostConfig& config, RequestHandler requestHandler) override {
        received = config;
        response = requestHandler(request);
        return exitCode;
    }
};

TEST(WebViewHostTest, PreservesConfigurationAndRawIpcContract) {
    FakeWebViewHost fake;
    IWebViewHost& host = fake;
    WebViewHostConfig config;
    config.title = "Velocity-DB test";
    config.width = 1440;
    config.height = 900;
    config.frontendDirectory = "frontend";
    config.url = "https://app.local/index.html";
    config.webview = {.gpuCompositing = true, .rendererBackgrounding = false, .cacheEnabled = true, .openDevToolsOnStartup = true};
    fake.request = R"({"method":"getSettings","params":"{}"})";
    const std::string reply = R"({"success":true,"data":{"value":42}})";
    int calls = 0;
    const int result = host.run(config, [&](std::string_view request) {
        ++calls;
        EXPECT_EQ(request, fake.request);
        return reply;
    });

    EXPECT_EQ(result, 0);
    EXPECT_EQ(calls, 1);
    EXPECT_EQ(fake.response, reply);
    EXPECT_EQ(fake.received.title, config.title);
    EXPECT_EQ(fake.received.width, config.width);
    EXPECT_EQ(fake.received.height, config.height);
    EXPECT_EQ(fake.received.frontendDirectory, config.frontendDirectory);
    EXPECT_EQ(fake.received.url, config.url);
    EXPECT_EQ(fake.received.webview, config.webview);
}

TEST(WebViewHostTest, PreservesErrorEnvelopeAndNonzeroExit) {
    FakeWebViewHost fake;
    IWebViewHost& host = fake;
    fake.exitCode = 1;
    fake.request = R"({"method":"unknown","params":"{}"})";
    const std::string error = R"({"success":false,"error":"Unknown method: unknown"})";
    EXPECT_EQ(host.run({}, [&](std::string_view) { return error; }), 1);
    EXPECT_EQ(fake.response, error);
}

TEST(WebViewRequestTest, RawJsonPassesThroughUnchanged) {
    const std::string request = R"({"method":"getSettings","params":"{}"})";
    EXPECT_EQ(normalizeWebViewRequest(request), request);
}

TEST(WebViewRequestTest, LegacyArgumentArrayUnwrapsFirstString) {
    EXPECT_EQ(normalizeWebViewRequest(R"(["{\"method\":\"getSettings\",\"params\":\"{}\"}"])"), R"({"method":"getSettings","params":"{}"})");
    EXPECT_EQ(normalizeWebViewRequest(R"(["first", "ignored"])"), "first");
}

TEST(WebViewRequestTest, MalformedAndNonarrayInputPreserveCompatibility) {
    EXPECT_EQ(normalizeWebViewRequest("invalid {"), "invalid {");
    EXPECT_EQ(normalizeWebViewRequest("42"), "42");
    EXPECT_EQ(normalizeWebViewRequest(""), "");
}

TEST(WebViewRequestTest, EmptyOrNonstringArgumentReturnsEmptyRequest) {
    EXPECT_EQ(normalizeWebViewRequest("[]"), "");
    EXPECT_EQ(normalizeWebViewRequest("[42]"), "");
}

TEST(WebView2OptionsTest, DefaultsPreserveExistingStartupBehavior) {
    const WebViewSettings defaults;
    EXPECT_FALSE(defaults.gpuCompositing);
    EXPECT_FALSE(defaults.rendererBackgrounding);
    EXPECT_FALSE(defaults.cacheEnabled);
    EXPECT_FALSE(defaults.openDevToolsOnStartup);
    EXPECT_EQ(buildWebView2BrowserArguments(defaults), L"--disable-gpu-compositing --disable-renderer-backgrounding");
}

TEST(WebView2OptionsTest, RenderingOptionsAreIndependentAndAllowlisted) {
    WebViewSettings settings;
    settings.gpuCompositing = true;
    EXPECT_EQ(buildWebView2BrowserArguments(settings), L"--disable-renderer-backgrounding");
    settings.rendererBackgrounding = true;
    EXPECT_TRUE(buildWebView2BrowserArguments(settings).empty());
    settings.gpuCompositing = false;
    EXPECT_EQ(buildWebView2BrowserArguments(settings), L"--disable-gpu-compositing");
}

TEST(WebView2OptionsTest, CacheAndDevToolsDoNotAddBrowserArguments) {
    WebViewSettings settings;
    const auto arguments = buildWebView2BrowserArguments(settings);
    settings.cacheEnabled = true;
    settings.openDevToolsOnStartup = true;
    EXPECT_EQ(buildWebView2BrowserArguments(settings), arguments);
}

}  // namespace
}  // namespace velocitydb
