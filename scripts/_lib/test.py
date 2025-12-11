"""Test commands for Pre-DateGrip."""

import sys

from . import utils


def test_frontend(watch: bool = False) -> bool:
    """Run frontend tests."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    print(f"\n{'#'*60}")
    print("#  Running Frontend Tests")
    if watch:
        print("#  Mode: Watch")
    print(f"{'#'*60}")

    # Find package manager
    pkg_info = utils.find_package_manager()
    if not pkg_info:
        print("\nERROR: No package manager found")
        return False

    pkg_manager, pkg_path = pkg_info
    print(f"\nUsing {pkg_manager}: {pkg_path}")

    # Run tests
    test_cmd = [str(pkg_path), "run", "test"]
    if watch:
        test_cmd.append("--watch")
    else:
        test_cmd.append("--run")

    success, _ = utils.run_command(
        test_cmd,
        f"{pkg_manager} run test",
        cwd=frontend_dir
    )

    if success:
        print("\n[OK] All tests passed!")
    else:
        print("\n[FAIL] Tests failed")

    return success


def test_backend(build_type: str = "Release") -> bool:
    """Run backend tests."""
    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'")
        return False

    project_root = utils.get_project_root()
    build_dir = project_root / "build"

    print(f"\n{'#'*60}")
    print(f"#  Running Backend Tests ({build_type})")
    print(f"{'#'*60}")

    if not build_dir.exists():
        print("\nERROR: Build directory not found")
        print("Run 'uv run scripts/pdg.py build backend' first")
        return False

    # Setup MSVC environment
    env = utils.get_msvc_env()

    # Run CTest
    test_cmd = ["ctest", "--test-dir", "build", "--output-on-failure", "--parallel"]
    if build_type:
        test_cmd.extend(["--build-config", build_type])

    success, _ = utils.run_command(test_cmd, "CTest", env=env)

    if success:
        print("\n[OK] All tests passed!")
    else:
        print("\n[FAIL] Tests failed")

    return success
