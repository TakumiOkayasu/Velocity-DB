#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip Lint Runner

Usage:
    uv run scripts/run_lint.py
    python scripts/run_lint.py
"""

import subprocess
import sys
import shutil
from pathlib import Path


def run_command(cmd: list[str], cwd: Path | None = None) -> bool:
    """Run a command and return success status."""
    result = subprocess.run(cmd, cwd=cwd)
    return result.returncode == 0


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    frontend_dir = project_root / "frontend"
    src_dir = project_root / "src"

    print(f"\n{'#'*60}")
    print(f"#  Pre-DateGrip Lint Runner")
    print(f"{'#'*60}\n")

    errors = 0

    # Frontend lint (Biome)
    print("=" * 60)
    print("[Frontend] Running Biome lint...")
    print("=" * 60 + "\n")

    if not (frontend_dir / "node_modules").exists():
        print("Installing npm dependencies...")
        if not run_command(["npm", "install"], cwd=frontend_dir):
            print("ERROR: npm install failed")
            sys.exit(1)

    if not run_command(["npm", "run", "lint"], cwd=frontend_dir):
        print("\n[Frontend] Lint failed")
        print("To auto-fix, run: cd frontend && npm run lint:fix")
        errors += 1
    else:
        print("\n[Frontend] Lint passed")

    # C++ format check (clang-format)
    print("\n" + "=" * 60)
    print("[C++] Running clang-format check...")
    print("=" * 60 + "\n")

    clang_format = shutil.which("clang-format")
    if not clang_format:
        print("[C++] clang-format not found, skipping C++ format check")
    else:
        cpp_files = list(src_dir.rglob("*.cpp")) + list(src_dir.rglob("*.h"))
        format_errors = []

        for cpp_file in cpp_files:
            result = subprocess.run(
                [clang_format, "--style=file", "--dry-run", "--Werror", str(cpp_file)],
                capture_output=True
            )
            if result.returncode != 0:
                format_errors.append(cpp_file)

        if format_errors:
            print("[C++] Format errors in:")
            for f in format_errors:
                print(f"  {f}")
            print("\nTo auto-fix, run:")
            print('  clang-format -i src/**/*.cpp src/**/*.h')
            errors += 1
        else:
            print("[C++] Format check passed")

    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)

    if errors == 0:
        print("\nAll lint and format checks passed!")
    else:
        print(f"\n{errors} check(s) failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
