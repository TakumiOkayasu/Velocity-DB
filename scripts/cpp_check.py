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

    cmd = f'cmd /c ""{vcvars}" && set"'
    result = subprocess.run(cmd, capture_output=True, text=True, shell=True)

    if result.returncode != 0:
        return os.environ.copy()

    env = {}
    for line in result.stdout.splitlines():
        if '=' in line:
            key, _, value = line.partition('=')
            env[key] = value
    return env


def run_format(src_dir: Path) -> int:
    """Run clang-format on C++ files."""
    print("\n" + "=" * 60)
    print("[2/4] Running clang-format...")
    print("=" * 60 + "\n")

    clang_format = shutil.which("clang-format")
    if not clang_format:
        print("ERROR: clang-format not found in PATH")
        print("Install LLVM: winget install LLVM.LLVM")
        return 1

    # Show version
    subprocess.run([clang_format, "--version"])
    print()

    cpp_files = list(src_dir.rglob("*.cpp")) + list(src_dir.rglob("*.h"))
    print(f"Formatting {len(cpp_files)} C++ files...")

    for cpp_file in cpp_files:
        result = subprocess.run([clang_format, "-i", "--style=file", str(cpp_file)])
        if result.returncode != 0:
            print(f"ERROR: Failed to format {cpp_file}")
            return 1

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
        print("Install LLVM: winget install LLVM.LLVM")
        return 1

    # Check for compile_commands.json
    tidy_build_dir = src_dir.parent / "build-tidy"
    compile_commands = tidy_build_dir / "compile_commands.json"

    if not compile_commands.exists():
        print("Generating compile_commands.json...")

        ninja = shutil.which("ninja")
        if not ninja:
            print("WARNING: Ninja not found. Skipping clang-tidy.")
            return 0

        tidy_build_dir.mkdir(exist_ok=True)
        result = subprocess.run([
            "cmake", "-B", str(tidy_build_dir),
            "-G", "Ninja",
            "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
            f"-DCMAKE_BUILD_TYPE={build_type}"
        ], env=env)

        if not compile_commands.exists():
            print("WARNING: Could not generate compile_commands.json")
            return 0

    print("Running clang-tidy on source files...")
    cpp_files = list(src_dir.rglob("*.cpp"))
    warnings = 0

    for cpp_file in cpp_files:
        print(f"Checking: {cpp_file.name}")
        result = subprocess.run(
            [clang_tidy, str(cpp_file), "-p", str(tidy_build_dir), "--quiet"],
            capture_output=True, text=True
        )
        if "warning:" in result.stdout or "error:" in result.stderr:
            warnings += 1

    if warnings > 0:
        print(f"\nNOTE: clang-tidy found potential issues in {warnings} file(s)")
    else:
        print("\nclang-tidy completed with no issues.")

    return 0


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

    print(f"\nRunning: {' '.join(cmake_cmd)}\n")
    result = subprocess.run(cmake_cmd, env=env)
    if result.returncode != 0:
        print("ERROR: CMake configuration failed")
        return 1

    # Build
    build_cmd = [
        "cmake", "--build", str(build_dir),
        "--config", build_type,
        "--parallel"
    ]
    print(f"\nRunning: {' '.join(build_cmd)}\n")
    result = subprocess.run(build_cmd, env=env)
    if result.returncode != 0:
        print("ERROR: Build failed")
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
