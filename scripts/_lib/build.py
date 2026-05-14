"""Build commands for Velocity-DB."""

import io
import shutil
from concurrent.futures import ThreadPoolExecutor
from typing import TextIO

from . import utils


def build_frontend(clean: bool = False, out: TextIO | None = None) -> bool:
    """Build the frontend."""
    project_root = utils.get_project_root()
    frontend_dir = project_root / "frontend"

    subtitles = ("Mode: Clean Build",) if clean else ()
    utils.print_header("Building Frontend", *subtitles, file=out)

    if clean:
        print("\n[Cleaning caches...]", file=out)
        caches = [
            frontend_dir / "dist",
            frontend_dir / "node_modules" / ".vite",
            frontend_dir / ".vite",
        ]
        for cache in caches:
            if cache.exists():
                try:
                    shutil.rmtree(cache)
                    print(f"  [OK] Cleared: {cache.relative_to(project_root)}", file=out)
                except Exception as e:
                    print(f"  [FAIL] {e}", file=out)

    pkg_info = utils.ensure_frontend_deps(out=out)
    if not pkg_info:
        return False

    pkg_manager, pkg_path = pkg_info

    print("\n[Building...]", file=out)
    success, _ = utils.run_command(
        [str(pkg_path), "run", "build"],
        f"{pkg_manager} run build",
        cwd=frontend_dir,
        out=out,
    )

    if not success:
        print("\nERROR: Build failed", file=out)
        return False

    dist_dir = frontend_dir / "dist"
    total_size = sum(f.stat().st_size for f in dist_dir.rglob("*") if f.is_file())
    file_count = sum(1 for _ in dist_dir.rglob("*") if _.is_file())

    utils.print_footer("BUILD SUCCESSFUL", file=out)
    print(f"\n  Output: {dist_dir}", file=out)
    print(f"  Size: {total_size / 1024 / 1024:.2f} MB", file=out)
    print(f"  Files: {file_count}", file=out)

    utils.clear_webview2_cache(project_root, out=out)

    return True


def _copy_frontend_to_build(build_type: str, out: TextIO | None = None) -> None:
    """Copy frontend/dist to build/<type>/frontend (post-build step)."""
    project_root = utils.get_project_root()
    frontend_dist = project_root / "frontend" / "dist"
    frontend_target = project_root / "build" / build_type / "frontend"

    print("\n[Post-Build] Copying frontend files...", file=out)
    if not frontend_dist.exists():
        print("  [SKIP] Frontend dist not found", file=out)
        print("  Run 'uv run scripts/pdg.py build frontend' first", file=out)
        return
    try:
        if frontend_target.exists():
            shutil.rmtree(frontend_target)
        shutil.copytree(frontend_dist, frontend_target)
        file_count = sum(1 for _ in frontend_target.rglob("*") if _.is_file())
        print(f"  [OK] Copied: frontend/dist -> build/{build_type}/frontend", file=out)
        print(f"  Files: {file_count}", file=out)
    except Exception as e:
        print(f"  [FAIL] {e}", file=out)


def build_backend(
    build_type: str = "Release",
    clean: bool = False,
    *,
    copy_frontend: bool = True,
    out: TextIO | None = None,
) -> bool:
    """Build the backend."""
    if build_type not in ("Debug", "Release"):
        print(f"ERROR: Invalid build type '{build_type}'. Use 'Debug' or 'Release'", file=out)
        return False

    project_root = utils.get_project_root()
    build_dir = project_root / "build"
    preset = build_type.lower()

    subtitles = ("Mode: Clean Build",) if clean else ()
    utils.print_header(f"Building Backend ({build_type})", *subtitles, file=out)

    if clean and build_dir.exists():
        print("\n[Cleaning build directory...]", file=out)
        shutil.rmtree(build_dir)
        print(f"  Removed: {build_dir}", file=out)

    print("\n[1/4] Setting up MSVC environment...", file=out)
    env = utils.get_msvc_env(out=out)
    # vcpkg detect_compiler が bundled ninja 経路 (vcpkg-parallel-configure) で
    # `ninja -v` を error code 1 で失敗させる長期 issue (#40785, #17195) を回避。
    # system ninja を強制使用する公式 env (Microsoft Learn vcpkg env vars 参照)。
    env["VCPKG_FORCE_SYSTEM_BINARIES"] = "1"

    print("\n[2/4] Checking build tools...", file=out)
    if not utils.check_build_tools(env, out=out):
        return False

    print(f"\n[3/4] Configuring with CMake (preset: {preset})...", file=out)
    cmake_cmd = ["cmake", "--preset", preset]
    success, stderr = utils.run_command(
        cmake_cmd, "CMake Configure", env=env, capture_output=True, out=out
    )
    if not success:
        print("\nERROR: CMake configuration failed", file=out)
        if stderr and out is None:
            print(f"\n{stderr}")
        return False

    print("\n[4/4] Building...", file=out)
    build_cmd = ["cmake", "--build", "--preset", preset]
    success, _ = utils.run_command(build_cmd, f"CMake Build ({build_type})", env=env, out=out)
    if not success:
        print("\nERROR: Build failed", file=out)
        return False

    exe_path = build_dir / build_type / "VelocityDB.exe"
    if not exe_path.exists():
        for exe in build_dir.rglob("VelocityDB.exe"):
            exe_path = exe
            break

    utils.print_footer("BUILD SUCCESSFUL", file=out)
    if exe_path.exists():
        print(f"\n  Executable: {exe_path}", file=out)
        print(f"  Size: {exe_path.stat().st_size / 1024 / 1024:.2f} MB", file=out)

    if copy_frontend:
        _copy_frontend_to_build(build_type, out=out)

    utils.clear_webview2_cache(project_root, out=out)

    if exe_path.exists():
        utils.print_footer("BINARY LOCATION", file=out)
        print(f"\n  {exe_path.absolute()}\n", file=out)

    return True


def _print_labeled(label: str, content: str) -> None:
    """Print captured output with a section label."""
    bar = "=" * 60
    print(f"\n{bar}\n  [{label}]\n{bar}")
    import sys

    sys.stdout.write(content)
    if not content.endswith("\n"):
        print()


def build_all(build_type: str = "Release", clean: bool = False, parallel: bool = True) -> bool:
    """Build both frontend and backend.

    Runs frontend and backend builds in parallel by default. Pass parallel=False
    for sequential execution (legacy behavior).
    """
    project_root = utils.get_project_root()
    build_dir = project_root / "build"

    utils.print_footer("Building All (Frontend + Backend)")

    if not parallel:
        if not build_frontend(clean=clean):
            return False
        if not build_backend(build_type=build_type, clean=clean):
            return False
        utils.print_footer("ALL BUILDS SUCCESSFUL")
        exe_path = build_dir / build_type / "VelocityDB.exe"
        if exe_path.exists():
            print(f"\n  Binary: {exe_path.absolute()}")
            print(f"  Run: {exe_path.name}")
        return True

    print("\n[Running frontend + backend build in parallel...]")
    buf_front = io.StringIO()
    buf_back = io.StringIO()
    with ThreadPoolExecutor(max_workers=2) as executor:
        fut_front = executor.submit(build_frontend, clean=clean, out=buf_front)
        # Skip frontend copy in parallel mode; we do it once after both complete.
        fut_back = executor.submit(
            build_backend,
            build_type=build_type,
            clean=clean,
            copy_frontend=False,
            out=buf_back,
        )
        success_front = fut_front.result()
        success_back = fut_back.result()

    _print_labeled("FRONTEND", buf_front.getvalue())
    _print_labeled("BACKEND", buf_back.getvalue())

    if not (success_front and success_back):
        utils.print_footer("SOME BUILDS FAILED")
        return False

    # Post: copy frontend to build dir (now that both have finished)
    _copy_frontend_to_build(build_type)

    utils.print_footer("ALL BUILDS SUCCESSFUL")
    exe_path = build_dir / build_type / "VelocityDB.exe"
    if exe_path.exists():
        print(f"\n  Binary: {exe_path.absolute()}")
        print(f"  Run: {exe_path.name}")

    return True
