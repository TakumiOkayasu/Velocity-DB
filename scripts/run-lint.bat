@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..

echo Running lint and format checks...

REM Frontend lint + format (Biome)
echo.
echo [Frontend] Running Biome lint and format...
cd /d "%PROJECT_DIR%\frontend"

REM Check mode (same as CI) - no auto-fix
call npm run lint
if !ERRORLEVEL! neq 0 (
    echo [Frontend] Lint failed
    echo.
    echo To auto-fix, run: cd frontend ^&^& npm run lint:fix
    exit /b 1
)
echo [Frontend] Lint and format passed

REM C++ format (clang-format) - check only, no auto-fix
echo.
echo [C++] Running clang-format check...
cd /d "%PROJECT_DIR%"
where clang-format >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [C++] clang-format not found, skipping C++ format check
    goto :done
)

REM Check formatting (same as CI)
set CPP_FORMAT_ERROR=0
for /r src %%f in (*.cpp *.h) do (
    clang-format --style=file --dry-run --Werror "%%f" >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo [C++] Format error: %%f
        set CPP_FORMAT_ERROR=1
    )
)
if %CPP_FORMAT_ERROR% neq 0 (
    echo [C++] Format check failed
    echo.
    echo To auto-fix, run: for /r src %%%%f in ^(*.cpp *.h^) do clang-format -i "%%%%f"
    exit /b 1
)
echo [C++] Format check passed

:done
echo.
echo All lint and format checks passed!
exit /b 0
