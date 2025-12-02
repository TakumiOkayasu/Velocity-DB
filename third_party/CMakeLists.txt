# Third-party libraries

# WebView2 SDK
# Download from: https://www.nuget.org/packages/Microsoft.Web.WebView2
# Extract and place in third_party/webview2/
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/webview2/include")
    add_library(webview2 INTERFACE)
    target_include_directories(webview2 INTERFACE
        ${CMAKE_CURRENT_SOURCE_DIR}/webview2/include
    )
    target_link_directories(webview2 INTERFACE
        ${CMAKE_CURRENT_SOURCE_DIR}/webview2/lib
    )
    target_link_libraries(webview2 INTERFACE WebView2Loader.dll.lib)
    set(WEBVIEW2_FOUND TRUE)
else()
    message(WARNING "WebView2 SDK not found. Please download and extract to third_party/webview2/")
    set(WEBVIEW2_FOUND FALSE)
endif()

# WebView wrapper (uses WebView2)
add_library(webview INTERFACE)
target_include_directories(webview INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
if(WEBVIEW2_FOUND)
    target_link_libraries(webview INTERFACE webview2)
    target_compile_definitions(webview INTERFACE WEBVIEW2_AVAILABLE)
endif()

# simdjson
# Download from: https://github.com/simdjson/simdjson/releases
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/simdjson.cpp")
    add_library(simdjson STATIC simdjson.cpp)
    target_include_directories(simdjson PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
else()
    # Fallback to interface library if only header exists
    add_library(simdjson INTERFACE)
    target_include_directories(simdjson INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
endif()

# pugixml
# Download from: https://pugixml.org/
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/pugixml.cpp")
    add_library(pugixml STATIC pugixml.cpp)
    target_include_directories(pugixml PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
else()
    # Fallback to header-only mode
    add_library(pugixml INTERFACE)
    target_include_directories(pugixml INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
    target_compile_definitions(pugixml INTERFACE PUGIXML_HEADER_ONLY)
endif()

# Note: xlsxwriter requires separate build
# For now, it's disabled until properly integrated
