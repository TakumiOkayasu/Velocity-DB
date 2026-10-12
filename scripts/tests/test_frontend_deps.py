"""Tests for the pinned frontend runtime and frozen dependency bootstrap."""

import io
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib import utils


@pytest.fixture
def frontend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "frontend"
    directory.mkdir()
    dependencies = {
        "vite-plus": "1.0.0",
        "vite": "npm:@voidzero-dev/vite-plus-core@1.0.0",
        "vitest": "5.0.1",
        "@vitest/coverage-v8": "5.0.1",
    }
    (directory / "package.json").write_text(
        json.dumps(
            {
                "name": "frontend",
                "devDependencies": dependencies,
                "overrides": {name: dependencies[name] for name in ("vite", "vitest")},
            }
        ),
        encoding="utf-8",
    )
    for name, version in dependencies.items():
        package_dir = directory / "node_modules" / name
        package_dir.mkdir(parents=True)
        package = {
            "name": "@voidzero-dev/vite-plus-core" if name == "vite" else name,
            "version": "1.0.0" if name == "vite" else version,
            "dependencies": dependencies if name == "vite-plus" else {},
        }
        (package_dir / "package.json").write_text(json.dumps(package), encoding="utf-8")
    (directory / "bun.lock").write_text("lock", encoding="utf-8")
    local_bin = directory / "node_modules" / ".bin"
    local_bin.mkdir(parents=True)
    local_vp = local_bin / ("vp.exe" if os.name == "nt" else "vp")
    local_vp.touch(mode=0o755)
    local_vp.chmod(0o755)
    (tmp_path / "mise.toml").write_text(
        '[tools]\nnode = "24.21.0"\nbun = "1.4.2"\n', encoding="utf-8"
    )
    monkeypatch.setattr(utils, "get_project_root", lambda: tmp_path)
    return directory


def test_resolves_installed_exact_versions_and_child_path(
    frontend: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = frontend.parent
    binaries = {name: root / "tools" / name / name for name in ("node", "bun")}
    for binary in binaries.values():
        binary.parent.mkdir(parents=True)
        binary.touch()
    monkeypatch.setattr(
        utils.shutil, "which", lambda name: "/tools/mise" if name == "mise" else None
    )
    calls: list[tuple[list[str], dict[str, str]]] = []

    def subprocess_run(cmd: list[str], **kwargs: object) -> SimpleNamespace:
        env = kwargs["env"]
        assert isinstance(env, dict)
        calls.append((cmd, env))
        if cmd[1] == "which":
            name = cmd[2]
            return SimpleNamespace(stdout=str(binaries[name]) + "\n")
        version = "v24.21.0" if Path(cmd[0]) == binaries["node"] else "1.4.2"
        return SimpleNamespace(stdout=version + "\n")

    monkeypatch.setattr(utils.subprocess, "run", subprocess_run)
    runtime = utils.resolve_frontend_runtime()
    assert runtime.bun == binaries["bun"]
    assert [call[0] for call in calls[:2]] == [
        ["/tools/mise", "which", "node", "--tool", "node@24.21.0"],
        ["/tools/mise", "which", "bun", "--tool", "bun@1.4.2"],
    ]
    assert all(
        env["MISE_NOT_FOUND_AUTO_INSTALL"] == "false"
        and env["MISE_NOT_FOUND_SYSTEM_FALLBACK"] == "false"
        for _, env in calls[:2]
    )
    path = runtime.env["PATH"].split(os.pathsep)
    assert path[:3] == [
        str(frontend / "node_modules" / ".bin"),
        str(binaries["node"].parent),
        str(binaries["bun"].parent),
    ]
    assert calls[2][1]["PATH"] == calls[3][1]["PATH"] == runtime.env["PATH"]


@pytest.mark.parametrize("failure", ["missing_mise", "missing_node", "wrong_node", "wrong_bun"])
def test_missing_or_wrong_tools_fail_without_global_fallback(
    frontend: Path, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    binaries = {name: frontend.parent / "tools" / name for name in ("node", "bun")}
    for binary in binaries.values():
        if not (failure == "missing_node" and binary == binaries["node"]):
            binary.parent.mkdir(exist_ok=True)
            binary.touch()
    monkeypatch.setattr(
        utils.shutil, "which", lambda name: None if failure == "missing_mise" else "/tools/mise"
    )

    def subprocess_run(cmd: list[str], **_kwargs: object) -> SimpleNamespace:
        if cmd[1] == "which":
            return SimpleNamespace(stdout=str(binaries[cmd[2]]))
        name = "node" if Path(cmd[0]) == binaries["node"] else "bun"
        version = (
            "v24.20.0"
            if failure == "wrong_node" and name == "node"
            else (
                "1.4.1"
                if failure == "wrong_bun" and name == "bun"
                else "v24.21.0"
                if name == "node"
                else "1.4.2"
            )
        )
        return SimpleNamespace(stdout=version)

    monkeypatch.setattr(utils.subprocess, "run", subprocess_run)
    output = io.StringIO()
    assert utils.ensure_frontend_deps(out=output) is None
    assert "ERROR:" in output.getvalue()


def test_frozen_install_and_package_script_share_environment(
    frontend: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = utils.FrontendRuntime(frontend.parent / "tools" / "bun", {"PATH": "pinned"})
    monkeypatch.setattr(utils, "resolve_frontend_runtime", lambda: runtime)
    commands = Mock(return_value=(True, ""))
    monkeypatch.setattr(utils, "run_command", commands)
    assert utils.ensure_frontend_deps() == runtime
    assert runtime.run("test", "--run")
    assert commands.call_args_list[0].args == (
        [str(runtime.bun), "install", "--frozen-lockfile"],
        "bun install",
    )
    assert commands.call_args_list[1].args == (
        [str(runtime.bun), "run", "test", "--run"],
        "bun run test",
    )
    for call in commands.call_args_list:
        assert call.kwargs["env"] == runtime.env
        assert call.kwargs["cwd"] == frontend


def test_failed_frozen_install_prevents_frontend_command(
    frontend: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = utils.FrontendRuntime(frontend.parent / "bun", {"PATH": "pinned"})
    monkeypatch.setattr(utils, "resolve_frontend_runtime", lambda: runtime)
    monkeypatch.setattr(utils, "run_command", lambda *_args, **_kwargs: (False, "lock mismatch"))
    assert utils.ensure_frontend_deps() is None


def test_no_global_vp_fallback(frontend: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (frontend / "node_modules" / ".bin" / ("vp.exe" if os.name == "nt" else "vp")).unlink()
    runtime = utils.FrontendRuntime(frontend.parent / "bun", {"PATH": "pinned"})
    monkeypatch.setattr(utils, "resolve_frontend_runtime", lambda: runtime)
    monkeypatch.setattr(utils, "run_command", lambda *_args, **_kwargs: (True, ""))
    output = io.StringIO()
    assert utils.ensure_frontend_deps(out=output) is None
    assert "Local Vite+" in output.getvalue()


def test_parallel_commands_serialize_install(
    frontend: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = utils.FrontendRuntime(frontend.parent / "bun", {"PATH": "pinned"})
    monkeypatch.setattr(utils, "resolve_frontend_runtime", lambda: runtime)
    first_entered = threading.Event()
    release_first = threading.Event()
    calls = 0

    def install(*_args: object, **_kwargs: object) -> tuple[bool, str]:
        nonlocal calls
        calls += 1
        if calls == 1:
            first_entered.set()
            assert release_first.wait(timeout=5)
        return True, ""

    monkeypatch.setattr(utils, "run_command", install)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(utils.ensure_frontend_deps)
        assert first_entered.wait(timeout=5)
        second = pool.submit(utils.ensure_frontend_deps)
        assert calls == 1
        release_first.set()
        assert first.result() == second.result() == runtime
    assert calls == 2


def test_matching_dependency_versions_are_logged(
    frontend: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = utils.FrontendRuntime(frontend.parent / "bun", {"PATH": "pinned"})
    monkeypatch.setattr(utils, "resolve_frontend_runtime", lambda: runtime)
    monkeypatch.setattr(utils, "run_command", lambda *_args, **_kwargs: (True, ""))
    output = io.StringIO()
    assert utils.ensure_frontend_deps(out=output) == runtime
    assert (
        "Frontend dependency versions: vite-plus@1.0.0, vite@1.0.0, "
        "vitest@5.0.1, @vitest/coverage-v8@5.0.1"
    ) in output.getvalue()


@pytest.mark.parametrize(
    ("target", "section", "name", "version", "error"),
    [
        (
            "package.json",
            "overrides",
            "vitest",
            "4.1.11",
            "vitest: declared 5.0.1, but override selects 4.1.11",
        ),
        (
            "package.json",
            "devDependencies",
            "vite",
            "npm:@voidzero-dev/vite-plus-core@0.3.3",
            "vite: expected declaration npm:@voidzero-dev/vite-plus-core@1.0.0, "
            "got npm:@voidzero-dev/vite-plus-core@0.3.3",
        ),
        (
            "package.json",
            "overrides",
            "vite",
            "npm:@voidzero-dev/vite-plus-core@0.3.3",
            "vite: declared npm:@voidzero-dev/vite-plus-core@1.0.0, "
            "but override selects npm:@voidzero-dev/vite-plus-core@0.3.3",
        ),
        (
            "package.json",
            "devDependencies",
            "@vitest/coverage-v8",
            "5.0.2",
            "@vitest/coverage-v8: expected declaration 5.0.1, got 5.0.2",
        ),
        (
            "node_modules/vite-plus/package.json",
            "dependencies",
            "vitest",
            "4.1.11",
            "vite-plus@1.0.0 requires vitest 4.1.11, but the frontend declares 5.0.1",
        ),
        (
            "node_modules/vite-plus/package.json",
            "dependencies",
            "vite",
            "npm:@voidzero-dev/vite-plus-core@0.3.3",
            "vite-plus@1.0.0 requires vite npm:@voidzero-dev/vite-plus-core@0.3.3, "
            "but the frontend declares npm:@voidzero-dev/vite-plus-core@1.0.0",
        ),
    ],
)
def test_dependency_version_mismatches_prevent_frontend_command(
    frontend: Path,
    monkeypatch: pytest.MonkeyPatch,
    target: str,
    section: str,
    name: str,
    version: str,
    error: str,
) -> None:
    package_file = frontend / target
    package = json.loads(package_file.read_text(encoding="utf-8"))
    package[section][name] = version
    package_file.write_text(json.dumps(package), encoding="utf-8")
    runtime = utils.FrontendRuntime(frontend.parent / "bun", {"PATH": "pinned"})
    monkeypatch.setattr(utils, "resolve_frontend_runtime", lambda: runtime)
    commands = Mock(return_value=(True, ""))
    monkeypatch.setattr(utils, "run_command", commands)
    output = io.StringIO()
    assert utils.ensure_frontend_deps(out=output) is None
    assert error in output.getvalue()
    commands.assert_called_once()


def test_vite_plus_upgrade_requires_matching_core_alias(frontend: Path) -> None:
    manifest_file = frontend / "package.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    manifest["devDependencies"]["vite-plus"] = "1.0.1"
    manifest_file.write_text(json.dumps(manifest), encoding="utf-8")
    installed_file = frontend / "node_modules" / "vite-plus" / "package.json"
    installed = json.loads(installed_file.read_text(encoding="utf-8"))
    installed["version"] = "1.0.1"
    installed["dependencies"]["vite"] = "npm:@voidzero-dev/vite-plus-core@1.0.1"
    installed_file.write_text(json.dumps(installed), encoding="utf-8")
    output = io.StringIO()
    assert not utils._check_frontend_dependency_versions(frontend, output)
    assert (
        "vite: expected declaration npm:@voidzero-dev/vite-plus-core@1.0.1, "
        "got npm:@voidzero-dev/vite-plus-core@1.0.0"
    ) in output.getvalue()


@pytest.mark.parametrize("name", ["vite-plus", "vite", "vitest", "@vitest/coverage-v8"])
def test_installed_version_mismatch_is_rejected(frontend: Path, name: str) -> None:
    package_file = frontend / "node_modules" / name / "package.json"
    package = json.loads(package_file.read_text(encoding="utf-8"))
    package["version"] = "0.0.0"
    package_file.write_text(json.dumps(package), encoding="utf-8")
    output = io.StringIO()
    assert not utils._check_frontend_dependency_versions(frontend, output)
    assert f"installed {package['name']}@0.0.0" in output.getvalue()


def test_upstream_vite_cannot_replace_core_alias(frontend: Path) -> None:
    package_file = frontend / "node_modules" / "vite" / "package.json"
    package = json.loads(package_file.read_text(encoding="utf-8"))
    package["name"] = "vite"
    package_file.write_text(json.dumps(package), encoding="utf-8")
    output = io.StringIO()
    assert not utils._check_frontend_dependency_versions(frontend, output)
    assert "expected @voidzero-dev/vite-plus-core@1.0.0, installed vite@1.0.0" in output.getvalue()


def test_missing_installed_metadata_is_rejected(frontend: Path) -> None:
    (frontend / "node_modules" / "vitest" / "package.json").unlink()
    output = io.StringIO()
    assert not utils._check_frontend_dependency_versions(frontend, output)
    assert "Frontend dependency version check failed" in output.getvalue()
    assert "vitest" in output.getvalue()
