@echo off
setlocal

set BUILD_TYPE=%1
if "%BUILD_TYPE%"=="" set BUILD_TYPE=Debug

echo Building Pre-DateGrip (%BUILD_TYPE%)...

if not exist build mkdir build
cd build

cmake .. -G "Visual Studio 17 2022" -A x64
if errorlevel 1 (
    echo CMake configuration failed
    exit /b 1
)

cmake --build . --config %BUILD_TYPE%
if errorlevel 1 (
    echo Build failed
    exit /b 1
)

echo Build completed successfully!
