@echo off
setlocal

echo Packaging Pre-DateGrip...

REM Build frontend first
echo Building frontend...
cd /d %~dp0\..\frontend
if not exist node_modules (
    echo Installing npm dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed
        exit /b 1
    )
)
call npm run build
if errorlevel 1 (
    echo Frontend build failed
    exit /b 1
)
cd /d %~dp0\..

REM Build backend
if not exist build (
    echo Build directory not found. Run build.bat first.
    exit /b 1
)

cd build
cmake --build . --config Release
if errorlevel 1 (
    echo Release build failed
    exit /b 1
)
cd ..

REM Create distribution package
if not exist dist mkdir dist
if exist dist\frontend rmdir /S /Q dist\frontend
mkdir dist\frontend

copy /Y build\Release\PreDateGrip.exe dist\
xcopy /E /Y frontend\dist\* dist\frontend\

echo.
echo Package created in dist/
echo Contents:
dir /B dist
