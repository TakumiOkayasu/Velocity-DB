"""Test commands for Velocity-DB."""

import io
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import TextIO

from . import utils
from .build import _prioritize_python_build_tools
from .environment import BuildEnvironment


def test_frontend(watch: bool = False, out: TextIO | None = None) -> bool:
    """Run frontend tests."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    subtitles = ("Mode: Watch",) if watch else ()
    utils.print_header("Running Frontend Tests", *subtitles, file=out)

    pkg_info = utils.ensure_frontend_deps(out=out)
    if not pkg_info:
        return False

    pkg_manager, pkg_path = pkg_info
    print(f"\nUsing {pkg_manager}: {pkg_path}", file=out)

    test_cmd = [str(pkg_path), "run", "test"]
    if watch:
        test_cmd.append("--watch")
    else:
        test_cmd.append("--run")

    success, _ = utils.run_command(test_cmd, f"{pkg_manager} run test", cwd=frontend_dir, out=out)

    if success:
        print("\n[OK] All tests passed!", file=out)
    else:
        print("\n[FAIL] Tests failed", file=out)

    return success


def test_e2e(out: TextIO | None = None) -> bool:
    """Run E2E tests with Playwright."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    utils.print_header("Running E2E Tests (Playwright)", file=out)

    pkg_info = utils.ensure_frontend_deps(out=out)
    if not pkg_info:
        return False

    pkg_manager, pkg_path = pkg_info
    print(f"\nUsing {pkg_manager}: {pkg_path}", file=out)

    success, _ = utils.run_command(
        [str(pkg_path), "run", "test:e2e"],
        f"{pkg_manager} run test:e2e",
        cwd=frontend_dir,
        out=out,
    )

    if success:
        print("\n[OK] All E2E tests passed!", file=out)
    else:
        print("\n[FAIL] E2E tests failed", file=out)

    return success


def _run_ctest_preset(
    build_type: str,
    label_args: list[str],
    *,
    environment: BuildEnvironment,
    header: str,
    cmd_label: str,
    ok_msg: str,
    fail_msg: str,
    repeat_csv: bool = False,
    out: TextIO | None = None,
) -> bool:
    """Run ctest under a CMake preset with the given label filter."""
    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'", file=out)
        return False

    project_root = utils.get_project_root()
    build_dir = project_root / "build"

    utils.print_header(f"{header} ({build_type})", file=out)

    if not build_dir.exists():
        print("\nERROR: Build directory not found", file=out)
        print("Run 'uv run scripts/pdg.py build backend' first", file=out)
        return False

    env = environment.activate(out=out)
    _prioritize_python_build_tools(env)
    preset = build_type.lower()
    test_cmd = ["ctest", "--preset", preset, "--output-on-failure", *label_args, "--no-tests=error"]

    success, _ = utils.run_command(test_cmd, cmd_label, env=env, cwd=project_root, out=out)

    print(f"\n[{'OK' if success else 'FAIL'}] {ok_msg if success else fail_msg}", file=out)
    if not success or not repeat_csv:
        return success

    # Match the CI stress run locally: concurrency previously exposed intermittent
    # CSV exporter failures that a single invocation of the suite could miss.
    print("\n[Repeating parallel CSV exporter tests...]", file=out)
    repeat_cmd = [
        "ctest",
        "--preset",
        preset,
        "--output-on-failure",
        "-R",
        r"^CSVExporterTest\.",
        "--parallel",
        "5",
        "--repeat",
        "until-fail:20",
        "--no-tests=error",
    ]
    success, _ = utils.run_command(
        repeat_cmd, "CTest (CSV exporter repeat)", env=env, cwd=project_root, out=out
    )
    print(f"\n[{'OK' if success else 'FAIL'}] CSV exporter repeat", file=out)
    return success


def test_backend(
    build_type: str = "Release", out: TextIO | None = None, *, environment: BuildEnvironment
) -> bool:
    """Run backend unit tests and repeat the parallel CSV exporter regression tests."""
    return _run_ctest_preset(
        build_type,
        ["--parallel", "-LE", "perf"],
        environment=environment,
        header="Running Backend Tests",
        cmd_label="CTest",
        ok_msg="All tests passed!",
        fail_msg="Tests failed",
        repeat_csv=True,
        out=out,
    )


def bench_backend(
    build_type: str = "Release", out: TextIO | None = None, *, environment: BuildEnvironment
) -> bool:
    """Run backend performance benchmarks (perf-labeled tests only)."""
    return _run_ctest_preset(
        build_type,
        ["-L", "perf"],
        environment=environment,
        header="Running Backend Benchmarks",
        cmd_label="CTest (perf)",
        ok_msg="All benchmarks passed!",
        fail_msg="Benchmarks failed",
        out=out,
    )


def _print_labeled(label: str, content: str) -> None:
    """Print captured output with a section label."""
    bar = "=" * 60
    print(f"\n{bar}\n  [{label}]\n{bar}")
    sys.stdout.write(content)
    if not content.endswith("\n"):
        print()


def test_all(
    build_type: str = "Release", parallel: bool = True, *, environment: BuildEnvironment
) -> bool:
    """Run frontend and backend tests.

    Runs frontend (vitest) and backend (ctest) in parallel by default.
    Pass parallel=False for sequential execution.
    """
    utils.print_footer("Running All Tests (Frontend + Backend)")

    if not parallel:
        success_front = test_frontend()
        success_back = test_backend(build_type=build_type, environment=environment)
        utils.print_footer(
            "ALL TESTS PASSED" if (success_front and success_back) else "SOME TESTS FAILED"
        )
        return success_front and success_back

    print("\n[Running frontend + backend tests in parallel...]")
    buf_front = io.StringIO()
    buf_back = io.StringIO()
    with ThreadPoolExecutor(max_workers=2) as executor:
        fut_front = executor.submit(test_frontend, out=buf_front)
        fut_back = executor.submit(
            test_backend, build_type=build_type, out=buf_back, environment=environment
        )
        success_front = fut_front.result()
        success_back = fut_back.result()

    _print_labeled("FRONTEND", buf_front.getvalue())
    _print_labeled("BACKEND", buf_back.getvalue())

    utils.print_footer(
        "ALL TESTS PASSED" if (success_front and success_back) else "SOME TESTS FAILED"
    )
    return success_front and success_back
