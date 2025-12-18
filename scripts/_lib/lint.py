"""Lint commands for Pre-DateGrip."""

import shutil
import subprocess

from . import utils


def lint_frontend(fix: bool = False, unsafe: bool = False) -> bool:
    """Lint frontend code with Biome."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    print(f"\n{'#' * 60}")
    print("#  Linting Frontend")
    if fix:
        mode = "Auto-fix (safe + unsafe)" if unsafe else "Auto-fix (safe only)"
        print(f"#  Mode: {mode}")
    print(f"{'#' * 60}")

    # Find package manager
    pkg_info = utils.find_package_manager()
    if not pkg_info:
        print("\nERROR: No package manager found")
        return False

    pkg_manager, pkg_path = pkg_info

    # Run lint
    lint_cmd = [str(pkg_path), "run", "lint"]
    if fix:
        lint_cmd.append("--")
        lint_cmd.append("--write")
        if unsafe:
            lint_cmd.append("--unsafe")

    success, _ = utils.run_command(lint_cmd, "Biome lint", cwd=frontend_dir)

    # Run type check
    print("\n[Type checking...]")
    success2, _ = utils.run_command(
        [str(pkg_path), "run", "typecheck"], "TypeScript check", cwd=frontend_dir
    )

    if success and success2:
        print("\n[OK] Lint passed!")
        return True
    else:
        print("\n[FAIL] Lint failed")
        return False


def lint_cpp(fix: bool = False) -> bool:
    """Lint C++ code with clang-format."""
    project_root = utils.get_project_root()
    src_dir = project_root / "backend"

    print(f"\n{'#' * 60}")
    print("#  Linting C++")
    if fix:
        print("#  Mode: Auto-fix")
    print(f"{'#' * 60}")

    # Check for clang-format
    clang_format = shutil.which("clang-format")
    if not clang_format:
        print("\nERROR: clang-format not found")
        print("Install: winget install LLVM.LLVM")
        return False

    # Get version
    try:
        result = subprocess.run([clang_format, "--version"], capture_output=True, text=True)
        print(f"\n{result.stdout.strip()}")
    except Exception:
        pass

    # Find all C++ files
    cpp_files = []
    for ext in ["*.cpp", "*.h"]:
        cpp_files.extend(src_dir.rglob(ext))

    if not cpp_files:
        print("\nERROR: No C++ files found")
        return False

    print(f"\nFound {len(cpp_files)} C++ files")

    # Format files
    errors = 0
    for file in cpp_files:
        if fix:
            # Auto-fix
            result = subprocess.run(
                [clang_format, "-i", "-style=file", str(file)], capture_output=True
            )
            if result.returncode != 0:
                print(f"  [FAIL] {file.relative_to(project_root)}")
                errors += 1
            else:
                print(f"  [OK] {file.relative_to(project_root)}")
        else:
            # Check only
            result = subprocess.run(
                [clang_format, "--style=file", "--dry-run", "--Werror", str(file)],
                capture_output=True,
            )
            if result.returncode != 0:
                print(f"  [FAIL] {file.relative_to(project_root)}")
                errors += 1

    if errors > 0:
        print(f"\n[FAIL] {errors} file(s) need formatting")
        if not fix:
            print("Run with --fix to auto-format")
        return False
    else:
        print("\n[OK] All files properly formatted!")
        return True


def lint_python(fix: bool = False) -> bool:
    """Lint Python code with Ruff."""
    project_root = utils.get_project_root()
    scripts_dir = project_root / "scripts"

    print(f"\n{'#' * 60}")
    print("#  Linting Python")
    if fix:
        print("#  Mode: Auto-fix")
    print(f"{'#' * 60}")

    # Check for ruff
    ruff = shutil.which("ruff")
    if not ruff:
        print("\nERROR: ruff not found")
        print("Install: uv pip install ruff")
        return False

    # Get version
    try:
        result = subprocess.run([ruff, "--version"], capture_output=True, text=True)
        print(f"\n{result.stdout.strip()}")
    except Exception:
        pass

    # Run ruff check (linting)
    print("\n[Linting...]")
    check_cmd = [ruff, "check", str(scripts_dir)]
    if fix:
        check_cmd.append("--fix")

    result_check = subprocess.run(check_cmd, capture_output=True, text=True)
    success_check = result_check.returncode == 0

    if result_check.stdout:
        print(result_check.stdout)
    if result_check.stderr:
        print(result_check.stderr)

    # Run ruff format (formatting)
    print("\n[Formatting...]")
    if fix:
        format_cmd = [ruff, "format", str(scripts_dir)]
        result_format = subprocess.run(format_cmd, capture_output=True, text=True)
        success_format = result_format.returncode == 0

        if result_format.stdout:
            print(result_format.stdout)
        if result_format.stderr:
            print(result_format.stderr)
    else:
        # Check formatting without modifying
        format_cmd = [ruff, "format", "--check", str(scripts_dir)]
        result_format = subprocess.run(format_cmd, capture_output=True, text=True)
        success_format = result_format.returncode == 0

        if result_format.stdout:
            print(result_format.stdout)
        if result_format.stderr:
            print(result_format.stderr)

    if success_check and success_format:
        print("\n[OK] Python lint passed!")
        return True
    else:
        print("\n[FAIL] Python lint failed")
        if not fix:
            print("Run with --fix to auto-format")
        return False


def lint_all(fix: bool = False, unsafe: bool = False) -> bool:
    """Lint frontend and C++ code (product code only)."""
    print(f"\n{'=' * 60}")
    print("  Linting All (Frontend + C++)")
    print(f"{'=' * 60}")

    success1 = lint_frontend(fix=fix, unsafe=unsafe)
    success2 = lint_cpp(fix=fix)

    if success1 and success2:
        print(f"\n{'=' * 60}")
        print("  ALL LINTS PASSED")
        print(f"{'=' * 60}")
        return True
    else:
        print(f"\n{'=' * 60}")
        print("  SOME LINTS FAILED")
        print(f"{'=' * 60}")
        return False
