"""Lint commands for Velocity-DB."""

import io
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TextIO

from . import utils


def _run_subprocess(
    cmd: list[str],
    description: str,
    cwd: Path | None = None,
    out: TextIO | None = None,
) -> bool:
    """Run a subprocess. Streams live to terminal when `out` is None;
    captures and writes to `out` otherwise (parallel-safe)."""
    if out is None:
        success, _ = utils.run_command(cmd, description, cwd=cwd)
        return success

    utils.print_footer(description, file=out)
    print(f"  Command: {' '.join(cmd)}", file=out)
    if cwd:
        print(f"  Working directory: {cwd}", file=out)
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, encoding="utf-8")
    except FileNotFoundError:
        print(f"ERROR: Command not found: {cmd[0]}", file=out)
        return False
    if result.stdout:
        print(result.stdout, end="", file=out)
    if result.stderr:
        print(result.stderr, end="", file=out)
    return result.returncode == 0


def lint_frontend(fix: bool = False, unsafe: bool = False, out: TextIO | None = None) -> bool:
    """Check frontend code with Vite+."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    if fix:
        mode = "Auto-fix (safe + unsafe)" if unsafe else "Auto-fix (safe only)"
        utils.print_header("Linting Frontend", f"Mode: {mode}", file=out)
    else:
        utils.print_header("Linting Frontend", file=out)

    # Ensure dependencies (output goes to real stdout in parallel mode; rare path)
    pkg_info = utils.ensure_frontend_deps()
    if not pkg_info:
        return False

    _, pkg_path = pkg_info

    # Run format and lint checks through the package scripts.
    lint_script = "lint:fix:unsafe" if fix and unsafe else "lint:fix" if fix else "lint"
    lint_cmd = [str(pkg_path), "run", lint_script]

    success = _run_subprocess(lint_cmd, "Vite+ check", cwd=frontend_dir, out=out)

    # Run type check
    print("\n[Type checking...]", file=out)
    success2 = _run_subprocess(
        [str(pkg_path), "run", "typecheck"],
        "TypeScript check",
        cwd=frontend_dir,
        out=out,
    )

    if success and success2:
        print("\n[OK] Lint passed!", file=out)
        return True
    else:
        print("\n[FAIL] Lint failed", file=out)
        return False


def lint_cpp(fix: bool = False, out: TextIO | None = None) -> bool:
    """Lint C++ code with clang-format."""
    project_root = utils.get_project_root()
    src_dir = project_root / "backend"

    subtitles = ("Mode: Auto-fix",) if fix else ()
    utils.print_header("Linting C++", *subtitles, file=out)

    # Check for clang-format
    clang_format = shutil.which("clang-format")
    if not clang_format:
        print("\nERROR: clang-format not found", file=out)
        print("Install: winget install LLVM.LLVM", file=out)
        return False

    # Get version
    try:
        result = subprocess.run([clang_format, "--version"], capture_output=True, text=True)
        print(f"\n{result.stdout.strip()}", file=out)
    except Exception:
        pass

    # Find all C++ files
    cpp_files: list[Path] = []
    for ext in ["*.cpp", "*.h"]:
        cpp_files.extend(src_dir.rglob(ext))

    if not cpp_files:
        print("\nERROR: No C++ files found", file=out)
        return False

    print(f"\nFound {len(cpp_files)} C++ files", file=out)

    # Run clang-format on all files at once (much faster than one-by-one)
    file_args = [str(f) for f in cpp_files]
    if fix:
        cmd = [clang_format, "-i", "-style=file", "--verbose"] + file_args
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.stderr:
            print(result.stderr.strip(), file=out)
        if result.returncode != 0:
            print("\n[FAIL] clang-format failed", file=out)
            return False
        print(f"\n[OK] {len(cpp_files)} files formatted!", file=out)
        return True
    else:
        cmd = [clang_format, "--style=file", "--dry-run", "--Werror"] + file_args
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            seen: set[str] = set()
            if result.stderr:
                # Extract filenames from warnings
                for line in result.stderr.splitlines():
                    for f in cpp_files:
                        rel = str(f.relative_to(project_root))
                        if str(f) in line and rel not in seen:
                            print(f"  [FAIL] {rel}", file=out)
                            seen.add(rel)
            print(
                f"\n[FAIL] {len(seen) if result.stderr else '?'} file(s) need formatting", file=out
            )
            print("Run with --fix to auto-format", file=out)
            return False
        print(f"\n[OK] All {len(cpp_files)} files properly formatted!", file=out)
        return True


def lint_python(fix: bool = False, out: TextIO | None = None) -> bool:
    """Lint Python code with Ruff."""
    project_root = utils.get_project_root()
    scripts_dir = project_root / "scripts"

    subtitles = ("Mode: Auto-fix",) if fix else ()
    utils.print_header("Linting Python", *subtitles, file=out)

    # Check for ruff
    ruff = shutil.which("ruff")
    if not ruff:
        print("\nERROR: ruff not found", file=out)
        print("Install: uv pip install ruff", file=out)
        return False

    # Get version
    try:
        result = subprocess.run([ruff, "--version"], capture_output=True, text=True)
        print(f"\n{result.stdout.strip()}", file=out)
    except Exception:
        pass

    # Run ruff check (linting)
    print("\n[Linting...]", file=out)
    check_cmd = [ruff, "check", str(scripts_dir)]
    if fix:
        check_cmd.append("--fix")

    result_check = subprocess.run(check_cmd, capture_output=True, text=True)
    success_check = result_check.returncode == 0

    if result_check.stdout:
        print(result_check.stdout, file=out)
    if result_check.stderr:
        print(result_check.stderr, file=out)

    # Run ruff format (formatting)
    print("\n[Formatting...]", file=out)
    if fix:
        format_cmd = [ruff, "format", str(scripts_dir)]
        result_format = subprocess.run(format_cmd, capture_output=True, text=True)
        success_format = result_format.returncode == 0

        if result_format.stdout:
            print(result_format.stdout, file=out)
        if result_format.stderr:
            print(result_format.stderr, file=out)
    else:
        # Check formatting without modifying
        format_cmd = [ruff, "format", "--check", str(scripts_dir)]
        result_format = subprocess.run(format_cmd, capture_output=True, text=True)
        success_format = result_format.returncode == 0

        if result_format.stdout:
            print(result_format.stdout, file=out)
        if result_format.stderr:
            print(result_format.stderr, file=out)

    if success_check and success_format:
        print("\n[OK] Python lint passed!", file=out)
        return True
    else:
        print("\n[FAIL] Python lint failed", file=out)
        if not fix:
            print("Run with --fix to auto-format", file=out)
        return False


def _print_labeled(label: str, content: str) -> None:
    """Print captured output with a section label."""
    bar = "=" * 60
    print(f"\n{bar}\n  [{label}]\n{bar}")
    sys.stdout.write(content)
    if not content.endswith("\n"):
        print()


def lint_all(fix: bool = False, unsafe: bool = False, parallel: bool = True) -> bool:
    """Lint frontend and C++ code (product code only).

    Runs frontend and C++ lint in parallel by default. Pass parallel=False
    for sequential execution (legacy behavior).
    """
    utils.print_footer("Linting All (Frontend + C++)")

    if not parallel:
        success1 = lint_frontend(fix=fix, unsafe=unsafe)
        success2 = lint_cpp(fix=fix)
        utils.print_footer("ALL LINTS PASSED" if (success1 and success2) else "SOME LINTS FAILED")
        return success1 and success2

    print("\n[Running frontend + C++ lint in parallel...]")
    buf_front = io.StringIO()
    buf_cpp = io.StringIO()
    with ThreadPoolExecutor(max_workers=2) as executor:
        fut_front = executor.submit(lint_frontend, fix=fix, unsafe=unsafe, out=buf_front)
        fut_cpp = executor.submit(lint_cpp, fix=fix, out=buf_cpp)
        success1 = fut_front.result()
        success2 = fut_cpp.result()

    _print_labeled("FRONTEND", buf_front.getvalue())
    _print_labeled("CPP", buf_cpp.getvalue())

    utils.print_footer("ALL LINTS PASSED" if (success1 and success2) else "SOME LINTS FAILED")
    return success1 and success2
