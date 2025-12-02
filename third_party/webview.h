/*
 * MIT License
 *
 * Copyright (c) 2017 Serge Zaitsev
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 */

#ifndef WEBVIEW_H
#define WEBVIEW_H

#include <functional>
#include <string>
#include <utility>

// Webview hint constants
#define WEBVIEW_HINT_NONE 0
#define WEBVIEW_HINT_MIN 1
#define WEBVIEW_HINT_MAX 2
#define WEBVIEW_HINT_FIXED 3

#ifdef _WIN32
#include <Windows.h>
#include <wrl.h>
#include <WebView2.h>
#include <map>
#pragma comment(lib, "WebView2Loader.dll.lib")
#endif

namespace webview {

class webview {
public:
    webview(bool debug = false, void* window = nullptr)
        : m_debug(debug), m_window(window) {
        // Initialize WebView2
        init();
    }

    ~webview() {
        // Cleanup
    }

    void set_title(const std::string& title) {
        m_title = title;
        // Update window title
    }

    void set_size(int width, int height, int hints) {
        m_width = width;
        m_height = height;
        m_hints = hints;
    }

    void navigate(const std::string& url) {
        m_url = url;
        // Navigate to URL
    }

    void bind(const std::string& name, std::function<std::string(const std::string&)> fn) {
        m_bindings[name] = fn;
    }

    void run() {
        // Message loop
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
    void init() {
        // TODO: Full WebView2 initialization
        // This is a simplified placeholder
    }

    bool m_debug;
    void* m_window;
    std::string m_title;
    std::string m_url;
    int m_width = 800;
    int m_height = 600;
    int m_hints = WEBVIEW_HINT_NONE;
    std::map<std::string, std::function<std::string(const std::string&)>> m_bindings;
};

}  // namespace webview

#endif  // WEBVIEW_H
