<#
.SYNOPSIS
    End-of-Line Converter for Pre-DateGrip

.DESCRIPTION
    Converts line endings between CRLF (Windows) and LF (Unix) for source files.

.PARAMETER EolType
    Target line ending: 'crlf' for Windows or 'lf' for Unix

.PARAMETER Target
    File or directory to convert. Defaults to all source files in project.

.PARAMETER Extension
    Filter by file extension (e.g., '.cpp', '.ts')

.EXAMPLE
    .\convert-eol.ps1 crlf
    Convert all source files to CRLF

.EXAMPLE
    .\convert-eol.ps1 lf src
    Convert all files in src/ to LF

.EXAMPLE
    .\convert-eol.ps1 crlf src -Extension .cpp
    Convert only .cpp files in src/ to CRLF
#>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet('crlf', 'lf')]
    [string]$EolType,

    [Parameter(Position=1)]
    [string]$Target,

    [Parameter()]
    [string]$Extension
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
Set-Location $projectDir

# File extensions to process
$defaultExtensions = @('.cpp', '.h', '.hpp', '.c', '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html', '.md', '.yml', '.yaml', '.cmake', '.bat', '.ps1')

# Directories to skip
$skipDirs = @('node_modules', '.git', 'build', 'dist', 'build-tidy')

function Convert-FileEol {
    param(
        [string]$FilePath,
        [string]$TargetEol
    )

    # Skip if in excluded directory
    foreach ($skip in $skipDirs) {
        if ($FilePath -match "[\\/]$skip[\\/]") {
            return $false
        }
    }

    if (-not (Test-Path $FilePath -PathType Leaf)) {
        return $false
    }

    try {
        # Read file as raw bytes to preserve encoding
        $bytes = [System.IO.File]::ReadAllBytes($FilePath)

        # Detect and skip BOM if present
        $offset = 0
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            $offset = 3  # UTF-8 BOM
        }

        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        $content = $utf8NoBom.GetString($bytes, $offset, $bytes.Length - $offset)

        if (-not $content) {
            return $false
        }

        if ($TargetEol -eq 'crlf') {
            # Convert LF to CRLF (avoid double conversion)
            $newContent = $content -replace "(?<!\r)\n", "`r`n"
        } else {
            # Convert CRLF to LF
            $newContent = $content -replace "`r`n", "`n"
        }

        if ($content -ne $newContent) {
            # Write UTF8 without BOM
            [System.IO.File]::WriteAllText($FilePath, $newContent, $utf8NoBom)
            return $true
        }
        return $false
    } catch {
        Write-Warning "Failed to process: $FilePath - $_"
        return $false
    }
}

function Get-SourceFiles {
    param(
        [string]$Path,
        [string]$ExtFilter
    )

    $files = @()

    if ($ExtFilter) {
        $files = Get-ChildItem -Path $Path -Recurse -File -Filter "*$ExtFilter" -ErrorAction SilentlyContinue
    } else {
        foreach ($ext in $defaultExtensions) {
            $files += Get-ChildItem -Path $Path -Recurse -File -Filter "*$ext" -ErrorAction SilentlyContinue
        }
        # Also include specific files without extension patterns
        $specificFiles = @('CMakeLists.txt', '.gitignore', '.gitattributes', '.clang-format', '.clang-tidy')
        foreach ($file in $specificFiles) {
            $fullPath = Join-Path $Path $file
            if (Test-Path $fullPath -PathType Leaf) {
                $files += Get-Item $fullPath
            }
        }
    }

    return $files
}

# Main execution
Write-Host ""
Write-Host "============================================================"
Write-Host "End-of-Line Converter"
Write-Host "Target EOL: $($EolType.ToUpper())"
Write-Host "============================================================"
Write-Host ""

$convertedCount = 0
$processedCount = 0

if ($Target) {
    if (Test-Path $Target -PathType Leaf) {
        # Single file
        Write-Host "Converting file: $Target"
        $processedCount++
        if (Convert-FileEol -FilePath $Target -TargetEol $EolType) {
            Write-Host "  $Target"
            $convertedCount++
        }
    } elseif (Test-Path $Target -PathType Container) {
        # Directory
        Write-Host "Converting files in: $Target"
        $files = Get-SourceFiles -Path $Target -ExtFilter $Extension
        foreach ($file in $files) {
            $processedCount++
            if (Convert-FileEol -FilePath $file.FullName -TargetEol $EolType) {
                Write-Host "  $($file.FullName)"
                $convertedCount++
            }
        }
    } else {
        Write-Error "Target not found: $Target"
        exit 1
    }
} else {
    # Default: all source files
    Write-Host "Converting all source files in project..."

    # C++ sources
    if (Test-Path "src") {
        $files = Get-SourceFiles -Path "src" -ExtFilter $Extension
        foreach ($file in $files) {
            $processedCount++
            if (Convert-FileEol -FilePath $file.FullName -TargetEol $EolType) {
                Write-Host "  $($file.FullName)"
                $convertedCount++
            }
        }
    }

    # Frontend sources
    if (Test-Path "frontend\src") {
        $files = Get-SourceFiles -Path "frontend\src" -ExtFilter $Extension
        foreach ($file in $files) {
            $processedCount++
            if (Convert-FileEol -FilePath $file.FullName -TargetEol $EolType) {
                Write-Host "  $($file.FullName)"
                $convertedCount++
            }
        }
    }

    # Scripts
    if (Test-Path "scripts") {
        $files = Get-SourceFiles -Path "scripts" -ExtFilter $Extension
        foreach ($file in $files) {
            $processedCount++
            if (Convert-FileEol -FilePath $file.FullName -TargetEol $EolType) {
                Write-Host "  $($file.FullName)"
                $convertedCount++
            }
        }
    }

    # Root files
    $rootFiles = @('CMakeLists.txt', '.gitignore', '.gitattributes', '.clang-format', '.clang-tidy', 'CLAUDE.md', 'README.md')
    foreach ($file in $rootFiles) {
        if (Test-Path $file -PathType Leaf) {
            $processedCount++
            if (Convert-FileEol -FilePath $file -TargetEol $EolType) {
                Write-Host "  $file"
                $convertedCount++
            }
        }
    }
}

Write-Host ""
Write-Host "============================================================"
Write-Host "Processed: $processedCount file(s)"
Write-Host "Converted: $convertedCount file(s) to $($EolType.ToUpper())"
Write-Host "============================================================"
