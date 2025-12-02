@echo off
setlocal

set BUILD_TYPE=%1
if "%BUILD_TYPE%"=="" set BUILD_TYPE=Debug

echo Running tests (%BUILD_TYPE%)...

cd build
ctest -C %BUILD_TYPE% --output-on-failure
if errorlevel 1 (
    echo Tests failed
    exit /b 1
)

echo All tests passed!
