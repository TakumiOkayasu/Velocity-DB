@echo off
setlocal

REM ============================================================
REM C++ Build Script with Auto Visual Studio Detection
REM Usage: cpp-build.bat [Release|Debug]
REM ============================================================

set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..
cd /d "%PROJECT_DIR%"

set BUILD_TYPE=%1
if "%BUILD_TYPE%"=="" set BUILD_TYPE=Release

echo ============================================================
echo C++ Build (%BUILD_TYPE%)
echo ============================================================

REM Check if already in Developer Command Prompt
where cl >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Using existing MSVC environment
    goto :do_build
)

REM Find Visual Studio vcvars64.bat
set VCVARS=

REM Check VS 18 (2026)
if exist "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)
if exist "C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)
if exist "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)

REM Check VS 2022
if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)
if exist "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)
if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)
if exist "D:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=D:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)

REM Check VS 2019
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
    goto :found_vs
)

echo ERROR: Visual Studio not found
echo.
echo Please install Visual Studio 2019/2022 with C++ workload
exit /b 1

:found_vs
echo Found: %VCVARS%
echo Initializing MSVC environment...

REM Run vcvars and build in a single cmd session to avoid parsing issues
cmd /c ""%VCVARS%" >nul 2>&1 && cd /d "%PROJECT_DIR%" && "%SCRIPT_DIR%cpp-build-inner.bat" %BUILD_TYPE%"
exit /b %ERRORLEVEL%

:do_build
call "%SCRIPT_DIR%cpp-build-inner.bat" %BUILD_TYPE%
exit /b %ERRORLEVEL%
