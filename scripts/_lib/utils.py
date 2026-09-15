"""Common utility functions for Velocity-DB build system."""

import os
import shutil
import subprocess
from pathlib import Path
from typing import TextIO

PackageManager = tuple[str, Path]

_BANNER_WIDTH = 60


def print_header(title: str, *subtitles: str, file: TextIO | None = None) -> None:
    """Print a section header (e.g. '#  Building Backend (Debug)')."""
    print(f"\n{'#' * _BANNER_WIDTH}", file=file)
    print(f"#  {title}", file=file)
    for s in subtitles:
        print(f"#  {s}", file=file)
    print(f"{'#' * _BANNER_WIDTH}", file=file)


def print_footer(message: str, *, file: TextIO | None = None) -> None:
    """Print a footer banner (e.g. 'BUILD SUCCESSFUL')."""
    print(f"\n{'=' * _BANNER_WIDTH}", file=file)
    print(f"  {message}", file=file)
    print(f"{'=' * _BANNER_WIDTH}", file=file)


def get_project_root() -> Path:
    """Get the project root directory (resolves symlinks)."""
    script_dir = Path(__file__).resolve().parent.parent
    return script_dir.parent


def run_command(
    cmd: list[str],
    description: str,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
    out: TextIO | None = None,
) -> tuple[bool, str]:
    """Run a command and return success status and output.

    When `out` is given, subprocess output is captured and written to `out`
    (parallel-safe mode). When `out` is None and `capture_output` is False,
    subprocess streams live to terminal.
    """
    extras = [f"Command: {' '.join(cmd)}"]
    if cwd:
        extras.append(f"Working directory: {cwd}")
    print_footer(description, file=out)
    for e in extras:
        print(f"  {e}", file=out)

    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)

    # Force capture when `out` is set so subprocess output goes to `out`
    do_capture = capture_output or out is not None

    try:
        if do_capture:
            result = subprocess.run(
                cmd, cwd=cwd, env=merged_env, capture_output=True, encoding="utf-8"
            )
            if out is not None:
                if result.stdout:
                    print(result.stdout, end="", file=out)
                if result.stderr:
                    print(result.stderr, end="", file=out)
            return result.returncode == 0, result.stderr or ""
        else:
            result = subprocess.run(cmd, cwd=cwd, env=merged_env)
            return result.returncode == 0, ""
    except FileNotFoundError:
        print(f"ERROR: Command not found: {cmd[0]}", file=out)
        return False, f"Command not found: {cmd[0]}"
    except Exception as e:
        print(f"ERROR: Failed to execute command: {e}", file=out)
        return False, str(e)


def find_package_manager() -> PackageManager | None:
    """Find Bun package manager."""
    bun_path = shutil.which("bun")
    if bun_path:
        try:
            result = subprocess.run([bun_path, "--version"], capture_output=True, text=True)
            if result.returncode == 0:
                return ("bun", Path(bun_path))
        except Exception:
            pass

    return None


def check_build_tools(env: dict[str, str], out: TextIO | None = None) -> bool:
    """Check if required build tools are available."""
    # Check CMake
    try:
        result = subprocess.run(["cmake", "--version"], capture_output=True, text=True, env=env)
        if result.returncode == 0:
            version = result.stdout.split("\n")[0]
            print(f"CMake: {version}", file=out)
        else:
            print("ERROR: CMake not found", file=out)
            return False
    except FileNotFoundError:
        print("ERROR: CMake not found", file=out)
        return False

    # Check Ninja
    try:
        result = subprocess.run(["ninja", "--version"], capture_output=True, text=True, env=env)
        if result.returncode == 0:
            version = result.stdout.strip()
            print(f"Ninja: {version}", file=out)
        else:
            print("WARNING: Ninja not found, will use slower generator", file=out)
    except FileNotFoundError:
        print("WARNING: Ninja not found, will use slower generator", file=out)

    return True


def ensure_frontend_deps(out: TextIO | None = None) -> PackageManager | None:
    """Ensure frontend dependencies are up-to-date. Returns PackageManager on success."""
    project_root = get_project_root()
    frontend_dir = project_root / "frontend"
    node_modules = frontend_dir / "node_modules"
    package_json = frontend_dir / "package.json"

    pkg_info = find_package_manager()
    if not pkg_info:
        print("\nERROR: No package manager found", file=out)
        print("  Install bun: https://bun.sh", file=out)
        return None

    pkg_manager, pkg_path = pkg_info

    needs_install = not node_modules.exists()
    if not needs_install and package_json.exists():
        pkg_mtime = package_json.stat().st_mtime
        nm_mtime = node_modules.stat().st_mtime
        if pkg_mtime > nm_mtime:
            print("[package.json updated since last install, reinstalling...]", file=out)
            needs_install = True

    if needs_install:
        print("\n[Dependencies outdated, installing...]", file=out)
        success, _ = run_command(
            [str(pkg_path), "install"], f"{pkg_manager} install", cwd=frontend_dir, out=out
        )
        if not success:
            print("\nERROR: Failed to install dependencies", file=out)
            return None
    return pkg_info


def clear_webview2_cache(project_root: Path, out: TextIO | None = None) -> None:
    """Clear WebView2 cache to ensure fresh frontend load."""
    print("\n[Post-Build] Clearing WebView2 cache...", file=out)
    webview2_caches = [
        project_root / "build" / "Debug" / "VelocityDB.exe.WebView2",
        project_root / "build" / "Release" / "VelocityDB.exe.WebView2",
    ]

    cleared = False
    for cache_path in webview2_caches:
        if cache_path.exists():
            try:
                shutil.rmtree(cache_path)
                print(f"  [OK] Cleared: {cache_path.relative_to(project_root)}", file=out)
                cleared = True
            except Exception as e:
                print(f"  [FAIL] Failed to clear {cache_path}: {e}", file=out)

    if cleared:
        print("  WebView2 will load fresh frontend files on next startup", file=out)
    else:
        print("  No WebView2 cache to clear", file=out)
