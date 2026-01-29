"""Common utility functions for Velocity-DB build system."""

import os
import shutil
import subprocess
import sys
from pathlib import Path


def get_project_root() -> Path:
    """Get the project root directory (resolves symlinks)."""
    script_dir = Path(__file__).resolve().parent.parent
    return script_dir.parent


def run_command(
    cmd: list[str],
    description: str,
    cwd: Path | None = None,
    env: dict | None = None,
    capture_output: bool = False,
) -> tuple[bool, str]:
    """Run a command and return success status and output."""
    print(f"\n{'=' * 60}")
    print(f"  {description}")
    print(f"  Command: {' '.join(cmd)}")
    if cwd:
        print(f"  Working directory: {cwd}")
    print(f"{'=' * 60}\n")

    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)

    try:
        if capture_output:
            result = subprocess.run(cmd, cwd=cwd, env=merged_env, capture_output=True, text=True)
            return result.returncode == 0, result.stderr
        else:
            result = subprocess.run(cmd, cwd=cwd, env=merged_env)
            return result.returncode == 0, ""
    except FileNotFoundError:
        print(f"ERROR: Command not found: {cmd[0]}")
        return False, f"Command not found: {cmd[0]}"
    except Exception as e:
        print(f"ERROR: Failed to execute command: {e}")
        return False, str(e)


def find_package_manager() -> tuple[str, Path] | None:
    """Find available package manager (Bun or npm)."""
    # Try Bun first (preferred)
    bun_path = shutil.which("bun")
    if bun_path:
        try:
            result = subprocess.run([bun_path, "--version"], capture_output=True, text=True)
            if result.returncode == 0:
                return ("bun", Path(bun_path))
        except Exception:
            pass

    # Try npm as fallback
    npm_path = shutil.which("npm")
    if npm_path:
        try:
            result = subprocess.run([npm_path, "--version"], capture_output=True, text=True)
            if result.returncode == 0:
                return ("npm", Path(npm_path))
        except Exception:
            pass

    return None


def find_vcvars() -> Path | None:
    """Find vcvars64.bat for MSVC environment setup."""
    possible_paths = [
        # VS 2022 (version 17)
        Path(
            r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
        ),
        Path(
            r"C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
        ),
        Path(
            r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
        ),
        Path(
            r"D:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
        ),
        Path(
            r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
        ),
        # VS Preview / newer versions (version 18+)
        Path(
            r"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
        ),
        Path(
            r"C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat"
        ),
        Path(
            r"C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
        ),
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

    print(f"Using MSVC from: {vcvars}")

    # Run vcvars64.bat and capture environment
    # Security: Using shell=True here is intentional and safe because:
    # 1. vcvars path comes from find_vcvars() which only returns hardcoded system paths
    # 2. No user input is involved in command construction
    cmd = f'"{vcvars}" && set'
    result = subprocess.run(  # nosemgrep: python.lang.security.audit.subprocess-shell-true
        cmd,
        capture_output=True,
        text=True,
        shell=True,  # Safe: vcvars path from find_vcvars() - hardcoded paths only
    )

    if result.returncode != 0:
        print("ERROR: Failed to run vcvars64.bat")
        sys.exit(1)

    env = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, _, value = line.partition("=")
            env[key] = value
    return env


def check_build_tools(env: dict) -> bool:
    """Check if required build tools are available."""
    # Check CMake
    try:
        result = subprocess.run(["cmake", "--version"], capture_output=True, text=True, env=env)
        if result.returncode == 0:
            version = result.stdout.split("\n")[0]
            print(f"CMake: {version}")
        else:
            print("ERROR: CMake not found")
            return False
    except FileNotFoundError:
        print("ERROR: CMake not found")
        return False

    # Check Ninja
    try:
        result = subprocess.run(["ninja", "--version"], capture_output=True, text=True, env=env)
        if result.returncode == 0:
            version = result.stdout.strip()
            print(f"Ninja: {version}")
        else:
            print("WARNING: Ninja not found, will use slower generator")
    except FileNotFoundError:
        print("WARNING: Ninja not found, will use slower generator")

    return True


def clear_webview2_cache(project_root: Path) -> None:
    """Clear WebView2 cache to ensure fresh frontend load."""
    print("\n[Post-Build] Clearing WebView2 cache...")
    webview2_caches = [
        project_root / "build" / "Debug" / "VelocityDB.exe.WebView2",
        project_root / "build" / "Release" / "VelocityDB.exe.WebView2",
    ]

    cleared = False
    for cache_path in webview2_caches:
        if cache_path.exists():
            try:
                shutil.rmtree(cache_path)
                print(f"  [OK] Cleared: {cache_path.relative_to(project_root)}")
                cleared = True
            except Exception as e:
                print(f"  [FAIL] Failed to clear {cache_path}: {e}")

    if cleared:
        print("  WebView2 will load fresh frontend files on next startup")
    else:
        print("  No WebView2 cache to clear")
