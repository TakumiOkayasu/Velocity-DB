# Build script for vcpkg-enabled builds
# Run inside the Docker container

$ErrorActionPreference = "Stop"

Write-Host "=== Pre-DateGrip vcpkg Build ===" -ForegroundColor Cyan

# Setup MSVC environment
$vsPath = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -property installationPath
if (-not $vsPath) {
    $vsPath = "C:\Program Files\Microsoft Visual Studio\2022\BuildTools"
}

$vcvarsPath = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
if (Test-Path $vcvarsPath) {
    Write-Host "Setting up MSVC environment from: $vcvarsPath"
    cmd /c "`"$vcvarsPath`" && set" | ForEach-Object {
        if ($_ -match "^([^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
} else {
    Write-Host "Warning: vcvars64.bat not found at $vcvarsPath" -ForegroundColor Yellow
}

# Configure with CMake
Write-Host "`n[1/3] Configuring with CMake..." -ForegroundColor Green
$cmakeArgs = @(
    "-B", "build",
    "-G", "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_TOOLCHAIN_FILE=$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake",
    "-DVCPKG_TARGET_TRIPLET=x64-windows-static"
)

cmake @cmakeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "CMake configuration failed!" -ForegroundColor Red
    exit 1
}

# Build
Write-Host "`n[2/3] Building..." -ForegroundColor Green
cmake --build build --config Release --parallel
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

# Copy artifacts
Write-Host "`n[3/3] Copying artifacts..." -ForegroundColor Green
$outputDir = "C:\output"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

Copy-Item -Path "build\Release\*" -Destination $outputDir -Recurse -Force

Write-Host "`n=== Build Complete ===" -ForegroundColor Cyan
Write-Host "Output: $outputDir"
