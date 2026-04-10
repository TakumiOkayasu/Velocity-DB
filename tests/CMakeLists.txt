include(FetchContent)

# Google Test - must set options BEFORE FetchContent_MakeAvailable
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
set(BUILD_GMOCK ON CACHE BOOL "" FORCE)
set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    googletest
    URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    EXCLUDE_FROM_ALL
)

# For Ninja generator, ensure proper configuration
if(CMAKE_GENERATOR MATCHES "Ninja")
    set(CMAKE_POLICY_DEFAULT_CMP0091 NEW)
endif()

FetchContent_MakeAvailable(googletest)

# Test sources
set(TEST_SOURCES
    test_main.cpp
    database/test_sqlserver_driver.cpp
    database/test_schema_inspector.cpp
    database/test_query_history.cpp
    database/test_transaction_manager.cpp
    parsers/test_a5er_parser.cpp
    parsers/test_sql_formatter.cpp
    parsers/test_sql_parser.cpp
    database/test_postgresql_driver.cpp
    database/test_psql_subprocess.cpp
    exporters/test_csv_exporter.cpp
    providers/test_settings_provider.cpp
    providers/test_utility_provider.cpp
    utils/test_sql_validation.cpp
    database/test_thread_pool.cpp
    database/test_result_cache.cpp
    utils/test_version_config.cpp
)

add_executable(VelocityDBTests ${TEST_SOURCES})

target_include_directories(VelocityDBTests PRIVATE
    ${CMAKE_SOURCE_DIR}/backend
    ${CMAKE_SOURCE_DIR}/third_party
)

target_link_libraries(VelocityDBTests PRIVATE
    VelocityDBCore
    gtest
    gtest_main
    gmock
)

# Output directories (from cmake/OutputDirectories.cmake)
target_set_output_directories(VelocityDBTests)

include(GoogleTest)
gtest_discover_tests(VelocityDBTests)
