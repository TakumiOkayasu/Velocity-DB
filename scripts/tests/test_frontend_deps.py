"""Tests for the pinned frontend runtime and frozen dependency bootstrap."""

import io
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
    (directory / "package.json").write_text('{"name": "frontend"}', encoding="utf-8")
    (directory / "bun.lock").write_text("lock", encoding="utf-8")
    local_bin = directory / "node_modules" / ".bin"
    local_bin.mkdir(parents=True)
    local_vp = local_bin / ("vp.cmd" if os.name == "nt" else "vp")
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
    (frontend / "node_modules" / ".bin" / ("vp.cmd" if os.name == "nt" else "vp")).unlink()
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
