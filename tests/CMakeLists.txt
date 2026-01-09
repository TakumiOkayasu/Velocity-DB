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
    exporters/test_csv_exporter.cpp
)

add_executable(PreDateGripTests ${TEST_SOURCES})

target_include_directories(PreDateGripTests PRIVATE
    ${CMAKE_SOURCE_DIR}/backend
    ${CMAKE_SOURCE_DIR}/third_party
)

target_link_libraries(PreDateGripTests PRIVATE
    PreDateGripCore
    gtest
    gtest_main
    gmock
)

# Set output directory to build/[Debug|Release]/
set_target_properties(PreDateGripTests PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}/RelWithDebInfo"
    RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}/MinSizeRel"
)

include(GoogleTest)
gtest_discover_tests(PreDateGripTests)
