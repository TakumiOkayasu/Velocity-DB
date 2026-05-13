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
    target_link_libraries(webview2 INTERFACE WebView2LoaderStatic.lib version.lib)
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

# Glaze - C++23 JSON reflection library
# https://github.com/stephenberry/glaze
include(FetchContent)
# TLS_VERIFY OFF: Windows schannel が CRL/OCSP 取得失敗で
# CRYPT_E_NO_REVOCATION_CHECK を返す環境への回避策。
# URL_HASH (SHA256) で内容完全性は担保される。
FetchContent_Declare(
    glaze
    URL https://github.com/stephenberry/glaze/archive/refs/tags/v5.0.0.tar.gz
    URL_HASH SHA256=37e4ab809f18c5497a35481f347c1ed63761324644e358d92a7a11fe647fd44a
    TLS_VERIFY OFF
    EXCLUDE_FROM_ALL
)
FetchContent_MakeAvailable(glaze)

# Note: xlsxwriter requires separate build
# For now, it's disabled until properly integrated

# sqruff - SQL linter (Windows x86_64 prebuilt binary)
# https://github.com/quarylabs/sqruff
# License: Apache-2.0
set(SQRUFF_VERSION "0.38.0")
set(SQRUFF_SHA256 "004e2b7a7a8c32256bc76bc61b642014856ff3fa1c4aedf9854e66c5b8a4817b")
set(SQRUFF_ARCHIVE "${CMAKE_CURRENT_SOURCE_DIR}/sqruff/sqruff-${SQRUFF_VERSION}.zip")
set(SQRUFF_EXTRACT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/sqruff/${SQRUFF_VERSION}")
set(SQRUFF_EXE "${SQRUFF_EXTRACT_DIR}/sqruff.exe")

if(NOT EXISTS "${SQRUFF_EXE}")
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/sqruff")
    if(NOT EXISTS "${SQRUFF_ARCHIVE}")
        message(STATUS "Downloading sqruff v${SQRUFF_VERSION}...")
        file(DOWNLOAD
            "https://github.com/quarylabs/sqruff/releases/download/v${SQRUFF_VERSION}/sqruff-windows-x86_64.zip"
            "${SQRUFF_ARCHIVE}"
            EXPECTED_HASH SHA256=${SQRUFF_SHA256}
            SHOW_PROGRESS
            TLS_VERIFY ON
        )
    endif()
    file(ARCHIVE_EXTRACT
        INPUT "${SQRUFF_ARCHIVE}"
        DESTINATION "${SQRUFF_EXTRACT_DIR}"
    )
endif()

if(EXISTS "${SQRUFF_EXE}")
    message(STATUS "sqruff binary: ${SQRUFF_EXE}")
    add_library(sqruff_binary INTERFACE)
    set(SQRUFF_BINARY_PATH "${SQRUFF_EXE}" CACHE INTERNAL "Path to sqruff.exe")
else()
    message(FATAL_ERROR "sqruff.exe extraction failed: ${SQRUFF_EXE}")
endif()
