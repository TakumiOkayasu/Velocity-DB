"""Tests for the shared frontend dependency bootstrap."""

import io
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath, PureWindowsPath
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
    monkeypatch.setattr(utils, "get_project_root", lambda: tmp_path)
    return directory


def test_finds_vp_even_when_bun_is_present(monkeypatch: pytest.MonkeyPatch) -> None:
    paths = {"vp": "/tools/vp", "bun": "/tools/bun"}
    monkeypatch.setattr(utils.shutil, "which", paths.get)

    assert utils.find_package_manager() == ("vp", Path("/tools/vp"))


@pytest.mark.parametrize(
    "tool_path", [PurePosixPath("/tools/vp"), PureWindowsPath(r"C:\tools\vp.exe")]
)
def test_frozen_install_reconciles_existing_modules_and_lock_changes(
    frontend: Path, monkeypatch: pytest.MonkeyPatch, tool_path: PurePosixPath | PureWindowsPath
) -> None:
    (frontend / "node_modules").mkdir()
    manager = ("vp", tool_path)
    monkeypatch.setattr(utils, "find_package_manager", lambda: manager)
    install = Mock(return_value=(True, ""))
    monkeypatch.setattr(utils, "run_command", install)

    assert utils.ensure_frontend_deps() == manager
    (frontend / "bun.lock").write_text("changed", encoding="utf-8")
    assert utils.ensure_frontend_deps() == manager
    assert install.call_count == 2
    install.assert_called_with(
        [str(tool_path), "install", "--frozen-lockfile"],
        "vp install",
        cwd=frontend,
        out=None,
    )


def test_missing_vp_stops_even_when_bun_is_present(
    frontend: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(utils.shutil, "which", lambda name: "/tools/bun" if name == "bun" else None)
    install = Mock(return_value=(True, ""))
    monkeypatch.setattr(utils, "run_command", install)
    output = io.StringIO()

    assert utils.ensure_frontend_deps(out=output) is None
    assert "Vite+ (vp) not found" in output.getvalue()
    install.assert_not_called()


def test_failed_frozen_install_prevents_frontend_command(
    frontend: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(utils, "find_package_manager", lambda: ("vp", Path("/tools/vp")))
    monkeypatch.setattr(utils, "run_command", lambda *_args, **_kwargs: (False, "lock mismatch"))

    assert utils.ensure_frontend_deps() is None


def test_parallel_commands_serialize_install(
    frontend: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(utils, "find_package_manager", lambda: ("vp", Path("/tools/vp")))
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
        assert first.result() == second.result() == ("vp", Path("/tools/vp"))
    assert calls == 2
