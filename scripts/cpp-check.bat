@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM C++ Lint/Format/Build Script for Pre-DateGrip
REM Usage: cpp-check.bat [format|lint|build|all] [Release|Debug]
REM
REM Steps:
REM   1. EOL normalization (CRLF)
REM   2. clang-format
REM   3. clang-tidy
REM   4. CMake build
REM ============================================================

set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..
cd /d "%PROJECT_DIR%"

set ACTION=%1
if "%ACTION%"=="" set ACTION=all

set BUILD_TYPE=%2
if "%BUILD_TYPE%"=="" set BUILD_TYPE=Release

set SKIP_EOL=0
if "%3"=="--skip-eol" set SKIP_EOL=1

set ERROR_COUNT=0

REM ============================================================
REM EOL Normalization
REM ============================================================
:check_eol
if "%ACTION%"=="lint" goto check_lint
if "%ACTION%"=="build" goto check_build
if %SKIP_EOL%==1 goto check_format

echo.
echo ============================================================
echo [1/4] Normalizing line endings (CRLF)...
echo ============================================================

if exist "%SCRIPT_DIR%convert-eol.ps1" (
    powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%convert-eol.ps1" -EolType crlf -Target src
    if errorlevel 1 (
        echo WARNING: EOL conversion had issues
    ) else (
        echo EOL normalization completed.
    )
) else (
    echo WARNING: convert-eol.ps1 not found, skipping EOL normalization
)

REM ============================================================
REM Format
REM ============================================================
:check_format

echo.
echo ============================================================
echo [2/4] Running clang-format...
echo ============================================================

clang-format --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: clang-format not found in PATH
    echo Install LLVM: winget install LLVM.LLVM
    set /a ERROR_COUNT+=1
    goto check_lint
)

clang-format --version

echo Formatting C++ source files...
for /r src %%f in (*.cpp *.h) do (
    clang-format -i --style=file "%%f"
    if errorlevel 1 (
        echo ERROR: Failed to format %%f
        set /a ERROR_COUNT+=1
    )
)

echo clang-format completed.

if "%ACTION%"=="format" goto summary

REM ============================================================
REM Lint (clang-tidy)
REM ============================================================
:check_lint
if "%ACTION%"=="build" goto check_build

echo.
echo ============================================================
echo [3/4] Running clang-tidy...
echo ============================================================

clang-tidy --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: clang-tidy not found in PATH
    echo Install LLVM: winget install LLVM.LLVM
    set /a ERROR_COUNT+=1
    goto check_build
)

for /f "tokens=*" %%i in ('clang-tidy --version 2^>^&1') do (
    echo %%i
    goto :done_version
)
:done_version

REM Check if compile_commands.json exists (use separate directory for clang-tidy)
set TIDY_BUILD_DIR=build-tidy

if not exist %TIDY_BUILD_DIR%\compile_commands.json (
    echo WARNING: compile_commands.json not found.
    echo Generating with CMake (Ninja)...

    ninja --version >nul 2>&1
    if errorlevel 1 (
        echo WARNING: Ninja not found. Skipping clang-tidy.
        echo Install Ninja: winget install Ninja-build.Ninja
        goto check_build
    )

    cl 2>&1 | findstr /c:"Microsoft" >nul
    if errorlevel 1 (
        echo WARNING: MSVC (cl.exe) not found in PATH.
        echo Run this script from Developer Command Prompt or skip clang-tidy.
        goto check_build
    )

    if not exist %TIDY_BUILD_DIR% mkdir %TIDY_BUILD_DIR%
    cmake -B %TIDY_BUILD_DIR% -G "Ninja" -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_BUILD_TYPE=%BUILD_TYPE% 2>nul

    if not exist %TIDY_BUILD_DIR%\compile_commands.json (
        echo WARNING: Could not generate compile_commands.json
        echo Skipping clang-tidy (requires compile_commands.json for accurate analysis)
        goto check_build
    )
)

echo Running clang-tidy on source files...
set TIDY_WARNINGS=0

for /r src %%f in (*.cpp) do (
    echo Checking: %%~nxf
    clang-tidy "%%f" -p %TIDY_BUILD_DIR% --quiet 2>&1 | findstr /i "warning error" >nul
    if not errorlevel 1 (
        set /a TIDY_WARNINGS+=1
    )
)

if !TIDY_WARNINGS! gtr 0 (
    echo NOTE: clang-tidy found potential issues in !TIDY_WARNINGS! file(s)
) else (
    echo clang-tidy completed with no issues.
)

if "%ACTION%"=="lint" goto summary

REM ============================================================
REM Build
REM ============================================================
:check_build

echo.
echo ============================================================
echo [4/4] Building C++ project (%BUILD_TYPE%)...
echo ============================================================

REM Detect available build system
set GENERATOR=

REM Try Visual Studio first
cmake -G "Visual Studio 17 2022" --system-information >nul 2>&1
if not errorlevel 1 (
    set GENERATOR=Visual Studio 17 2022
    set GENERATOR_ARGS=-A x64
    goto :do_build
)

REM Try Ninja with MSVC
ninja --version >nul 2>&1
if not errorlevel 1 (
    cl 2>&1 | findstr /c:"Microsoft" >nul
    if not errorlevel 1 (
        set GENERATOR=Ninja
        set GENERATOR_ARGS=-DCMAKE_BUILD_TYPE=%BUILD_TYPE%
        goto :do_build
    )
)

REM No build system available
echo ERROR: No suitable build system found.
echo Options:
echo   1. Install Visual Studio 2022 with C++ workload
echo   2. Run from Developer Command Prompt with Ninja installed
set /a ERROR_COUNT+=1
goto summary

:do_build
echo Using generator: %GENERATOR%

if not exist build mkdir build
cd build

if "%GENERATOR%"=="Visual Studio 17 2022" (
    cmake .. -G "%GENERATOR%" %GENERATOR_ARGS%
    if errorlevel 1 (
        echo ERROR: CMake configuration failed
        set /a ERROR_COUNT+=1
        cd ..
        goto summary
    )

    cmake --build . --config %BUILD_TYPE%
    if errorlevel 1 (
        echo ERROR: Build failed
        set /a ERROR_COUNT+=1
        cd ..
        goto summary
    )
) else (
    cmake .. -G "%GENERATOR%" %GENERATOR_ARGS%
    if errorlevel 1 (
        echo ERROR: CMake configuration failed
        set /a ERROR_COUNT+=1
        cd ..
        goto summary
    )

    cmake --build .
    if errorlevel 1 (
        echo ERROR: Build failed
        set /a ERROR_COUNT+=1
        cd ..
        goto summary
    )
)

echo Build completed successfully!
cd ..

REM ============================================================
REM Summary
REM ============================================================
:summary
echo.
echo ============================================================
echo Summary
echo ============================================================

if %ERROR_COUNT% equ 0 (
    echo All checks passed!
    exit /b 0
) else (
    echo %ERROR_COUNT% error(s) found.
    exit /b 1
)
