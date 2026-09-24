"""Common utility functions for Velocity-DB build system."""

import os
import re
import shutil
import subprocess
import threading
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO


@dataclass(frozen=True)
class FrontendRuntime:
    bun: Path
    env: dict[str, str]

    def run(self, script: str, *args: str, out: TextIO | None = None) -> bool:
        """Run a package script with the same pinned Node and Bun as the install."""
        ok, _ = run_command(
            [str(self.bun), "run", script, *args],
            f"bun run {script}",
            cwd=get_project_root() / "frontend",
            env=self.env,
            out=out,
        )
        return ok


_BANNER_WIDTH = 60
_FRONTEND_INSTALL_LOCK = threading.Lock()


def print_header(title: str, *subtitles: str, file: TextIO | None = None) -> None:
    """Print a section header (e.g. '#  Building Backend (Debug)')."""
    print(f"\n{'#' * _BANNER_WIDTH}", file=file)
    print(f"#  {title}", file=file)
    for s in subtitles:
        print(f"#  {s}", file=file)
    print(f"{'#' * _BANNER_WIDTH}", file=file)


def print_footer(message: str, *, file: TextIO | None = None) -> None:
    """Print a footer banner (e.g. 'BUILD SUCCESSFUL')."""
    print(f"\n{'=' * _BANNER_WIDTH}", file=file)
    print(f"  {message}", file=file)
    print(f"{'=' * _BANNER_WIDTH}", file=file)


def get_project_root() -> Path:
    """Get the project root directory (resolves symlinks)."""
    script_dir = Path(__file__).resolve().parent.parent
    return script_dir.parent


def _environment_path(env: dict[str, str]) -> str | None:
    """Read PATH from an environment, including Windows' usual `Path` spelling."""
    return next((value for key, value in env.items() if key.upper() == "PATH"), None)


def _resolve_command(cmd: list[str], env: dict[str, str]) -> list[str]:
    """Resolve a bare executable from the child's PATH before starting it.

    On Windows, CreateProcess does not use the supplied child environment to
    locate an executable when shell=False.
    """
    if os.path.dirname(cmd[0]):
        return cmd
    executable = shutil.which(cmd[0], path=_environment_path(env))
    if executable is None:
        raise FileNotFoundError(cmd[0])
    return [str(Path(executable).resolve()), *cmd[1:]]


def _merge_environment(
    env: dict[str, str] | None, *, windows: bool = os.name == "nt"
) -> dict[str, str]:
    """Merge overrides without duplicate Windows environment keys such as PATH/Path."""
    merged = os.environ.copy()
    if env:
        if windows:
            for key in env:
                for existing in list(merged):
                    if existing.upper() == key.upper() and existing != key:
                        del merged[existing]
        merged.update(env)
    return merged


def run_command(
    cmd: list[str],
    description: str,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
    out: TextIO | None = None,
) -> tuple[bool, str]:
    """Run a command and return success status and output.

    When `out` is given, subprocess output is captured and written to `out`
    (parallel-safe mode). When `out` is None and `capture_output` is False,
    subprocess streams live to terminal.
    """
    extras = [f"Command: {' '.join(cmd)}"]
    if cwd:
        extras.append(f"Working directory: {cwd}")
    print_footer(description, file=out)
    for e in extras:
        print(f"  {e}", file=out)

    merged_env = _merge_environment(env)

    # Force capture when `out` is set so subprocess output goes to `out`
    do_capture = capture_output or out is not None

    try:
        resolved_cmd = _resolve_command(cmd, merged_env)
        if do_capture:
            result = subprocess.run(
                resolved_cmd, cwd=cwd, env=merged_env, capture_output=True, encoding="utf-8"
            )
            if out is not None:
                if result.stdout:
                    print(result.stdout, end="", file=out)
                if result.stderr:
                    print(result.stderr, end="", file=out)
            return result.returncode == 0, result.stderr or ""
        else:
            result = subprocess.run(resolved_cmd, cwd=cwd, env=merged_env)
            return result.returncode == 0, ""
    except FileNotFoundError:
        print(f"ERROR: Command not found: {cmd[0]}", file=out)
        return False, f"Command not found: {cmd[0]}"
    except Exception as e:
        print(f"ERROR: Failed to execute command: {e}", file=out)
        return False, str(e)


def resolve_frontend_runtime() -> FrontendRuntime:
    """Resolve installed, exactly pinned frontend tools without installing them."""
    root = get_project_root()
    try:
        with (root / "mise.toml").open("rb") as config_file:
            tools = tomllib.load(config_file)["tools"]
        versions = {name: tools[name] for name in ("node", "bun")}
        if any(
            not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version)
            for version in versions.values()
        ):
            raise ValueError("Node and Bun must have exact versions in mise.toml")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RuntimeError(f"Cannot read frontend tool versions: {exc}") from exc

    mise = shutil.which("mise")
    if not mise:
        raise RuntimeError("mise not found")
    lookup_env = os.environ | {
        "MISE_NOT_FOUND_AUTO_INSTALL": "false",
        "MISE_NOT_FOUND_SYSTEM_FALLBACK": "false",
    }
    binaries: dict[str, Path] = {}
    try:
        for name, version in versions.items():
            result = subprocess.run(
                [mise, "which", name, "--tool", f"{name}@{version}"],
                cwd=root,
                env=lookup_env,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                encoding="utf-8",
                check=True,
                timeout=30,
            )
            binary = Path(result.stdout.strip())
            if not binary.is_absolute() or not binary.is_file():
                raise ValueError(f"mise returned no installed {name} executable")
            binaries[name] = binary

        child_env = os.environ.copy()
        existing_path = _environment_path(child_env) or ""
        child_path = os.pathsep.join(
            [
                str(root / "frontend" / "node_modules" / ".bin"),
                str(binaries["node"].parent),
                str(binaries["bun"].parent),
                existing_path,
            ]
        )
        # Windows environment keys are case insensitive; avoid PATH and Path duplicates.
        for key in list(child_env):
            if key.upper() == "PATH":
                del child_env[key]
        child_env["PATH"] = child_path
        for name, version in versions.items():
            result = subprocess.run(
                [str(binaries[name]), "--version"],
                cwd=root,
                env=child_env,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                encoding="utf-8",
                check=True,
                timeout=10,
            )
            if result.stdout.strip() != ("v" if name == "node" else "") + version:
                raise ValueError(
                    f"{name} version mismatch: expected {version}, got {result.stdout.strip()!r}"
                )
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise RuntimeError(
            "Pinned Node/Bun unavailable. Run `mise trust` and "
            "`mise install --locked node bun` in the repository root. "
            f"Detail: {exc}"
        ) from exc
    return FrontendRuntime(binaries["bun"], child_env)


def check_build_tools(env: dict[str, str], out: TextIO | None = None) -> bool:
    """Check if required build tools are available."""
    # Check CMake
    try:
        result = subprocess.run(
            _resolve_command(["cmake", "--version"], env),
            capture_output=True,
            text=True,
            env=env,
        )
        if result.returncode == 0:
            version = result.stdout.split("\n")[0]
            print(f"CMake: {version}", file=out)
        else:
            print("ERROR: CMake not found", file=out)
            return False
    except FileNotFoundError:
        print("ERROR: CMake not found", file=out)
        return False

    # Check Ninja
    try:
        result = subprocess.run(
            _resolve_command(["ninja", "--version"], env),
            capture_output=True,
            text=True,
            env=env,
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            print(f"Ninja: {version}", file=out)
        else:
            print("WARNING: Ninja not found, will use slower generator", file=out)
    except FileNotFoundError:
        print("WARNING: Ninja not found, will use slower generator", file=out)

    return True


def ensure_frontend_deps(out: TextIO | None = None) -> FrontendRuntime | None:
    """Install locked frontend dependencies under the pinned runtime."""
    with _FRONTEND_INSTALL_LOCK:
        return _install_frontend_deps(out)


def _install_frontend_deps(out: TextIO | None = None) -> FrontendRuntime | None:
    """Serialize dependency installs within a process (parallel build and test)."""
    project_root = get_project_root()
    frontend_dir = project_root / "frontend"
    try:
        runtime = resolve_frontend_runtime()
    except RuntimeError as exc:
        print(f"\nERROR: {exc}", file=out)
        return None

    # A frozen install is safe to repeat and also reconciles lockfile changes and
    # incomplete or stale node_modules that timestamps cannot detect.
    print("\n[Installing locked frontend dependencies...]", file=out)
    success, _ = run_command(
        [str(runtime.bun), "install", "--frozen-lockfile"],
        "bun install",
        cwd=frontend_dir,
        env=runtime.env,
        out=out,
    )
    if not success:
        print("\nERROR: Failed to install dependencies", file=out)
        return None
    local_bin = frontend_dir / "node_modules" / ".bin"
    if not shutil.which("vp", path=str(local_bin)):
        print("\nERROR: Local Vite+ (frontend/node_modules/.bin/vp) is missing", file=out)
        return None
    return runtime


def clear_webview2_cache(project_root: Path, out: TextIO | None = None) -> None:
    """Clear WebView2 cache to ensure fresh frontend load."""
    print("\n[Post-Build] Clearing WebView2 cache...", file=out)
    webview2_caches = [
        project_root / "build" / "Debug" / "VelocityDB.exe.WebView2",
        project_root / "build" / "Release" / "VelocityDB.exe.WebView2",
    ]

    cleared = False
    for cache_path in webview2_caches:
        if cache_path.exists():
            try:
                shutil.rmtree(cache_path)
                print(f"  [OK] Cleared: {cache_path.relative_to(project_root)}", file=out)
                cleared = True
            except Exception as e:
                print(f"  [FAIL] Failed to clear {cache_path}: {e}", file=out)

    if cleared:
        print("  WebView2 will load fresh frontend files on next startup", file=out)
    else:
        print("  No WebView2 cache to clear", file=out)
