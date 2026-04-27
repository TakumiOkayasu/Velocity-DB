"""Test commands for Velocity-DB."""

from . import utils


def test_frontend(watch: bool = False) -> bool:
    """Run frontend tests."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    subtitles = ("Mode: Watch",) if watch else ()
    utils.print_header("Running Frontend Tests", *subtitles)

    # Ensure dependencies
    pkg_info = utils.ensure_frontend_deps()
    if not pkg_info:
        return False

    pkg_manager, pkg_path = pkg_info
    print(f"\nUsing {pkg_manager}: {pkg_path}")

    # Run tests
    test_cmd = [str(pkg_path), "run", "test"]
    if watch:
        test_cmd.append("--watch")
    else:
        test_cmd.append("--run")

    success, _ = utils.run_command(test_cmd, f"{pkg_manager} run test", cwd=frontend_dir)

    if success:
        print("\n[OK] All tests passed!")
    else:
        print("\n[FAIL] Tests failed")

    return success


def test_e2e() -> bool:
    """Run E2E tests with Playwright."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    utils.print_header("Running E2E Tests (Playwright)")

    pkg_info = utils.ensure_frontend_deps()
    if not pkg_info:
        return False

    pkg_manager, pkg_path = pkg_info
    print(f"\nUsing {pkg_manager}: {pkg_path}")

    success, _ = utils.run_command(
        [str(pkg_path), "run", "test:e2e"],
        f"{pkg_manager} run test:e2e",
        cwd=frontend_dir,
    )

    if success:
        print("\n[OK] All E2E tests passed!")
    else:
        print("\n[FAIL] E2E tests failed")

    return success


def _run_ctest_preset(
    build_type: str,
    label_args: list[str],
    *,
    header: str,
    cmd_label: str,
    ok_msg: str,
    fail_msg: str,
) -> bool:
    """Run ctest under a CMake preset with the given label filter.

    label_args は ctest にそのまま渡す追加引数 (例: ["--parallel", "-LE", "perf"])。
    """
    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'")
        return False

    project_root = utils.get_project_root()
    build_dir = project_root / "build"

    utils.print_header(f"{header} ({build_type})")

    if not build_dir.exists():
        print("\nERROR: Build directory not found")
        print("Run 'uv run scripts/pdg.py build backend' first")
        return False

    env = utils.get_msvc_env()
    preset = build_type.lower()  # "debug" or "release"
    test_cmd = ["ctest", "--preset", preset, "--output-on-failure", *label_args]

    success, _ = utils.run_command(test_cmd, cmd_label, env=env)

    print(f"\n[{'OK' if success else 'FAIL'}] {ok_msg if success else fail_msg}")
    return success


def test_backend(build_type: str = "Release") -> bool:
    """Run backend unit tests (perf-labeled benchmarks excluded)."""
    # -LE perf excludes performance benchmarks so the default test run stays
    # fast; use `pdg bench backend` to run them.
    return _run_ctest_preset(
        build_type,
        ["--parallel", "-LE", "perf"],
        header="Running Backend Tests",
        cmd_label="CTest",
        ok_msg="All tests passed!",
        fail_msg="Tests failed",
    )


def bench_backend(build_type: str = "Release") -> bool:
    """Run backend performance benchmarks (perf-labeled tests only)."""
    return _run_ctest_preset(
        build_type,
        ["-L", "perf"],
        header="Running Backend Benchmarks",
        cmd_label="CTest (perf)",
        ok_msg="All benchmarks passed!",
        fail_msg="Benchmarks failed",
    )
