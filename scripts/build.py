#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip Build Script

Usage:
    uv run scripts/build.py [Debug|Release]
    python scripts/build.py [Debug|Release]
"""

import shutil
import subprocess
import sys
import os
from pathlib import Path


def run_command(cmd: list[str], description: str, env: dict | None = None) -> bool:
    """Run a command and return success status."""
    print(f"\n{'='*60}")
    print(f"  {description}")
    print(f"  Command: {' '.join(cmd)}")
    print(f"{'='*60}\n")

    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)

    try:
        result = subprocess.run(cmd, env=merged_env)
        return result.returncode == 0
    except FileNotFoundError as e:
        print(f"ERROR: Command not found: {cmd[0]}")
        print(f"  Details: {e}")
        return False
    except Exception as e:
        print(f"ERROR: Failed to execute command: {e}")
        return False


def find_vcvars() -> Path | None:
    """Find vcvars64.bat for MSVC environment setup."""
    possible_paths = [
        # VS 2022 (version 17)
        Path(r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"),
        Path(r"C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"),
        Path(r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"),
        Path(r"D:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"),
        Path(r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"),
        # VS Preview / newer versions (version 18+)
        Path(r"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"),
        Path(r"C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat"),
        Path(r"C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat"),
        # VS 2019 (version 16) fallback
        Path(r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat"),
        Path(r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\VC\Auxiliary\Build\vcvars64.bat"),
        Path(r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\VC\Auxiliary\Build\vcvars64.bat"),
    ]

    for path in possible_paths:
        if path.exists():
            return path
    return None


def get_msvc_env() -> dict[str, str]:
    """Get environment variables from vcvars64.bat."""
    vcvars = find_vcvars()
    if not vcvars:
        print("ERROR: Could not find vcvars64.bat")
        print("  Visual Studio 2022 with C++ workload is required.")
        print("")
        print("  Install options:")
        print("    1. Visual Studio Installer -> Modify -> 'Desktop development with C++'")
        print("    2. winget install Microsoft.VisualStudio.2022.Community")
        print("")
        print("  Searched locations:")
        print("    - C:\\Program Files\\Microsoft Visual Studio\\2022\\*")
        print("    - D:\\Program Files\\Microsoft Visual Studio\\2022\\*")
        print("    - C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\*")
        sys.exit(1)

    print(f"Using MSVC from: {vcvars}")

    # Run vcvars64.bat and capture environment
    # Security: Using shell=True here is intentional and safe because:
    # 1. vcvars path comes from find_vcvars() which only returns hardcoded system paths
    # 2. No user input is involved in command construction
    # 3. This is required to properly chain vcvars64.bat with 'set' command
    cmd = f'"{vcvars}" && set'
    try:
        # nosemgrep: python.lang.security.audit.subprocess-shell-true
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            shell=True  # Safe: vcvars path from find_vcvars() - hardcoded paths only
        )
    except Exception as e:
        print(f"ERROR: Failed to execute vcvars64.bat: {e}")
        sys.exit(1)

    if result.returncode != 0:
        print("ERROR: Failed to run vcvars64.bat")
        print(f"  Exit code: {result.returncode}")
        if result.stderr:
            print(f"  Stderr: {result.stderr}")
        sys.exit(1)

    env = {}
    for line in result.stdout.splitlines():
        if '=' in line:
            key, _, value = line.partition('=')
            env[key] = value

    if not env:
        print("ERROR: Failed to capture environment from vcvars64.bat")
        print("  No environment variables were captured.")
        sys.exit(1)

    return env


def check_tools(env: dict[str, str]) -> bool:
    """Check if required tools are available."""
    # Check CMake
    cmake_path = shutil.which("cmake")
    if not cmake_path:
        print("ERROR: CMake not found in PATH.")
        print("  Install from: https://cmake.org/download/")
        print("  Or run: winget install Kitware.CMake")
        return False

    try:
        result = subprocess.run(
            [cmake_path, "--version"],
            capture_output=True,
            env=env
        )
        if result.returncode != 0:
            print("ERROR: CMake not found.")
            print("  Install from: https://cmake.org/download/")
            print("  Or run: winget install Kitware.CMake")
            return False
        print(f"CMake: {result.stdout.decode().splitlines()[0]}")
    except FileNotFoundError:
        print("ERROR: CMake not found in PATH.")
        print("  Install from: https://cmake.org/download/")
        print("  Or run: winget install Kitware.CMake")
        return False
    except Exception as e:
        print(f"ERROR: Failed to check CMake: {e}")
        return False

    # Check Ninja (optional but preferred)
    ninja_path = shutil.which("ninja")
    if ninja_path:
        try:
            result = subprocess.run(
                [ninja_path, "--version"],
                capture_output=True,
                env=env
            )
            if result.returncode == 0:
                print(f"Ninja: {result.stdout.decode().strip()}")
            else:
                print("Ninja: not found (will use Visual Studio generator)")
        except Exception as e:
            print(f"WARNING: Failed to check Ninja: {e}")
            print("  Will use Visual Studio generator")
    else:
        print("Ninja: not found (will use Visual Studio generator)")

    return True


def get_cached_generator(build_dir: Path) -> str | None:
    """Get the generator used in existing CMake cache."""
    cmake_cache = build_dir / "CMakeCache.txt"
    if not cmake_cache.exists():
        return None

    try:
        content = cmake_cache.read_text(encoding='utf-8', errors='replace')
        for line in content.splitlines():
            if line.startswith("CMAKE_GENERATOR:"):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None


def clear_build_cache(build_dir: Path) -> None:
    """Clear CMake cache files."""
    cache_file = build_dir / "CMakeCache.txt"
    cmake_files = build_dir / "CMakeFiles"

    if cache_file.exists():
        cache_file.unlink()
        print(f"  Removed: {cache_file}")

    if cmake_files.exists():
        shutil.rmtree(cmake_files)
        print(f"  Removed: {cmake_files}")


def find_executable(build_dir: Path, build_type: str) -> Path | None:
    """Find the built executable."""
    # Possible locations
    candidates = [
        build_dir / "PreDateGrip.exe",
        build_dir / build_type / "PreDateGrip.exe",
        build_dir / "bin" / "PreDateGrip.exe",
        build_dir / "bin" / build_type / "PreDateGrip.exe",
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    # Search recursively
    for exe in build_dir.rglob("PreDateGrip.exe"):
        return exe

    return None


def main():
    # Parse arguments
    build_type = sys.argv[1] if len(sys.argv) > 1 else "Debug"
    clean_build = "--clean" in sys.argv or "-c" in sys.argv

    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'. Use 'Debug' or 'Release'")
        sys.exit(1)

    print(f"\n{'#'*60}")
    print(f"#  Pre-DateGrip Build Script")
    print(f"#  Build Type: {build_type}")
    print(f"#  Clean Build: {clean_build}")
    print(f"{'#'*60}")

    # Get project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    build_dir = project_root / "build"

    os.chdir(project_root)
    print(f"\nProject root: {project_root}")

    # Clean build directory if requested or always clean for fresh builds
    if build_dir.exists():
        print(f"\n[0/4] Cleaning build directory...")
        shutil.rmtree(build_dir)
        print(f"  Removed: {build_dir}")

    # Setup MSVC environment
    print("\n[1/4] Setting up MSVC environment...")
    env = get_msvc_env()

    # Check tools
    print("\n[2/4] Checking build tools...")
    if not check_tools(env):
        sys.exit(1)

    # Check if Ninja is available
    ninja_path = shutil.which("ninja")
    ninja_available = False
    if ninja_path:
        try:
            ninja_available = subprocess.run(
                [ninja_path, "--version"],
                capture_output=True,
                env=env
            ).returncode == 0
        except Exception:
            ninja_available = False

    # Create build directory
    build_dir.mkdir(exist_ok=True)

    # Determine generator
    if ninja_available:
        generator = "Ninja"
        cmake_cmd = [
            "cmake", "-B", "build",
            "-G", "Ninja",
            f"-DCMAKE_BUILD_TYPE={build_type}"
        ]
    else:
        generator = "Visual Studio 17 2022"
        cmake_cmd = [
            "cmake", "-B", "build",
            "-G", "Visual Studio 17 2022",
            "-A", "x64"
        ]

    # Check for generator mismatch
    cached_generator = get_cached_generator(build_dir)
    if cached_generator and cached_generator != generator:
        print(f"\n[!] Generator mismatch detected:")
        print(f"    Cached: {cached_generator}")
        print(f"    Current: {generator}")
        print("    Clearing CMake cache...")
        clear_build_cache(build_dir)

    # Configure with CMake
    print("\n[3/4] Configuring with CMake...")
    if not run_command(cmake_cmd, "CMake Configure", env):
        print("\nERROR: CMake configuration failed!")
        sys.exit(1)

    # Build
    print("\n[4/4] Building...")
    build_cmd = [
        "cmake", "--build", "build",
        "--config", build_type,
        "--parallel"
    ]

    if not run_command(build_cmd, f"CMake Build ({build_type})", env):
        print("\nERROR: Build failed!")
        sys.exit(1)

    # Find and report output
    print(f"\n{'='*60}")
    print("  BUILD SUCCESSFUL!")
    print(f"{'='*60}")

    exe_path = find_executable(build_dir, build_type)
    if exe_path:
        print(f"\n  Executable: {exe_path}")
        print(f"  Size: {exe_path.stat().st_size / 1024 / 1024:.2f} MB")
    else:
        print("\n  WARNING: Could not find PreDateGrip.exe")
        print("  Check build directory manually:")
        print(f"    {build_dir}")

    print(f"\n  To run:")
    if exe_path:
        print(f"    {exe_path}")
    else:
        print(f"    build\\PreDateGrip.exe")

    print()


if __name__ == "__main__":
    main()
