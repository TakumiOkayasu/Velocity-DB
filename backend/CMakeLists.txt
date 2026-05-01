# Find libpq (required for PostgreSQL native connection)
find_package(PostgreSQL REQUIRED)
message(STATUS "PostgreSQL (libpq) found: ${PostgreSQL_INCLUDE_DIRS}")

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
    database/copy_from_stdin_handler.cpp
    database/psql_subprocess.cpp
    database/driver_factory.cpp
    database/connection_registry.cpp
    database/result_cache.cpp
    database/async_query_executor.cpp
    database/async_connection_executor.cpp
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
    providers/lint_provider.cpp
    # Parsers
    parsers/a5er_parser.cpp
    parsers/a5er_utils.cpp
    parsers/er_diagram_parser_factory.cpp
    parsers/sql_formatter.cpp
    parsers/sql_linter.cpp
    parsers/sql_parser.cpp
    parsers/copy_block_detector.cpp
    # Exporters
    exporters/csv_exporter.cpp
    exporters/json_exporter.cpp
    exporters/excel_exporter.cpp
    # Accessors (Layer #4 — direct resource access)
    accessors/settings_accessor.cpp
    accessors/session_accessor.cpp
    # Search (Layer #4 — service layer; DB driver / dialect 依存)
    search/global_search.cpp
    search/simd_filter.cpp
    # Utils
    utils/json_utils.cpp
    utils/file_utils.cpp
    utils/file_dialog.cpp
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
    database/copy_from_stdin_handler.h
    database/psql_subprocess.h
    database/pg_result_ptr.h
    database/connection_registry.h
    database/result_cache.h
    database/async_query_executor.h
    database/async_connection_executor.h
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
    interfaces/block_detector.h
    interfaces/statement_handler.h
    # Interfaces (Provider)
    interfaces/system_context.h
    interfaces/providers/connection_provider.h
    interfaces/providers/query_provider.h
    # ISP-split sub-IFs of IQueryProvider (#449); 集約 IF は Phase 4 (#456) で解体予定
    interfaces/providers/query_executor.h
    interfaces/providers/result_filter.h
    interfaces/providers/result_cache_control.h
    interfaces/providers/query_history_accessor.h
    interfaces/providers/dialect_sql_builder.h
    interfaces/providers/async_query_provider.h
    interfaces/providers/schema_provider.h
    interfaces/providers/transaction_provider.h
    interfaces/providers/export_provider.h
    interfaces/providers/search_provider.h
    interfaces/providers/utility_provider.h
    interfaces/providers/settings_provider.h
    # ISP-split sub-IFs of ISettingsProvider (#450); 集約 IF は Phase 4 (#456) で解体予定
    interfaces/providers/app_settings_accessor.h
    interfaces/providers/connection_profile_accessor.h
    interfaces/providers/session_state_accessor.h
    interfaces/providers/io_provider.h
    interfaces/providers/lint_provider.h
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
    providers/lint_provider.h
    # Interfaces (Parser)
    interfaces/parsers/er_model.h
    interfaces/parsers/er_diagram_parser.h
    # Parsers
    parsers/a5er_parser.h
    parsers/a5er_utils.h
    parsers/er_diagram_parser_factory.h
    parsers/sql_formatter.h
    parsers/sql_linter.h
    parsers/sql_parser.h
    parsers/copy_block_detector.h
    parsers/split_utils.h
    # Exporters
    exporters/csv_exporter.h
    exporters/json_exporter.h
    exporters/excel_exporter.h
    exporters/data_exporter.h
    # Accessors (Layer #4 — direct resource access)
    accessors/settings_accessor.h
    accessors/session_accessor.h
    accessors/glaze_meta.h
    # Search (Layer #4 — service layer; DB driver / dialect 依存)
    search/global_search.h
    search/simd_filter.h
    # Utils
    utils/json_utils.h
    utils/file_utils.h
    utils/file_dialog.h
    utils/sql_escape.h
    utils/credential_protector.h
    utils/logger.h
    utils/string_utils.h
)

# Add SSH tunnel header if libssh2 is available
if(SSH_TUNNEL_ENABLED)
    list(APPEND HEADERS network/ssh_tunnel.h)
endif()

# Generate version header from CMake project version
configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/version_config.h.in
    ${CMAKE_CURRENT_BINARY_DIR}/generated/version_config.h
    @ONLY
)

# Create a static library for the core functionality
add_library(VelocityDBCore STATIC ${LIB_SOURCES} ${HEADERS})

target_include_directories(VelocityDBCore PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_BINARY_DIR}/generated
    ${CMAKE_SOURCE_DIR}/third_party
)

target_compile_definitions(VelocityDBCore PUBLIC
    UNICODE _UNICODE
    $<$<CONFIG:Debug>:_DEBUG>
)

target_link_libraries(VelocityDBCore PUBLIC
    webview
    simdjson
    pugixml
    glaze::glaze
    PostgreSQL::PostgreSQL
    odbc32
    odbccp32
    crypt32
    comdlg32
)

# Glaze requires conformant preprocessor
if(MSVC)
    target_compile_options(VelocityDBCore PUBLIC /Zc:preprocessor)
endif()

# MSVC compiler options and Release optimizations (from cmake/ modules)
target_set_msvc_options(VelocityDBCore)
target_set_release_optimizations(VelocityDBCore)

# SIMD
if(ENABLE_SIMD AND MSVC)
    target_compile_options(VelocityDBCore PRIVATE /arch:AVX2)
endif()

# libssh2: prefer shared, fall back to static (vcpkg may provide either)
if(SSH_TUNNEL_ENABLED)
    target_link_libraries(VelocityDBCore PUBLIC
        $<IF:$<TARGET_EXISTS:Libssh2::libssh2_shared>,Libssh2::libssh2_shared,Libssh2::libssh2_static>
    )
    target_compile_definitions(VelocityDBCore PUBLIC SSH_TUNNEL_ENABLED)
endif()

# Precompiled Headers
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

# Output directories (from cmake/OutputDirectories.cmake)
target_set_output_directories(VelocityDBCore)
target_set_output_directories(VelocityDB)

# Copy frontend dist to output directory (if it exists)
# Clean destination first to remove stale hashed chunks from previous builds
if(EXISTS "${CMAKE_SOURCE_DIR}/frontend/dist")
    add_custom_command(TARGET VelocityDB POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E rm -rf $<TARGET_FILE_DIR:VelocityDB>/frontend
        COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_SOURCE_DIR}/frontend/dist
        $<TARGET_FILE_DIR:VelocityDB>/frontend
        COMMENT "Copying frontend files..."
    )
else()
    message(STATUS "Frontend dist not found. Run 'bun run build' in frontend/ first.")
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

# Copy sqruff.exe to output directory (expected at <exe_dir>/sqruff/sqruff.exe)
if(DEFINED SQRUFF_BINARY_PATH AND EXISTS "${SQRUFF_BINARY_PATH}")
    add_custom_command(TARGET VelocityDB POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory $<TARGET_FILE_DIR:VelocityDB>/sqruff
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
        ${SQRUFF_BINARY_PATH}
        $<TARGET_FILE_DIR:VelocityDB>/sqruff/sqruff.exe
        COMMENT "Copying sqruff.exe..."
    )
endif()
