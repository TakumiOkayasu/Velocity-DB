cmake_minimum_required(VERSION 3.20)
project(PreDateGrip VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Windows specific settings
if(WIN32)
    add_definitions(-DUNICODE -D_UNICODE)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    # Define _DEBUG for Debug builds (MSVC normally does this, but ensure it for Ninja)
    add_compile_definitions($<$<CONFIG:Debug>:_DEBUG>)
endif()

# Options
option(BUILD_TESTS "Build tests" ON)
option(ENABLE_SIMD "Enable SIMD optimizations (AVX2)" ON)

# SIMD settings
if(ENABLE_SIMD AND MSVC)
    add_compile_options(/arch:AVX2)
endif()

# Third-party libraries
add_subdirectory(third_party)

# Main application
add_subdirectory(src)

# Tests
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
