"""Lint commands for Velocity-DB."""

import shutil
import subprocess

from . import utils


def lint_frontend(fix: bool = False, unsafe: bool = False) -> bool:
    """Lint frontend code with Biome."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    if fix:
        mode = "Auto-fix (safe + unsafe)" if unsafe else "Auto-fix (safe only)"
        utils.print_header("Linting Frontend", f"Mode: {mode}")
    else:
        utils.print_header("Linting Frontend")

    # Ensure dependencies
    pkg_info = utils.ensure_frontend_deps()
    if not pkg_info:
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

    subtitles = ("Mode: Auto-fix",) if fix else ()
    utils.print_header("Linting C++", *subtitles)

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

    # Run clang-format on all files at once (much faster than one-by-one)
    file_args = [str(f) for f in cpp_files]
    if fix:
        cmd = [clang_format, "-i", "-style=file", "--verbose"] + file_args
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.stderr:
            print(result.stderr.strip())
        if result.returncode != 0:
            print("\n[FAIL] clang-format failed")
            return False
        print(f"\n[OK] {len(cpp_files)} files formatted!")
        return True
    else:
        cmd = [clang_format, "--style=file", "--dry-run", "--Werror"] + file_args
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            if result.stderr:
                # Extract filenames from warnings
                seen: set[str] = set()
                for line in result.stderr.splitlines():
                    for f in cpp_files:
                        rel = str(f.relative_to(project_root))
                        if str(f) in line and rel not in seen:
                            print(f"  [FAIL] {rel}")
                            seen.add(rel)
            print(f"\n[FAIL] {len(seen) if result.stderr else '?'} file(s) need formatting")
            print("Run with --fix to auto-format")
            return False
        print(f"\n[OK] All {len(cpp_files)} files properly formatted!")
        return True


def lint_python(fix: bool = False) -> bool:
    """Lint Python code with Ruff."""
    project_root = utils.get_project_root()
    scripts_dir = project_root / "scripts"

    subtitles = ("Mode: Auto-fix",) if fix else ()
    utils.print_header("Linting Python", *subtitles)

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
    utils.print_footer("Linting All (Frontend + C++)")

    success1 = lint_frontend(fix=fix, unsafe=unsafe)
    success2 = lint_cpp(fix=fix)

    utils.print_footer("ALL LINTS PASSED" if (success1 and success2) else "SOME LINTS FAILED")
    return success1 and success2
