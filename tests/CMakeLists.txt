include(FetchContent)

# Google Test
FetchContent_Declare(
    googletest
    URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# Test sources
set(TEST_SOURCES
    test_main.cpp
    database/test_sqlserver_driver.cpp
    database/test_query_history.cpp
    database/test_transaction_manager.cpp
    parsers/test_a5er_parser.cpp
    parsers/test_sql_formatter.cpp
    exporters/test_csv_exporter.cpp
)

add_executable(PreDateGripTests ${TEST_SOURCES})

target_include_directories(PreDateGripTests PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party
)

target_link_libraries(PreDateGripTests PRIVATE
    PreDateGripCore
    gtest
    gtest_main
    gmock
)

include(GoogleTest)
gtest_discover_tests(PreDateGripTests)
