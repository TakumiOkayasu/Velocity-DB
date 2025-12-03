#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Pre-DateGrip Full Project Check Script

Usage:
    uv run scripts/check_all.py [Debug|Release]
    python scripts/check_all.py [Debug|Release]

Steps:
    1. EOL normalization (LF for frontend, CRLF for C++)
    2. C++ checks (clang-format, clang-tidy, build)
    3. Frontend checks (Biome lint, TypeScript, build)
"""

import subprocess
import sys
import os
import shutil
from pathlib import Path


def run_command(cmd: list[str], description: str, cwd: Path | None = None) -> bool:
    """Run a command and return success status."""
    print(f"\n{description}")
    print(f"Command: {' '.join(cmd)}\n")
    result = subprocess.run(cmd, cwd=cwd)
    return result.returncode == 0


def main():
    build_type = sys.argv[1] if len(sys.argv) > 1 else "Release"
    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'. Use 'Debug' or 'Release'")
        sys.exit(1)

    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    frontend_dir = project_root / "frontend"

    os.chdir(project_root)

    print(f"\n{'*'*60}")
    print(f"*  Pre-DateGrip - Full Project Check")
    print(f"*  Build Type: {build_type}")
    print(f"{'*'*60}")

    total_errors = 0

    # Step 1: EOL Normalization
    print("\n" + "#" * 60)
    print("# Step 1: EOL Normalization")
    print("#" * 60)

    convert_eol_script = script_dir / "convert_eol.py"
    if convert_eol_script.exists():
        # LF for frontend (Biome expects LF)
        if not run_command(
            [sys.executable, str(convert_eol_script), "lf", "frontend/src"],
            "Converting frontend to LF..."
        ):
            print("WARNING: Frontend EOL conversion had issues")

        # CRLF for C++ (MSVC prefers CRLF)
        if not run_command(
            [sys.executable, str(convert_eol_script), "crlf", "src"],
            "Converting C++ to CRLF..."
        ):
            print("WARNING: C++ EOL conversion had issues")
    else:
        print("WARNING: convert_eol.py not found, skipping EOL normalization")

    # Step 2: C++ Check
    print("\n" + "#" * 60)
    print("# Step 2: C++ Backend")
    print("#" * 60)

    cpp_check_script = script_dir / "cpp_check.py"
    if cpp_check_script.exists():
        if not run_command(
            [sys.executable, str(cpp_check_script), "all", build_type],
            "Running C++ checks..."
        ):
            total_errors += 1
            print("[FAILED] C++ check failed")
        else:
            print("[PASSED] C++ check passed")
    else:
        print("WARNING: cpp_check.py not found")

    # Step 3: Frontend Check
    print("\n" + "#" * 60)
    print("# Step 3: Frontend (React/TypeScript)")
    print("#" * 60)

    # Check for Biome in PATH
    biome = shutil.which("biome")
    if not biome:
        print("ERROR: biome not found in PATH")
        print("  Install: npm install -g @biomejs/biome")
        print("  Or: winget install biomejs.biome")
        total_errors += 1
    else:
        # Show version
        subprocess.run([biome, "--version"], shell=True)

        # Biome lint
        print("\n[Frontend] Running Biome lint...")
        if not run_command([biome, "check", str(frontend_dir / "src")], "Biome lint", cwd=frontend_dir):
            print("WARNING: Biome lint found issues")
            total_errors += 1
        else:
            print("Biome lint passed.")

    # TypeScript type check (requires node_modules for tsc)
    print("\n[Frontend] Running TypeScript type check...")
    tsc = frontend_dir / "node_modules" / ".bin" / "tsc"
    if not tsc.exists():
        # Fallback: try npx or npm run
        if not run_command(["npm", "run", "typecheck"], "TypeScript", cwd=frontend_dir):
            print("WARNING: TypeScript type check found issues")
            total_errors += 1
        else:
            print("TypeScript type check passed.")
    else:
        if not run_command([str(tsc), "--noEmit"], "TypeScript", cwd=frontend_dir):
            print("WARNING: TypeScript type check found issues")
            total_errors += 1
        else:
            print("TypeScript type check passed.")

    # Build (requires node_modules for vite)
    print("\n[Frontend] Building frontend...")
    vite = frontend_dir / "node_modules" / ".bin" / "vite"
    if not vite.exists():
        if not run_command(["npm", "run", "build"], "Frontend build", cwd=frontend_dir):
            print("ERROR: Frontend build failed")
            total_errors += 1
        else:
            print("Frontend build completed.")
    else:
        # tsc && vite build
        if not run_command([str(tsc)], "TypeScript compile", cwd=frontend_dir):
            print("ERROR: TypeScript compile failed")
            total_errors += 1
        elif not run_command([str(vite), "build"], "Vite build", cwd=frontend_dir):
            print("ERROR: Vite build failed")
            total_errors += 1
        else:
            print("Frontend build completed.")

    # Summary
    print("\n" + "*" * 60)
    print("*  Summary")
    print("*" * 60)

    if total_errors == 0:
        print("\n  All checks passed!")
        sys.exit(0)
    else:
        print(f"\n  {total_errors} check(s) failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
