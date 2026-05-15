include(FetchContent)

# Google Test - must set options BEFORE FetchContent_MakeAvailable
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
set(BUILD_GMOCK ON CACHE BOOL "" FORCE)
set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)

# TLS_VERIFY OFF: Windows schannel が CRL/OCSP 取得失敗で
# CRYPT_E_NO_REVOCATION_CHECK を返す環境への回避策。
# TODO(@TakumiOkayasu): URL_HASH SHA256 を追加して内容完全性を担保する
FetchContent_Declare(
    googletest
    URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip
    TLS_VERIFY OFF
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
    database/test_odbc_unicode.cpp
    database/test_query_history.cpp
    database/test_sql_builder.cpp
    database/test_transaction_manager.cpp
    parsers/test_a5er_parser.cpp
    parsers/test_sql_formatter.cpp
    parsers/test_sql_linter.cpp
    parsers/test_sql_parser.cpp
    database/test_postgresql_driver.cpp
    database/test_pg_binary_decoder.cpp
    database/test_psql_subprocess.cpp
    exporters/test_csv_exporter.cpp
    providers/test_lint_provider.cpp
    providers/test_query_result_formatter.cpp
    providers/test_settings_provider.cpp
    providers/test_utility_provider.cpp
    search/test_simd_filter.cpp
    utils/test_sql_validation.cpp
    database/test_thread_pool.cpp
    database/test_result_cache.cpp
    utils/test_version_config.cpp
    utils/test_glaze_meta_roundtrip.cpp
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

# MSVC compiler options (includes /utf-8 so tests can use non-ASCII string literals)
target_set_msvc_options(VelocityDBTests)

# Output directories (from cmake/OutputDirectories.cmake)
target_set_output_directories(VelocityDBTests)

include(GoogleTest)
gtest_discover_tests(VelocityDBTests)

# Performance benchmark tests are built as a separate executable and labeled
# "perf" so unit-test runs can skip them via `ctest -LE perf`.
add_subdirectory(perf)
