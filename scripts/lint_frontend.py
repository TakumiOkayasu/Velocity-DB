#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip Frontend Linter

Usage:
    uv run scripts/lint_frontend.py           # Check only
    uv run scripts/lint_frontend.py --fix     # Auto-fix
    python scripts/lint_frontend.py
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
    fix_mode = "--fix" in sys.argv or "-f" in sys.argv

    print(f"\n{'#'*60}")
    print("#  Pre-DateGrip Frontend Linter")
    if fix_mode:
        print("#  Mode: Auto-fix")
    else:
        print("#  Mode: Check only")
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

    # Run lint
    print("\nRunning Biome lint...\n")

    if fix_mode:
        cmd = [bun_path, "run", "lint:fix"]
    else:
        cmd = [bun_path, "run", "lint"]

    result = subprocess.run(cmd, cwd=frontend_dir)

    if result.returncode != 0:
        if not fix_mode:
            print("\nERROR: Linting errors found!")
            print("Run with --fix to auto-fix issues:")
            print("  uv run scripts/lint_frontend.py --fix")
        else:
            print("\nERROR: Some errors could not be auto-fixed")
        sys.exit(1)

    print("\nLinting passed!")


if __name__ == "__main__":
    main()
