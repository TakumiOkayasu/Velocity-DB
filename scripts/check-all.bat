@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM Full Project Lint/Format/Build Script for Pre-DateGrip
REM Usage: check-all.bat [Release|Debug]
REM
REM Steps:
REM   1. EOL normalization (CRLF) for all source files
REM   2. C++ checks (clang-format, clang-tidy, build)
REM   3. Frontend checks (ESLint, TypeScript, build)
REM ============================================================

set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..
cd /d "%PROJECT_DIR%"

set BUILD_TYPE=%1
if "%BUILD_TYPE%"=="" set BUILD_TYPE=Release

set TOTAL_ERRORS=0

echo.
echo ************************************************************
echo *  Pre-DateGrip - Full Project Check                       *
echo *  Build Type: %BUILD_TYPE%
echo ************************************************************

REM ============================================================
REM EOL Normalization (all source files)
REM ============================================================
echo.
echo ############################################################
echo # EOL Normalization
echo ############################################################

if exist "%SCRIPT_DIR%convert-eol.ps1" (
    echo Normalizing line endings to CRLF...
    powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%convert-eol.ps1" -EolType crlf
    if errorlevel 1 (
        echo WARNING: EOL conversion had issues
    ) else (
        echo EOL normalization completed.
    )
) else (
    echo WARNING: convert-eol.ps1 not found, skipping EOL normalization
)

REM ============================================================
REM C++ Check (Format + Lint + Build)
REM ============================================================
echo.
echo ############################################################
echo # C++ Backend
echo ############################################################

call "%SCRIPT_DIR%cpp-check.bat" all %BUILD_TYPE% --skip-eol
if errorlevel 1 (
    set /a TOTAL_ERRORS+=1
    echo [FAILED] C++ check failed
) else (
    echo [PASSED] C++ check passed
)

REM ============================================================
REM Frontend Check (Lint + TypeCheck + Build)
REM ============================================================
echo.
echo ############################################################
echo # Frontend (React/TypeScript)
echo ############################################################

cd /d "%PROJECT_DIR%\frontend"

REM Check if node_modules exists
if not exist node_modules (
    echo Installing npm dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed
        set /a TOTAL_ERRORS+=1
        goto summary
    )
)

REM ESLint
echo.
echo [Frontend] Running ESLint...
call npm run lint
if errorlevel 1 (
    echo WARNING: ESLint found issues
    set /a TOTAL_ERRORS+=1
) else (
    echo ESLint passed.
)

REM TypeScript type check
echo.
echo [Frontend] Running TypeScript type check...
call npm run typecheck 2>nul
if errorlevel 1 (
    echo WARNING: TypeScript type check found issues
    set /a TOTAL_ERRORS+=1
) else (
    echo TypeScript type check passed.
)

REM Build
echo.
echo [Frontend] Building frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed
    set /a TOTAL_ERRORS+=1
) else (
    echo Frontend build completed.
)

cd /d "%PROJECT_DIR%"

REM ============================================================
REM Summary
REM ============================================================
:summary
echo.
echo ************************************************************
echo *  Summary
echo ************************************************************

if %TOTAL_ERRORS% equ 0 (
    echo.
    echo   All checks passed!
    echo.
    exit /b 0
) else (
    echo.
    echo   %TOTAL_ERRORS% check(s) failed.
    echo.
    exit /b 1
)
