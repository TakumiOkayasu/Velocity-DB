# Performance benchmark tests
#
# Built as a separate executable (VelocityDBPerfTests) so that bench cases can be
# run/skipped independently of unit tests via the "perf" ctest label.
#
# Run only perf:        ctest --preset release -L perf
# Skip perf in normal:  ctest --preset release -LE perf

set(PERF_TEST_SOURCES
    test_main.cpp
    test_smoke_bench.cpp
    test_query_history_search_bench.cpp
    test_simd_filter_bench.cpp
    test_csv_exporter_bench.cpp
    test_result_cache_bench.cpp
    test_sql_formatter_bench.cpp
    test_a5er_parser_bench.cpp
    integration/test_select_million_rows_bench.cpp
)

add_executable(VelocityDBPerfTests ${PERF_TEST_SOURCES})

target_include_directories(VelocityDBPerfTests PRIVATE
    ${CMAKE_SOURCE_DIR}/backend
    ${CMAKE_SOURCE_DIR}/third_party
)

target_compile_definitions(VelocityDBPerfTests PRIVATE
    TEST_FIXTURES_DIR="${CMAKE_SOURCE_DIR}/tests/fixtures"
)

target_link_libraries(VelocityDBPerfTests PRIVATE
    VelocityDBCore
    gtest
    gtest_main
    gmock
)

target_set_msvc_options(VelocityDBPerfTests)
target_set_output_directories(VelocityDBPerfTests)

include(GoogleTest)
gtest_discover_tests(VelocityDBPerfTests
    PROPERTIES LABELS "perf"
)
