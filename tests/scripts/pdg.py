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
    uv run scripts/pdg.py release [version] [--draft] [--skip-checks]
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
from collections.abc import Callable
from pathlib import Path

# Add _lib to path
sys.path.insert(0, str(Path(__file__).parent))

from _lib import build, lint, test, utils


def cmd_build(args: argparse.Namespace) -> bool:
    """Handle build command."""
    target: str = args.target
    clean: bool = args.clean
    build_type: str = args.type

    if target == "backend":
        return build.build_backend(build_type=build_type, clean=clean)
    elif target == "frontend":
        return build.build_frontend(clean=clean)
    elif target == "all":
        return build.build_all(build_type=build_type, clean=clean)
    else:
        print(f"ERROR: Unknown build target: {target}")
        return False


def cmd_debug(args: argparse.Namespace) -> bool:
    """Handle debug command - quick backend debug build."""
    clean: bool = args.clean
    return build.build_backend(build_type="Debug", clean=clean)


def cmd_test(args: argparse.Namespace) -> bool:
    """Handle test command."""
    target: str = args.target
    watch: bool = args.watch
    build_type: str = args.type

    if target == "backend":
        return test.test_backend(build_type=build_type)
    elif target == "frontend":
        return test.test_frontend(watch=watch)
    else:
        print(f"ERROR: Unknown test target: {target}")
        return False


def cmd_lint(args: argparse.Namespace) -> bool:
    """Handle lint command."""
    fix: bool = args.fix
    unsafe: bool = args.unsafe
    return lint.lint_all(fix=fix, unsafe=unsafe)


def cmd_dev(_args: argparse.Namespace) -> bool:
    """Handle dev command - start frontend dev server."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    print(f"\n{'#' * 60}")
    print("#  Starting Development Server")
    print(f"{'#' * 60}")

    # Ensure dependencies
    pkg_info = utils.ensure_frontend_deps()
    if not pkg_info:
        return False

    pkg_manager, pkg_path = pkg_info
    print(f"\nUsing {pkg_manager}: {pkg_path}")

    # Run dev server
    success, _ = utils.run_command(
        [str(pkg_path), "run", "dev"], f"{pkg_manager} run dev", cwd=frontend_dir
    )

    return success


def cmd_package(_args: argparse.Namespace) -> bool:
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


def cmd_release(args: argparse.Namespace) -> bool:
    """Handle release command - create versioned release package."""
    import shutil
    import zipfile

    from _lib.release import (
        generate_release_notes,
        get_latest_tag,
        increment_version,
    )

    project_root = utils.get_project_root()
    dist_dir = project_root / "dist"

    # Determine version
    latest_tag = get_latest_tag(project_root)
    version_arg: str | None = args.version
    if version_arg:
        version = version_arg.lstrip("v")
    elif latest_tag:
        bump: str = args.bump if hasattr(args, "bump") and args.bump else "patch"
        version = increment_version(latest_tag, bump)
        print(f"\n  Latest tag: v{latest_tag}")
        print(f"  Next version: v{version} ({bump} bump)")
    else:
        version = "1.0.0"
        print("\n  No existing tags found. Using v1.0.0")

    print(f"\n{'#' * 60}")
    print(f"#  Creating Release v{version}")
    print(f"{'#' * 60}")

    # Step 1: Run checks (unless skipped)
    skip_checks: bool = args.skip_checks
    if not skip_checks:
        print("\n[1/5] Running checks...")
        if not lint.lint_all(fix=False):
            print("\nERROR: Lint failed. Use --skip-checks to bypass.")
            return False
        if not test.test_frontend(watch=False):
            print("\nERROR: Tests failed. Use --skip-checks to bypass.")
            return False
    else:
        print("\n[1/5] Skipping checks (--skip-checks)")

    # Step 2: Build Release
    print("\n[2/5] Building Release...")
    if not build.build_all(build_type="Release", clean=True):
        print("\nERROR: Build failed")
        return False

    # Step 3: Create dist directory
    print("\n[3/5] Creating distribution...")
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    dist_dir.mkdir()

    exe_path = project_root / "build" / "Release" / "VelocityDB.exe"
    frontend_dist = project_root / "build" / "Release" / "frontend"

    if not exe_path.exists():
        print(f"  [FAIL] Executable not found: {exe_path}")
        return False
    if not frontend_dist.exists():
        print(f"  [FAIL] Frontend not found: {frontend_dist}")
        return False

    shutil.copy(exe_path, dist_dir / "VelocityDB.exe")
    shutil.copytree(frontend_dist, dist_dir / "frontend")
    print("  [OK] Files copied")

    # Step 4: Generate release notes
    print("\n[4/5] Generating release notes...")
    release_notes = generate_release_notes(version, latest_tag, project_root)
    notes_path = project_root / f"RELEASE_NOTES_v{version}.md"
    with open(notes_path, "w", encoding="utf-8") as f:
        f.write(release_notes)
    print(f"  [OK] {notes_path.name}")

    # Step 5: Create zip
    print("\n[5/5] Creating zip archive...")
    zip_name = f"Velocity-DB-v{version}.zip"
    zip_path = project_root / zip_name

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in dist_dir.rglob("*"):
            if file.is_file():
                arcname = file.relative_to(dist_dir)
                zf.write(file, arcname)

    zip_size = zip_path.stat().st_size / 1024 / 1024
    print(f"  [OK] Created: {zip_name} ({zip_size:.2f} MB)")

    # Summary
    print(f"\n{'=' * 60}")
    print("  RELEASE PACKAGE CREATED")
    print(f"{'=' * 60}")
    print(f"\n  Version:       v{version}")
    print(f"  Archive:       {zip_path}")
    print(f"  Size:          {zip_size:.2f} MB")
    print(f"  Release Notes: {notes_path}")

    # Show release notes preview
    print(f"\n{'=' * 60}")
    print("  RELEASE NOTES PREVIEW")
    print(f"{'=' * 60}")
    print(release_notes[:500] + ("..." if len(release_notes) > 500 else ""))

    # Commands to execute
    print(f"\n{'=' * 60}")
    print("  RELEASE COMMANDS")
    print(f"{'=' * 60}")
    draft: bool = args.draft
    draft_flag = "--draft " if draft else ""
    print(f"""
  # 1. Create and push tag
  git tag -a v{version} -m "Release v{version}"
  git push origin v{version}

  # 2. Create GitHub Release
  gh release create v{version} "{zip_path}" {draft_flag}--title "v{version}" --notes-file "{notes_path}"
""")

    return True


def cmd_check(args: argparse.Namespace) -> bool:
    """Handle check command - comprehensive project check."""
    build_type: str = args.type

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


def cmd_clean(args: argparse.Namespace) -> bool:
    """Handle clean command - remove logs, cache, etc."""
    import shutil

    project_root = utils.get_project_root()
    target: str = args.target

    print(f"\n{'#' * 60}")
    print(f"#  Cleaning: {target}")
    print(f"{'#' * 60}\n")

    cleaned_items: list[str] = []

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


type CommandHandler = Callable[[argparse.Namespace], bool]


def main() -> None:
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

    # Release command
    release_parser = subparsers.add_parser(
        "release", aliases=["r"], help="Create versioned release"
    )
    release_parser.add_argument(
        "version", nargs="?", help="Version (e.g., 1.2.1). Auto-detect from git tags if omitted"
    )
    release_parser.add_argument(
        "--bump",
        choices=["patch", "minor", "major"],
        default="patch",
        help="Version bump type (default: patch)",
    )
    release_parser.add_argument("--draft", action="store_true", help="Mark as draft release")
    release_parser.add_argument(
        "--skip-checks", action="store_true", help="Skip lint and test checks"
    )

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
    command_map: dict[str, CommandHandler] = {
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
        "release": cmd_release,
        "r": cmd_release,
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
