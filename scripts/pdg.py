#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# ///
"""
Velocity-DB CLI - Unified build system interface

Usage:
    uv run scripts/pdg.py build [backend|frontend|all] [--clean]
    uv run scripts/pdg.py debug [--clean]              # Backend Debug build
    uv run scripts/pdg.py test [backend|frontend] [--watch]
    uv run scripts/pdg.py lint [--fix] [--unsafe]
    uv run scripts/pdg.py dev
    uv run scripts/pdg.py package
    uv run scripts/pdg.py check [build-type]
    uv run scripts/pdg.py clean [logs|cache|all]

Examples:
    uv run scripts/pdg.py build backend --clean
    uv run scripts/pdg.py build all
    uv run scripts/pdg.py debug                        # Quick debug build
    uv run scripts/pdg.py test frontend --watch
    uv run scripts/pdg.py lint --fix
    uv run scripts/pdg.py lint --fix --unsafe
    uv run scripts/pdg.py clean logs
"""

import argparse
import sys
from pathlib import Path

# Add _lib to path
sys.path.insert(0, str(Path(__file__).parent))

from _lib import build, lint, test, utils


def cmd_build(args):
    """Handle build command."""
    target = args.target
    clean = args.clean
    build_type = args.type

    if target == "backend":
        return build.build_backend(build_type=build_type, clean=clean)
    elif target == "frontend":
        return build.build_frontend(clean=clean)
    elif target == "all":
        return build.build_all(build_type=build_type, clean=clean)
    else:
        print(f"ERROR: Unknown build target: {target}")
        return False


def cmd_debug(args):
    """Handle debug command - quick backend debug build."""
    return build.build_backend(build_type="Debug", clean=args.clean)


def cmd_test(args):
    """Handle test command."""
    target = args.target
    watch = args.watch
    build_type = args.type

    if target == "backend":
        return test.test_backend(build_type=build_type)
    elif target == "frontend":
        return test.test_frontend(watch=watch)
    else:
        print(f"ERROR: Unknown test target: {target}")
        return False


def cmd_lint(args):
    """Handle lint command."""
    fix = args.fix
    unsafe = args.unsafe
    return lint.lint_all(fix=fix, unsafe=unsafe)


def cmd_dev(args):
    """Handle dev command - start frontend dev server."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    print(f"\n{'#' * 60}")
    print("#  Starting Development Server")
    print(f"{'#' * 60}")

    pkg_info = utils.find_package_manager()
    if not pkg_info:
        print("\nERROR: No package manager found")
        return False

    pkg_manager, pkg_path = pkg_info
    print(f"\nUsing {pkg_manager}: {pkg_path}")

    # Run dev server
    success, _ = utils.run_command(
        [str(pkg_path), "run", "dev"], f"{pkg_manager} run dev", cwd=frontend_dir
    )

    return success


def cmd_package(args):
    """Handle package command."""
    project_root = utils.get_project_root()
    dist_dir = project_root / "dist"

    print(f"\n{'#' * 60}")
    print("#  Packaging Application")
    print(f"{'#' * 60}")

    # Build all first
    print("\n[1/2] Building all...")
    if not build.build_all(build_type="Release", clean=False):
        print("\nERROR: Build failed")
        return False

    # Create package
    print("\n[2/2] Creating package...")

    import shutil

    # Clean dist directory
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    dist_dir.mkdir()

    # Copy executable
    exe_path = project_root / "build" / "Release" / "VelocityDB.exe"
    if exe_path.exists():
        shutil.copy(exe_path, dist_dir / "VelocityDB.exe")
        print(f"  [OK] Copied: {exe_path.name}")
    else:
        print(f"  [FAIL] Executable not found: {exe_path}")
        return False

    # Copy frontend
    frontend_dist = project_root / "build" / "Release" / "frontend"
    if frontend_dist.exists():
        shutil.copytree(frontend_dist, dist_dir / "frontend")
        file_count = sum(1 for _ in (dist_dir / "frontend").rglob("*") if _.is_file())
        print(f"  [OK] Copied: frontend ({file_count} files)")
    else:
        print(f"  [FAIL] Frontend not found: {frontend_dist}")
        return False

    # Summary
    print(f"\n{'=' * 60}")
    print("  PACKAGE CREATED")
    print(f"{'=' * 60}")
    print(f"\n  Output: {dist_dir}")
    total_size = sum(f.stat().st_size for f in dist_dir.rglob("*") if f.is_file())
    print(f"  Total size: {total_size / 1024 / 1024:.2f} MB")

    return True


def cmd_check(args):
    """Handle check command - comprehensive project check."""
    build_type = args.type

    print(f"\n{'=' * 60}")
    print(f"  Comprehensive Project Check ({build_type})")
    print(f"{'=' * 60}")

    errors = 0

    # Lint
    print("\n[1/3] Linting...")
    if not lint.lint_all(fix=False):
        errors += 1

    # Test frontend
    print("\n[2/3] Testing frontend...")
    if not test.test_frontend(watch=False):
        errors += 1

    # Build all
    print("\n[3/3] Building all...")
    if not build.build_all(build_type=build_type, clean=False):
        errors += 1

    # Summary
    print(f"\n{'=' * 60}")
    if errors == 0:
        print("  ALL CHECKS PASSED [OK]")
    else:
        print(f"  {errors} CHECK(S) FAILED [FAIL]")
    print(f"{'=' * 60}")

    return errors == 0


def cmd_clean(args):
    """Handle clean command - remove logs, cache, etc."""
    import shutil

    project_root = utils.get_project_root()
    target = args.target

    print(f"\n{'#' * 60}")
    print(f"#  Cleaning: {target}")
    print(f"{'#' * 60}\n")

    cleaned_items = []

    if target in ("logs", "all"):
        # Clean log directory
        log_dir = project_root / "log"
        if log_dir.exists():
            for log_file in log_dir.glob("*.log"):
                log_file.unlink()
                cleaned_items.append(f"  [OK] Deleted: {log_file.name}")
            if not cleaned_items:
                cleaned_items.append("  [INFO] No log files found")
        else:
            cleaned_items.append("  [INFO] Log directory does not exist")

    if target in ("cache", "all"):
        # Clean WebView2 cache
        webview_cache = project_root / "build" / "Release" / "VelocityDB.exe.WebView2"
        if webview_cache.exists():
            shutil.rmtree(webview_cache)
            cleaned_items.append("  [OK] Deleted: WebView2 cache")
        else:
            cleaned_items.append("  [INFO] WebView2 cache does not exist")

        # Clean frontend node_modules/.cache
        frontend_cache = project_root / "frontend" / "node_modules" / ".cache"
        if frontend_cache.exists():
            shutil.rmtree(frontend_cache)
            cleaned_items.append("  [OK] Deleted: Frontend cache")

    for item in cleaned_items:
        print(item)

    print(f"\n{'=' * 60}")
    print("  CLEAN COMPLETE")
    print(f"{'=' * 60}")

    return True


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        prog="pdg",
        description="Velocity-DB unified build system",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Build command
    build_parser = subparsers.add_parser("build", aliases=["b"], help="Build project")
    build_parser.add_argument(
        "target",
        choices=["backend", "frontend", "all"],
        default="all",
        nargs="?",
        help="Build target (default: all)",
    )
    build_parser.add_argument(
        "--clean", "-c", action="store_true", help="Clean build (remove old artifacts)"
    )
    build_parser.add_argument(
        "--type",
        "-t",
        choices=["Debug", "Release"],
        default="Release",
        help="Build type for backend (default: Release)",
    )

    # Debug command (shortcut for build backend --type Debug)
    debug_parser = subparsers.add_parser("debug", help="Backend Debug build (shortcut)")
    debug_parser.add_argument(
        "--clean", "-c", action="store_true", help="Clean build (remove old artifacts)"
    )

    # Test command
    test_parser = subparsers.add_parser("test", aliases=["t"], help="Run tests")
    test_parser.add_argument(
        "target",
        choices=["backend", "frontend"],
        default="frontend",
        nargs="?",
        help="Test target (default: frontend)",
    )
    test_parser.add_argument(
        "--watch", "-w", action="store_true", help="Watch mode (frontend only)"
    )
    test_parser.add_argument(
        "--type",
        "-t",
        choices=["Debug", "Release"],
        default="Release",
        help="Build type for backend tests (default: Release)",
    )

    # Lint command
    lint_parser = subparsers.add_parser("lint", aliases=["l"], help="Lint code")
    lint_parser.add_argument("--fix", "-f", action="store_true", help="Auto-fix issues")
    lint_parser.add_argument(
        "--unsafe", "-u", action="store_true", help="Apply unsafe fixes (requires --fix)"
    )

    # Dev command
    subparsers.add_parser("dev", aliases=["d"], help="Start development server")

    # Package command
    subparsers.add_parser("package", aliases=["p"], help="Create distribution package")

    # Check command
    check_parser = subparsers.add_parser("check", aliases=["c"], help="Run all checks")
    check_parser.add_argument(
        "type",
        choices=["Debug", "Release"],
        default="Release",
        nargs="?",
        help="Build type (default: Release)",
    )

    # Clean command
    clean_parser = subparsers.add_parser("clean", help="Clean logs, cache, etc.")
    clean_parser.add_argument(
        "target",
        choices=["logs", "cache", "all"],
        default="logs",
        nargs="?",
        help="Clean target (default: logs)",
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Route to appropriate command handler
    command_map = {
        "build": cmd_build,
        "b": cmd_build,
        "debug": cmd_debug,
        "test": cmd_test,
        "t": cmd_test,
        "lint": cmd_lint,
        "l": cmd_lint,
        "dev": cmd_dev,
        "d": cmd_dev,
        "package": cmd_package,
        "p": cmd_package,
        "check": cmd_check,
        "c": cmd_check,
        "clean": cmd_clean,
    }

    handler = command_map.get(args.command)
    if not handler:
        print(f"ERROR: Unknown command: {args.command}")
        sys.exit(1)

    try:
        success = handler(args)
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
