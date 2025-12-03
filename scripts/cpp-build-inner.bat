@echo off
setlocal enabledelayedexpansion

REM Internal build script - called by cpp-build.bat with MSVC environment set up

set BUILD_TYPE=%1
if "%BUILD_TYPE%"=="" set BUILD_TYPE=Release

REM Check for Ninja
where ninja >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Ninja not found in PATH
    echo Install: winget install Ninja-build.Ninja
    exit /b 1
)

REM Check if CMakeCache.txt uses different generator
if exist build\CMakeCache.txt (
    findstr /c:"CMAKE_GENERATOR:INTERNAL=Ninja" build\CMakeCache.txt >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo Removing old build cache - different generator...
        rmdir /s /q build 2>nul
    )
)

REM Configure and build
if not exist build mkdir build

echo Configuring with CMake...
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=%BUILD_TYPE%
if %ERRORLEVEL% neq 0 (
    echo ERROR: CMake configuration failed
    exit /b 1
)

echo Building...
cmake --build build --parallel
if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed
    exit /b 1
)

echo.
echo C++ build completed successfully!
exit /b 0
