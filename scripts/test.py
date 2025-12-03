#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip Test Runner

Usage:
    uv run scripts/test.py [Debug|Release]
    python scripts/test.py [Debug|Release]
"""

import subprocess
import sys
import os
from pathlib import Path


def main():
    build_type = sys.argv[1] if len(sys.argv) > 1 else "Debug"
    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'. Use 'Debug' or 'Release'")
        sys.exit(1)

    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    build_dir = project_root / "build"

    print(f"\n{'#'*60}")
    print(f"#  Pre-DateGrip Test Runner")
    print(f"#  Build Type: {build_type}")
    print(f"{'#'*60}\n")

    if not build_dir.exists():
        print(f"ERROR: Build directory not found: {build_dir}")
        print("Run build.py first to build the project.")
        sys.exit(1)

    os.chdir(build_dir)

    print("Running CTest...\n")
    result = subprocess.run([
        "ctest", "-C", build_type, "--output-on-failure"
    ])

    if result.returncode != 0:
        print("\nERROR: Tests failed!")
        sys.exit(1)

    print("\nAll tests passed!")


if __name__ == "__main__":
    main()
