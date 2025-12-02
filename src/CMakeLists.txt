# Core library sources (without main.cpp)
set(LIB_SOURCES
    webview_app.cpp
    ipc_handler.cpp
    database/sqlserver_driver.cpp
    database/connection_pool.cpp
    database/result_cache.cpp
    database/schema_inspector.cpp
    database/query_history.cpp
    database/transaction_manager.cpp
    parsers/a5er_parser.cpp
    parsers/sql_formatter.cpp
    exporters/csv_exporter.cpp
    exporters/json_exporter.cpp
    exporters/excel_exporter.cpp
    utils/json_utils.cpp
    utils/simd_filter.cpp
    utils/file_utils.cpp
)

set(HEADERS
    webview_app.h
    ipc_handler.h
    database/sqlserver_driver.h
    database/connection_pool.h
    database/result_cache.h
    database/schema_inspector.h
    database/query_history.h
    database/transaction_manager.h
    parsers/a5er_parser.h
    parsers/sql_formatter.h
    exporters/csv_exporter.h
    exporters/json_exporter.h
    exporters/excel_exporter.h
    exporters/data_exporter.h
    utils/json_utils.h
    utils/simd_filter.h
    utils/file_utils.h
)

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
)

# Main executable
add_executable(PreDateGrip WIN32 main.cpp)

target_link_libraries(PreDateGrip PRIVATE PreDateGripCore)

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
