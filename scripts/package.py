#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip Package Script

Creates a distribution package with the built executable and frontend.

Usage:
    uv run scripts/package.py
    python scripts/package.py
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
        print("ERROR: Could not find vcvars64.bat")
        print("Please install Visual Studio 2022 with C++ workload")
        sys.exit(1)

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
        print("ERROR: Failed to run vcvars64.bat")
        sys.exit(1)

    env = {}
    for line in result.stdout.splitlines():
        if '=' in line:
            key, _, value = line.partition('=')
            env[key] = value
    return env


def run_command(cmd: list[str], description: str, cwd: Path | None = None, env: dict | None = None) -> bool:
    """Run a command and return success status."""
    print(f"\n{description}")
    print(f"Command: {' '.join(cmd)}\n")

    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)

    result = subprocess.run(cmd, cwd=cwd, env=merged_env)
    return result.returncode == 0


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    frontend_dir = project_root / "frontend"
    build_dir = project_root / "build"
    dist_dir = project_root / "dist"

    os.chdir(project_root)

    print(f"\n{'#'*60}")
    print(f"#  Pre-DateGrip Packaging Script")
    print(f"{'#'*60}")

    # Get MSVC environment
    env = get_msvc_env()

    # Step 1: Build frontend
    print("\n" + "=" * 60)
    print("[1/3] Building frontend...")
    print("=" * 60)

    if not (frontend_dir / "node_modules").exists():
        print("Installing npm dependencies...")
        if not run_command(["npm", "install"], "npm install", cwd=frontend_dir):
            print("ERROR: npm install failed")
            sys.exit(1)

    if not run_command(["npm", "run", "build"], "Frontend build", cwd=frontend_dir):
        print("ERROR: Frontend build failed")
        sys.exit(1)

    # Step 2: Build backend (Release)
    print("\n" + "=" * 60)
    print("[2/3] Building backend (Release)...")
    print("=" * 60)

    # Check for Ninja
    ninja = shutil.which("ninja")
    if ninja:
        cmake_cmd = ["cmake", "-B", "build", "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release"]
    else:
        cmake_cmd = ["cmake", "-B", "build", "-G", "Visual Studio 17 2022", "-A", "x64"]

    if not run_command(cmake_cmd, "CMake configure", env=env):
        print("ERROR: CMake configuration failed")
        sys.exit(1)

    if not run_command(["cmake", "--build", "build", "--config", "Release", "--parallel"], "CMake build", env=env):
        print("ERROR: Release build failed")
        sys.exit(1)

    # Step 3: Create distribution package
    print("\n" + "=" * 60)
    print("[3/3] Creating distribution package...")
    print("=" * 60)

    # Clean dist directory
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    dist_dir.mkdir()
    (dist_dir / "frontend").mkdir()

    # Find executable
    exe_path = None
    for exe in build_dir.rglob("PreDateGrip.exe"):
        exe_path = exe
        break

    if not exe_path:
        print("ERROR: Could not find PreDateGrip.exe")
        sys.exit(1)

    # Copy executable
    shutil.copy(exe_path, dist_dir / "PreDateGrip.exe")
    print(f"Copied: {exe_path.name}")

    # Copy frontend dist
    frontend_dist = frontend_dir / "dist"
    if frontend_dist.exists():
        shutil.copytree(frontend_dist, dist_dir / "frontend", dirs_exist_ok=True)
        print("Copied: frontend/dist/*")
    else:
        print("WARNING: frontend/dist not found")

    # Summary
    print("\n" + "=" * 60)
    print("Package created successfully!")
    print("=" * 60)
    print(f"\nOutput directory: {dist_dir}")
    print("\nContents:")
    for item in dist_dir.rglob("*"):
        if item.is_file():
            rel_path = item.relative_to(dist_dir)
            size = item.stat().st_size
            if size > 1024 * 1024:
                print(f"  {rel_path} ({size / 1024 / 1024:.2f} MB)")
            elif size > 1024:
                print(f"  {rel_path} ({size / 1024:.1f} KB)")
            else:
                print(f"  {rel_path} ({size} bytes)")


if __name__ == "__main__":
    main()
