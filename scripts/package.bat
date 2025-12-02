@echo off
setlocal

echo Packaging Pre-DateGrip...

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

if not exist ..\dist mkdir ..\dist

copy /Y Release\PreDateGrip.exe ..\dist\
if exist ..\frontend\dist (
    xcopy /E /Y ..\frontend\dist ..\dist\web\
)

echo Package created in dist/
