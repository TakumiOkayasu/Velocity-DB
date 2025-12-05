#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip C++ Check Script

Usage:
    uv run scripts/cpp_check.py [format|lint|build|all] [Debug|Release]
    python scripts/cpp_check.py [format|lint|build|all] [Debug|Release]
"""

import subprocess
import sys
import os
import shutil
from pathlib import Path


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
        return os.environ.copy()

    # Run vcvars64.bat and capture environment
    # Security: Using shell=True here is intentional and safe because:
    # 1. vcvars path comes from find_vcvars() which only returns hardcoded system paths
    # 2. No user input is involved in command construction
    cmd = f'"{vcvars}" && set'
    # nosemgrep: python.lang.security.audit.subprocess-shell-true
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        shell=True  # Safe: vcvars path from find_vcvars() - hardcoded paths only
    )

    if result.returncode != 0:
        return os.environ.copy()

    env = {}
    for line in result.stdout.splitlines():
        if '=' in line:
            key, _, value = line.partition('=')
            env[key] = value
    return env


def normalize_line_endings(file_path: Path, to_lf: bool = True) -> None:
    """Normalize line endings in a file.

    Args:
        file_path: Path to the file
        to_lf: If True, convert to LF. If False, convert to CRLF.
    """
    try:
        content = file_path.read_bytes()
        # Remove BOM if present
        if content.startswith(b'\xef\xbb\xbf'):
            content = content[3:]

        if to_lf:
            content = content.replace(b'\r\n', b'\n')
        else:
            # First normalize to LF, then convert to CRLF
            content = content.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')

        file_path.write_bytes(content)
    except Exception as e:
        print(f"WARNING: Failed to normalize {file_path}: {e}")


def run_format(src_dir: Path) -> int:
    """Run clang-format on C++ files."""
    print("\n" + "=" * 60)
    print("[2/4] Running clang-format...")
    print("=" * 60 + "\n")

    clang_format = shutil.which("clang-format")
    if not clang_format:
        # Try common LLVM installation paths on Windows
        llvm_paths = [
            Path(r"C:\Program Files\LLVM\bin\clang-format.exe"),
            Path(r"C:\Program Files (x86)\LLVM\bin\clang-format.exe"),
        ]
        for path in llvm_paths:
            if path.exists():
                clang_format = str(path)
                break
        else:
            print("ERROR: clang-format not found in PATH")
            print("  Install LLVM: winget install LLVM.LLVM")
            return 1

    # Show version
    try:
        subprocess.run([clang_format, "--version"])
    except Exception as e:
        print(f"ERROR: Failed to run clang-format: {e}")
        return 1
    print()

    cpp_files = list(src_dir.rglob("*.cpp")) + list(src_dir.rglob("*.h"))
    print(f"Formatting {len(cpp_files)} C++ files...")

    # Normalize to LF before formatting (matches CI environment)
    print("Normalizing line endings to LF...")
    for cpp_file in cpp_files:
        normalize_line_endings(cpp_file, to_lf=True)

    for cpp_file in cpp_files:
        try:
            result = subprocess.run([clang_format, "-i", "--style=file", str(cpp_file)])
            if result.returncode != 0:
                print(f"ERROR: Failed to format {cpp_file}")
                return 1
        except Exception as e:
            print(f"ERROR: Failed to format {cpp_file}: {e}")
            return 1

    # Convert back to CRLF for Windows
    print("Restoring line endings to CRLF...")
    for cpp_file in cpp_files:
        normalize_line_endings(cpp_file, to_lf=False)

    print("clang-format completed.")
    return 0


def run_lint(src_dir: Path, build_type: str, env: dict) -> int:
    """Run clang-tidy on C++ files."""
    print("\n" + "=" * 60)
    print("[3/4] Running clang-tidy...")
    print("=" * 60 + "\n")

    clang_tidy = shutil.which("clang-tidy")
    if not clang_tidy:
        print("ERROR: clang-tidy not found in PATH")
        print("  Install LLVM: winget install LLVM.LLVM")
        return 1

    # Check for compile_commands.json
    tidy_build_dir = src_dir.parent / "build-tidy"
    compile_commands = tidy_build_dir / "compile_commands.json"

    if not compile_commands.exists():
        print("Generating compile_commands.json...")

        ninja = shutil.which("ninja")
        if not ninja:
            print("WARNING: Ninja not found. Skipping clang-tidy.")
            print("  Install Ninja: winget install Ninja-build.Ninja")
            return 0

        tidy_build_dir.mkdir(exist_ok=True)
        cmake_path = shutil.which("cmake")
        if not cmake_path:
            print("WARNING: CMake not found in PATH. Skipping clang-tidy.")
            return 0
        try:
            result = subprocess.run([
                cmake_path, "-B", str(tidy_build_dir),
                "-G", "Ninja",
                "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
                f"-DCMAKE_BUILD_TYPE={build_type}"
            ], env=env)
        except Exception as e:
            print(f"WARNING: Failed to run CMake for clang-tidy: {e}")
            return 0

        if not compile_commands.exists():
            print("WARNING: Could not generate compile_commands.json")
            return 0

    print("Running clang-tidy on source files...")
    cpp_files = list(src_dir.rglob("*.cpp"))
    warnings = 0

    for cpp_file in cpp_files:
        print(f"Checking: {cpp_file.name}")
        try:
            result = subprocess.run(
                [clang_tidy, str(cpp_file), "-p", str(tidy_build_dir), "--quiet"],
                capture_output=True, text=True
            )
            if "warning:" in result.stdout or "error:" in result.stderr:
                warnings += 1
        except Exception as e:
            print(f"WARNING: Failed to run clang-tidy on {cpp_file.name}: {e}")

    if warnings > 0:
        print(f"\nNOTE: clang-tidy found potential issues in {warnings} file(s)")
    else:
        print("\nclang-tidy completed with no issues.")

    return 0


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


def run_build(project_root: Path, build_type: str, env: dict) -> int:
    """Build the C++ project."""
    print("\n" + "=" * 60)
    print(f"[4/4] Building C++ project ({build_type})...")
    print("=" * 60 + "\n")

    build_dir = project_root / "build"
    build_dir.mkdir(exist_ok=True)

    # Check for Ninja
    ninja = shutil.which("ninja")
    if ninja:
        generator = "Ninja"
        print("Using generator: Ninja")
    else:
        generator = "Visual Studio 17 2022"
        print("Using generator: Visual Studio 17 2022")

    # Check for generator mismatch
    cached_generator = get_cached_generator(build_dir)
    if cached_generator and cached_generator != generator:
        print(f"\n[!] Generator mismatch detected:")
        print(f"    Cached: {cached_generator}")
        print(f"    Current: {generator}")
        print("    Clearing CMake cache...")
        clear_build_cache(build_dir)

    # Configure
    if ninja:
        cmake_cmd = [
            "cmake", "-B", str(build_dir),
            "-G", generator,
            f"-DCMAKE_BUILD_TYPE={build_type}"
        ]
    else:
        cmake_cmd = [
            "cmake", "-B", str(build_dir),
            "-G", generator,
            "-A", "x64"
        ]

    cmake_path = shutil.which("cmake")
    if not cmake_path:
        print("ERROR: CMake not found in PATH")
        print("  Install CMake: winget install Kitware.CMake")
        return 1

    cmake_cmd[0] = cmake_path  # Replace "cmake" with full path
    print(f"\nRunning: {' '.join(cmake_cmd)}\n")
    try:
        result = subprocess.run(cmake_cmd, env=env)
        if result.returncode != 0:
            print("ERROR: CMake configuration failed")
            print(f"  Exit code: {result.returncode}")
            return 1
    except FileNotFoundError:
        print("ERROR: CMake not found in PATH")
        print("  Install CMake: winget install Kitware.CMake")
        return 1
    except Exception as e:
        print(f"ERROR: CMake configuration failed: {e}")
        return 1

    # Build
    build_cmd = [
        cmake_path, "--build", str(build_dir),
        "--config", build_type,
        "--parallel"
    ]
    print(f"\nRunning: {' '.join(build_cmd)}\n")
    try:
        result = subprocess.run(build_cmd, env=env)
        if result.returncode != 0:
            print("ERROR: Build failed")
            print(f"  Exit code: {result.returncode}")
            return 1
    except Exception as e:
        print(f"ERROR: Build failed: {e}")
        return 1

    print("\nBuild completed successfully!")

    # Find and report executable
    for exe in build_dir.rglob("PreDateGrip.exe"):
        print(f"\nExecutable: {exe}")
        print(f"Size: {exe.stat().st_size / 1024 / 1024:.2f} MB")
        break

    return 0


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "all"
    build_type = sys.argv[2] if len(sys.argv) > 2 else "Release"

    if action not in ("format", "lint", "build", "all"):
        print(f"ERROR: Invalid action '{action}'. Use 'format', 'lint', 'build', or 'all'")
        sys.exit(1)

    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'. Use 'Debug' or 'Release'")
        sys.exit(1)

    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    src_dir = project_root / "src"

    os.chdir(project_root)

    print(f"\n{'#'*60}")
    print(f"#  Pre-DateGrip C++ Check")
    print(f"#  Action: {action}")
    print(f"#  Build Type: {build_type}")
    print(f"{'#'*60}")

    # Get MSVC environment
    env = get_msvc_env()
    error_count = 0

    # Run actions
    if action in ("format", "all"):
        if run_format(src_dir) != 0:
            error_count += 1

    if action in ("lint", "all"):
        if run_lint(src_dir, build_type, env) != 0:
            error_count += 1

    if action in ("build", "all"):
        if run_build(project_root, build_type, env) != 0:
            error_count += 1

    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)

    if error_count == 0:
        print("\nAll checks passed!")
    else:
        print(f"\n{error_count} error(s) found.")
        sys.exit(1)


if __name__ == "__main__":
    main()
