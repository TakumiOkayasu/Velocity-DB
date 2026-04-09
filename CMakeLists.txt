cmake_minimum_required(VERSION 3.20)

# Must set policy before project() for MSVC runtime library
cmake_policy(SET CMP0091 NEW)

# vcpkg support (optional - only if VCPKG_ROOT is set)
if(DEFINED ENV{VCPKG_ROOT} AND NOT DEFINED CMAKE_TOOLCHAIN_FILE)
    set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
        CACHE STRING "")
endif()

# Disable vcpkg manifest mode when vcpkg.json is absent
if(NOT EXISTS "${CMAKE_SOURCE_DIR}/vcpkg.json")
    set(VCPKG_MANIFEST_MODE OFF CACHE BOOL "" FORCE)
endif()

# Norton false positive workaround: skip C compiler ID exe generation
# FetchContent dependencies (e.g. Google Test) enable C language, causing
# CMake to generate CMakeCCompilerId.exe. Norton's heuristic detection
# quarantines this as Win64:MalwareX-gen. FORCED skips the probe.
# CXX detection is kept intact — Google Test requires compile feature info.
set(CMAKE_C_COMPILER_FORCED TRUE)

project(VelocityDB VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Unity Build for faster compilation (currently disabled due to namespace conflicts)
# TODO: Re-enable after resolving anonymous namespace collisions
# set(CMAKE_UNITY_BUILD ON)
# set(CMAKE_UNITY_BUILD_BATCH_SIZE 8)

# Windows specific settings
if(WIN32)
    add_definitions(-DUNICODE -D_UNICODE)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    # Define _DEBUG for Debug builds (MSVC normally does this, but ensure it for Ninja)
    add_compile_definitions($<$<CONFIG:Debug>:_DEBUG>)
    # Enable multi-processor compilation and UTF-8 source/execution charset for MSVC
    if(MSVC)
        add_compile_options(/MP /utf-8)
    endif()
endif()

# Options
option(BUILD_TESTS "Build tests" ON)
option(ENABLE_SIMD "Enable SIMD optimizations (AVX2)" ON)

# SIMD settings
if(ENABLE_SIMD AND MSVC)
    add_compile_options(/arch:AVX2)
endif()

# Link-Time Optimization (Release only)
# MSVC: adds /GL (compile) + /LTCG (link) for cross-translation-unit inlining
include(CheckIPOSupported)
check_ipo_supported(RESULT ipo_supported OUTPUT ipo_output LANGUAGES CXX)
if(ipo_supported)
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE TRUE)
    message(STATUS "LTO enabled for Release builds")
else()
    message(STATUS "LTO not supported: ${ipo_output}")
endif()

# Additional Release optimizations (MSVC)
if(MSVC)
    add_compile_options(
        $<$<CONFIG:Release>:/Gy>  # Function-level linking (unused function removal)
        $<$<CONFIG:Release>:/Gw>  # Global data optimization (unused data removal)
    )
    add_link_options(
        $<$<CONFIG:Release>:/OPT:REF>   # Remove unreferenced functions
        $<$<CONFIG:Release>:/OPT:ICF>   # Fold identical COMDATs
    )
endif()

# Third-party libraries
add_subdirectory(third_party)

# Main application
add_subdirectory(backend)

# Tests
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
