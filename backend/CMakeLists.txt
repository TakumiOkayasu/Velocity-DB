# Find libssh2 (optional - via vcpkg)
find_package(Libssh2 CONFIG QUIET)
if(Libssh2_FOUND)
    message(STATUS "libssh2 found - SSH tunnel support enabled")
    set(SSH_TUNNEL_ENABLED TRUE)
else()
    message(STATUS "libssh2 not found - SSH tunnel support disabled")
    message(STATUS "  To enable: set VCPKG_ROOT and install libssh2[openssl]")
    set(SSH_TUNNEL_ENABLED FALSE)
endif()

# Core library sources (without main.cpp)
set(LIB_SOURCES
    webview_app.cpp
    ipc_handler.cpp
    database/sqlserver_driver.cpp
    database/connection_pool.cpp
    database/result_cache.cpp
    database/async_query_executor.cpp
    database/schema_inspector.cpp
    database/query_history.cpp
    database/transaction_manager.cpp
    database/odbc_driver_detector.cpp
    parsers/a5er_parser.cpp
    parsers/sql_formatter.cpp
    parsers/sql_parser.cpp
    exporters/csv_exporter.cpp
    exporters/json_exporter.cpp
    exporters/excel_exporter.cpp
    utils/json_utils.cpp
    utils/simd_filter.cpp
    utils/file_utils.cpp
    utils/file_dialog.cpp
    utils/settings_manager.cpp
    utils/session_manager.cpp
    utils/global_search.cpp
    utils/credential_protector.cpp
    utils/logger.cpp
)

# Add SSH tunnel source if libssh2 is available
if(SSH_TUNNEL_ENABLED)
    list(APPEND LIB_SOURCES network/ssh_tunnel.cpp)
endif()

set(HEADERS
    webview_app.h
    ipc_handler.h
    database/sqlserver_driver.h
    database/connection_pool.h
    database/result_cache.h
    database/async_query_executor.h
    database/schema_inspector.h
    database/query_history.h
    database/transaction_manager.h
    database/odbc_driver_detector.h
    parsers/a5er_parser.h
    parsers/sql_formatter.h
    parsers/sql_parser.h
    exporters/csv_exporter.h
    exporters/json_exporter.h
    exporters/excel_exporter.h
    exporters/data_exporter.h
    utils/json_utils.h
    utils/simd_filter.h
    utils/file_utils.h
    utils/file_dialog.h
    utils/settings_manager.h
    utils/session_manager.h
    utils/global_search.h
    utils/credential_protector.h
    utils/logger.h
)

# Add SSH tunnel header if libssh2 is available
if(SSH_TUNNEL_ENABLED)
    list(APPEND HEADERS network/ssh_tunnel.h)
endif()

# Create a static library for the core functionality
add_library(PreDateGripCore STATIC ${LIB_SOURCES} ${HEADERS})

target_include_directories(PreDateGripCore PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)

target_link_libraries(PreDateGripCore PUBLIC
    webview
    simdjson
    pugixml
    odbc32
    odbccp32
    crypt32
    comdlg32
)

# Link libssh2 if available
if(SSH_TUNNEL_ENABLED)
    target_link_libraries(PreDateGripCore PUBLIC Libssh2::libssh2)
    target_compile_definitions(PreDateGripCore PUBLIC SSH_TUNNEL_ENABLED)
endif()

# Precompiled Headers for faster compilation
target_precompile_headers(PreDateGripCore PRIVATE
    <string>
    <string_view>
    <vector>
    <memory>
    <format>
    <expected>
    <chrono>
    <unordered_map>
    <functional>
    <optional>
    <fstream>
    <sstream>
    <algorithm>
    "${CMAKE_SOURCE_DIR}/third_party/simdjson.h"
)

# Main executable
add_executable(PreDateGrip WIN32 main.cpp)

target_link_libraries(PreDateGrip PRIVATE PreDateGripCore)

# Set output directory to build/[Debug|Release]/
set_target_properties(PreDateGrip PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}/RelWithDebInfo"
    RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}/MinSizeRel"
)

# Also set output directory for the static library
set_target_properties(PreDateGripCore PROPERTIES
    ARCHIVE_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
    ARCHIVE_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    ARCHIVE_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}/RelWithDebInfo"
    ARCHIVE_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}/MinSizeRel"
)

# Copy frontend dist to output directory (if it exists)
if(EXISTS "${CMAKE_SOURCE_DIR}/frontend/dist")
    add_custom_command(TARGET PreDateGrip POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_SOURCE_DIR}/frontend/dist
        $<TARGET_FILE_DIR:PreDateGrip>/frontend
        COMMENT "Copying frontend files..."
    )
else()
    message(STATUS "Frontend dist not found. Run 'npm run build' in frontend/ first.")
endif()

# Copy config directory to output directory
if(EXISTS "${CMAKE_SOURCE_DIR}/config")
    add_custom_command(TARGET PreDateGrip POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_SOURCE_DIR}/config
        $<TARGET_FILE_DIR:PreDateGrip>/config
        COMMENT "Copying config files..."
    )
endif()
