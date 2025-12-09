#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip Frontend Test Runner

Usage:
    uv run scripts/test_frontend.py
    uv run scripts/test_frontend.py --watch    # Watch mode
    python scripts/test_frontend.py
"""

import shutil
import subprocess
import sys
from pathlib import Path


def find_bun() -> str | None:
    """Find bun executable."""
    bun_path = shutil.which("bun")
    if bun_path:
        return bun_path

    # Check common installation paths
    possible_paths = [
        Path.home() / ".bun" / "bin" / "bun.exe",
        Path.home() / ".bun" / "bin" / "bun",
    ]

    for path in possible_paths:
        if path.exists():
            return str(path)

    return None


def main():
    # Parse arguments
    watch_mode = "--watch" in sys.argv or "-w" in sys.argv

    print(f"\n{'#'*60}")
    print("#  Pre-DateGrip Frontend Test Runner")
    if watch_mode:
        print("#  Mode: Watch")
    print(f"{'#'*60}\n")

    # Find bun
    bun_path = find_bun()
    if not bun_path:
        print("ERROR: Bun not found in PATH.")
        print("")
        print("Install Bun:")
        print('  powershell -c "irm bun.sh/install.ps1 | iex"')
        print("")
        print("Or add Bun to PATH:")
        print(f"  {Path.home() / '.bun' / 'bin'}")
        sys.exit(1)

    print(f"Using Bun: {bun_path}")

    # Get project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    frontend_dir = project_root / "frontend"

    if not frontend_dir.exists():
        print(f"ERROR: Frontend directory not found: {frontend_dir}")
        sys.exit(1)

    # Check if node_modules exists
    node_modules = frontend_dir / "node_modules"
    if not node_modules.exists():
        print("\nInstalling dependencies...")
        result = subprocess.run(
            [bun_path, "install", "--frozen-lockfile"],
            cwd=frontend_dir
        )
        if result.returncode != 0:
            print("\nERROR: Failed to install dependencies")
            sys.exit(1)

    # Run tests
    print("\nRunning tests...\n")

    if watch_mode:
        cmd = [bun_path, "run", "test"]
    else:
        cmd = [bun_path, "run", "test", "--run"]

    result = subprocess.run(cmd, cwd=frontend_dir)

    if result.returncode != 0:
        print("\nERROR: Tests failed!")
        sys.exit(1)

    print("\nAll tests passed!")


if __name__ == "__main__":
    main()
