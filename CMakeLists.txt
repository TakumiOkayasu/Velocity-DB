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
set(CMAKE_C_COMPILER_FORCED TRUE)

project(VelocityDB VERSION 1.4.2 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Reusable CMake modules
list(APPEND CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake")
include(CompilerWarnings)
include(ReleaseOptimizations)
include(OutputDirectories)

# Windows specific settings
if(WIN32)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# Options
option(BUILD_TESTS "Build tests" ON)
option(ENABLE_SIMD "Enable SIMD optimizations (AVX2)" ON)

# LTO (Release only)
include(CheckIPOSupported)
check_ipo_supported(RESULT ipo_supported OUTPUT ipo_output LANGUAGES CXX)
if(ipo_supported)
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE TRUE)
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
