"""Build commands for Pre-DateGrip."""

import shutil
import sys
from pathlib import Path

from . import utils


def build_frontend(clean: bool = False) -> bool:
    """Build the frontend."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    print(f"\n{'#'*60}")
    print("#  Building Frontend")
    if clean:
        print("#  Mode: Clean Build")
    print(f"{'#'*60}")

    # Clear caches if --clean
    if clean:
        print("\n[Cleaning caches...]")
        caches = [
            frontend_dir / "dist",
            frontend_dir / "node_modules" / ".vite",
            frontend_dir / ".vite",
        ]
        for cache in caches:
            if cache.exists():
                try:
                    shutil.rmtree(cache)
                    print(f"  [OK] Cleared: {cache.relative_to(project_root)}")
                except Exception as e:
                    print(f"  [FAIL] {e}")

    # Find package manager
    print("\n[1/3] Detecting package manager...")
    pkg_info = utils.find_package_manager()
    if not pkg_info:
        print("\nERROR: No package manager found (Bun or npm)")
        print("\nInstall options:")
        print("  1. Bun (recommended): powershell -c \"irm bun.sh/install.ps1 | iex\"")
        print("  2. npm: winget install OpenJS.NodeJS")
        return False

    pkg_manager, pkg_path = pkg_info
    print(f"Found {pkg_manager}: {pkg_path}")

    # Check dependencies
    print("\n[2/3] Checking dependencies...")
    node_modules = frontend_dir / "node_modules"
    package_json = frontend_dir / "package.json"

    needs_install = not node_modules.exists()
    if not needs_install and package_json.exists():
        pkg_mtime = package_json.stat().st_mtime
        nm_mtime = node_modules.stat().st_mtime
        if pkg_mtime > nm_mtime:
            print("  package.json modified, reinstalling...")
            needs_install = True

    if needs_install:
        success, _ = utils.run_command(
            [str(pkg_path), "install"],
            f"{pkg_manager} install",
            cwd=frontend_dir
        )
        if not success:
            print("\nERROR: Failed to install dependencies")
            return False
    else:
        print("  Dependencies up to date")

    # Build
    print("\n[3/3] Building...")
    success, _ = utils.run_command(
        [str(pkg_path), "run", "build"],
        f"{pkg_manager} run build",
        cwd=frontend_dir
    )

    if not success:
        print("\nERROR: Build failed")
        return False

    # Report success
    dist_dir = frontend_dir / "dist"
    total_size = sum(f.stat().st_size for f in dist_dir.rglob('*') if f.is_file())
    file_count = sum(1 for _ in dist_dir.rglob('*') if _.is_file())

    print(f"\n{'='*60}")
    print("  BUILD SUCCESSFUL")
    print(f"{'='*60}")
    print(f"\n  Output: {dist_dir}")
    print(f"  Size: {total_size / 1024 / 1024:.2f} MB")
    print(f"  Files: {file_count}")

    # Clear WebView2 cache
    utils.clear_webview2_cache(project_root)

    return True


def build_backend(build_type: str = "Release", clean: bool = False) -> bool:
    """Build the backend."""
    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'. Use 'Debug' or 'Release'")
        return False

    project_root = utils.get_project_root()
    build_dir = project_root / "build"

    print(f"\n{'#'*60}")
    print(f"#  Building Backend ({build_type})")
    if clean:
        print("#  Mode: Clean Build")
    print(f"{'#'*60}")

    # Clean build directory if requested
    if clean and build_dir.exists():
        print("\n[Cleaning build directory...]")
        shutil.rmtree(build_dir)
        print(f"  Removed: {build_dir}")

    # Setup MSVC environment
    print("\n[1/4] Setting up MSVC environment...")
    env = utils.get_msvc_env()

    # Check tools
    print("\n[2/4] Checking build tools...")
    if not utils.check_build_tools(env):
        return False

    # Check for Ninja
    has_ninja = shutil.which("ninja") is not None

    # Create build directory
    build_dir.mkdir(exist_ok=True)

    # Configure
    print("\n[3/4] Configuring with CMake...")
    if has_ninja:
        cmake_cmd = ["cmake", "-B", "build", "-G", "Ninja", f"-DCMAKE_BUILD_TYPE={build_type}"]
    else:
        cmake_cmd = ["cmake", "-B", "build", "-G", "Visual Studio 17 2022", "-A", "x64"]

    success, stderr = utils.run_command(cmake_cmd, "CMake Configure", env=env, capture_output=True)
    if not success:
        print("\nERROR: CMake configuration failed")
        return False

    # Build
    print("\n[4/4] Building...")
    build_cmd = ["cmake", "--build", "build", "--config", build_type, "--parallel"]
    success, _ = utils.run_command(build_cmd, f"CMake Build ({build_type})", env=env)
    if not success:
        print("\nERROR: Build failed")
        return False

    # Find executable
    exe_path = build_dir / build_type / "PreDateGrip.exe"
    if not exe_path.exists():
        for exe in build_dir.rglob("PreDateGrip.exe"):
            exe_path = exe
            break

    print(f"\n{'='*60}")
    print("  BUILD SUCCESSFUL")
    print(f"{'='*60}")
    if exe_path.exists():
        print(f"\n  Executable: {exe_path}")
        print(f"  Size: {exe_path.stat().st_size / 1024 / 1024:.2f} MB")

    # Copy frontend files
    print("\n[Post-Build] Copying frontend files...")
    frontend_dist = project_root / "frontend" / "dist"
    frontend_target = build_dir / build_type / "frontend"

    if frontend_dist.exists():
        try:
            if frontend_target.exists():
                shutil.rmtree(frontend_target)
            shutil.copytree(frontend_dist, frontend_target)
            file_count = sum(1 for _ in frontend_target.rglob('*') if _.is_file())
            print(f"  [OK] Copied: frontend/dist -> build/{build_type}/frontend")
            print(f"  Files: {file_count}")
        except Exception as e:
            print(f"  [FAIL] {e}")
    else:
        print(f"  [SKIP] Frontend dist not found")
        print("  Run 'uv run scripts/pdg.py build frontend' first")

    # Clear WebView2 cache
    utils.clear_webview2_cache(project_root)

    # Final output: Show binary location
    if exe_path.exists():
        print(f"\n{'='*60}")
        print(f"  BINARY LOCATION")
        print(f"{'='*60}")
        print(f"\n  {exe_path.absolute()}")
        print()

    return True


def build_all(build_type: str = "Release", clean: bool = False) -> bool:
    """Build both frontend and backend."""
    project_root = utils.get_project_root()
    build_dir = project_root / "build"

    print(f"\n{'='*60}")
    print("  Building All (Frontend + Backend)")
    print(f"{'='*60}")

    # Build frontend first
    if not build_frontend(clean=clean):
        return False

    # Then build backend
    if not build_backend(build_type=build_type, clean=clean):
        return False

    print(f"\n{'='*60}")
    print("  ALL BUILDS SUCCESSFUL")
    print(f"{'='*60}")

    # Show final binary location
    exe_path = build_dir / build_type / "PreDateGrip.exe"
    if exe_path.exists():
        print(f"\n  Binary: {exe_path.absolute()}")
        print(f"  Run: {exe_path.name}")

    return True
