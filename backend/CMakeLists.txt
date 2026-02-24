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
    # Database
    database/odbc_helpers.cpp
    database/sqlserver_driver.cpp
    database/sqlserver_dialect.cpp
    database/postgresql_driver.cpp
    database/postgresql_dialect.cpp
    database/driver_factory.cpp
    database/connection_registry.cpp
    database/result_cache.cpp
    database/async_query_executor.cpp
    database/schema_inspector.cpp
    database/query_history.cpp
    database/transaction_manager.cpp
    database/odbc_driver_detector.cpp
    database/connection_utils.cpp
    # Contexts
    contexts/system_context.cpp
    # Providers
    providers/connection_provider.cpp
    providers/query_provider.cpp
    providers/async_query_provider.cpp
    providers/schema_provider.cpp
    providers/transaction_provider.cpp
    providers/export_provider.cpp
    providers/search_provider.cpp
    providers/utility_provider.cpp
    providers/settings_provider.cpp
    providers/io_provider.cpp
    # Parsers
    parsers/a5er_parser.cpp
    parsers/a5er_utils.cpp
    parsers/er_diagram_parser_factory.cpp
    parsers/sql_formatter.cpp
    parsers/sql_parser.cpp
    # Exporters
    exporters/csv_exporter.cpp
    exporters/json_exporter.cpp
    exporters/excel_exporter.cpp
    # Utils
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
    # Database
    database/driver_interface.h
    database/sqlserver_driver.h
    database/odbc_helpers.h
    database/sqlserver_dialect.h
    database/postgresql_driver.h
    database/postgresql_dialect.h
    database/connection_registry.h
    database/result_cache.h
    database/async_query_executor.h
    database/schema_inspector.h
    database/query_history.h
    database/transaction_manager.h
    database/odbc_driver_detector.h
    database/connection_utils.h
    # Interfaces (Driver ISP)
    interfaces/connectable.h
    interfaces/query_executable.h
    interfaces/error_reportable.h
    # Interfaces (Dialect ISP)
    interfaces/schema_queryable.h
    interfaces/relation_queryable.h
    interfaces/ddl_queryable.h
    interfaces/sql_formattable.h
    interfaces/object_searchable.h
    # Interfaces (Provider)
    interfaces/system_context.h
    interfaces/providers/connection_provider.h
    interfaces/providers/query_provider.h
    interfaces/providers/async_query_provider.h
    interfaces/providers/schema_provider.h
    interfaces/providers/transaction_provider.h
    interfaces/providers/export_provider.h
    interfaces/providers/search_provider.h
    interfaces/providers/utility_provider.h
    interfaces/providers/settings_provider.h
    interfaces/providers/io_provider.h
    # Contexts
    contexts/system_context.h
    # Providers
    providers/connection_provider.h
    providers/query_provider.h
    providers/async_query_provider.h
    providers/schema_provider.h
    providers/transaction_provider.h
    providers/export_provider.h
    providers/search_provider.h
    providers/utility_provider.h
    providers/settings_provider.h
    providers/io_provider.h
    # Interfaces (Parser)
    interfaces/parsers/er_model.h
    interfaces/parsers/er_diagram_parser.h
    # Parsers
    parsers/a5er_parser.h
    parsers/a5er_utils.h
    parsers/er_diagram_parser_factory.h
    parsers/sql_formatter.h
    parsers/sql_parser.h
    # Exporters
    exporters/csv_exporter.h
    exporters/json_exporter.h
    exporters/excel_exporter.h
    exporters/data_exporter.h
    # Utils
    utils/json_utils.h
    utils/simd_filter.h
    utils/file_utils.h
    utils/file_dialog.h
    utils/settings_manager.h
    utils/session_manager.h
    utils/glaze_meta.h
    utils/sql_escape.h
    utils/global_search.h
    utils/credential_protector.h
    utils/logger.h
)

# Add SSH tunnel header if libssh2 is available
if(SSH_TUNNEL_ENABLED)
    list(APPEND HEADERS network/ssh_tunnel.h)
endif()

# Create a static library for the core functionality
add_library(VelocityDBCore STATIC ${LIB_SOURCES} ${HEADERS})

target_include_directories(VelocityDBCore PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)

target_link_libraries(VelocityDBCore PUBLIC
    webview
    simdjson
    pugixml
    glaze::glaze
    odbc32
    odbccp32
    crypt32
    comdlg32
)

# Glaze requires /Zc:preprocessor for MSVC (conformant preprocessor)
if(MSVC)
    target_compile_options(VelocityDBCore PUBLIC /Zc:preprocessor)
endif()

# Link libssh2 if available
if(SSH_TUNNEL_ENABLED)
    target_link_libraries(VelocityDBCore PUBLIC
        $<IF:$<TARGET_EXISTS:Libssh2::libssh2_shared>,Libssh2::libssh2_shared,Libssh2::libssh2_static>
    )
    target_compile_definitions(VelocityDBCore PUBLIC SSH_TUNNEL_ENABLED)
endif()

# Precompiled Headers for faster compilation
target_precompile_headers(VelocityDBCore PRIVATE
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
add_executable(VelocityDB WIN32 main.cpp resources/app.rc)

target_link_libraries(VelocityDB PRIVATE VelocityDBCore)

# Set output directory to build/[Debug|Release]/
set_target_properties(VelocityDB PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}/RelWithDebInfo"
    RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}/MinSizeRel"
)

# Also set output directory for the static library
set_target_properties(VelocityDBCore PROPERTIES
    ARCHIVE_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
    ARCHIVE_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    ARCHIVE_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}/RelWithDebInfo"
    ARCHIVE_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}/MinSizeRel"
)

# Copy frontend dist to output directory (if it exists)
if(EXISTS "${CMAKE_SOURCE_DIR}/frontend/dist")
    add_custom_command(TARGET VelocityDB POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_SOURCE_DIR}/frontend/dist
        $<TARGET_FILE_DIR:VelocityDB>/frontend
        COMMENT "Copying frontend files..."
    )
else()
    message(STATUS "Frontend dist not found. Run 'npm run build' in frontend/ first.")
endif()

# Copy config directory to output directory
if(EXISTS "${CMAKE_SOURCE_DIR}/config")
    add_custom_command(TARGET VelocityDB POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_SOURCE_DIR}/config
        $<TARGET_FILE_DIR:VelocityDB>/config
        COMMENT "Copying config files..."
    )
endif()
