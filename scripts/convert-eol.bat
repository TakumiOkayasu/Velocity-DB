@echo off
REM ============================================================
REM End-of-Line Converter Wrapper
REM Usage: convert-eol.bat [crlf|lf] [file|directory] [extension]
REM
REM This is a wrapper for convert-eol.ps1
REM ============================================================

set SCRIPT_DIR=%~dp0

if "%1"=="" (
    echo Usage: convert-eol.bat [crlf^|lf] [file^|directory] [extension]
    echo.
    echo Options:
    echo   crlf    - Convert to Windows line endings [CRLF]
    echo   lf      - Convert to Unix line endings [LF]
    echo.
    echo Examples:
    echo   convert-eol.bat crlf                - Convert all source files to CRLF
    echo   convert-eol.bat lf src              - Convert src/ to LF
    echo   convert-eol.bat crlf src .cpp       - Convert .cpp in src/ to CRLF
    exit /b 1
)

set EOL=%1
set TARGET=%2
set EXT=%3

if "%TARGET%"=="" (
    powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%convert-eol.ps1" -EolType %EOL%
) else if "%EXT%"=="" (
    powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%convert-eol.ps1" -EolType %EOL% -Target "%TARGET%"
) else (
    powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%convert-eol.ps1" -EolType %EOL% -Target "%TARGET%" -Extension "%EXT%"
)
