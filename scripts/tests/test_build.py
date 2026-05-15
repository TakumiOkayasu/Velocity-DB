"""Tests for build utilities."""

import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib import build as build_mod
from _lib.build import _ensure_vcpkg, _migrate_to_local_vcpkg, _read_vcpkg_baseline


def test_read_vcpkg_baseline_returns_sha(tmp_path: Path) -> None:
    sha = "abc123def4567890abc123def4567890abc12345"
    (tmp_path / "vcpkg.json").write_text(f'{{"builtin-baseline": "{sha}"}}')
    assert _read_vcpkg_baseline(tmp_path / "vcpkg.json") == sha


def test_read_vcpkg_baseline_returns_none_on_missing_field(tmp_path: Path) -> None:
    (tmp_path / "vcpkg.json").write_text('{"name": "test"}')
    assert _read_vcpkg_baseline(tmp_path / "vcpkg.json") is None


def test_read_vcpkg_baseline_returns_none_on_parse_error(tmp_path: Path) -> None:
    (tmp_path / "vcpkg.json").write_text("not json")
    assert _read_vcpkg_baseline(tmp_path / "vcpkg.json") is None


def test_read_vcpkg_baseline_returns_none_on_missing_file(tmp_path: Path) -> None:
    assert _read_vcpkg_baseline(tmp_path / "absent.json") is None


def _make_valid_vcpkg_dir(root: Path) -> None:
    """Create a minimal layout that _ensure_vcpkg considers 'already cloned'."""
    (root / "vcpkg" / "scripts" / "buildsystems").mkdir(parents=True)
    (root / "vcpkg" / "scripts" / "buildsystems" / "vcpkg.cmake").write_text("")
    (root / "vcpkg" / "vcpkg.exe").write_text("")


def test_ensure_vcpkg_skips_clone_and_bootstrap_when_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_valid_vcpkg_dir(tmp_path)
    (tmp_path / "vcpkg.json").write_text('{"builtin-baseline": "deadbeef"}')

    invoked: list[list[str]] = []

    def fake_run(cmd, desc, **_kwargs):
        invoked.append(list(cmd))
        return True, "deadbeef\n"

    monkeypatch.setattr(build_mod.utils, "run_command", fake_run)

    buf = io.StringIO()
    result = _ensure_vcpkg(tmp_path, out=buf)

    assert result == tmp_path / "vcpkg"
    flat = [c for cmd in invoked for c in cmd]
    assert "clone" not in flat, "clone must be skipped when vcpkg.cmake exists"
    assert all("bootstrap-vcpkg.bat" not in c for c in flat), (
        "bootstrap must be skipped when vcpkg.exe exists"
    )
    assert any("rev-parse" in c for c in flat), "drift check (rev-parse) should run"


def test_ensure_vcpkg_runs_clone_when_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    invoked: list[list[str]] = []

    def fake_run(cmd, desc, **_kwargs):
        invoked.append(list(cmd))
        # First call (clone) materializes the directory the next steps expect.
        if "clone" in cmd:
            _make_valid_vcpkg_dir(tmp_path)
        return True, "abc\n"

    monkeypatch.setattr(build_mod.utils, "run_command", fake_run)

    buf = io.StringIO()
    _ensure_vcpkg(tmp_path, out=buf)

    flat_cmds = [" ".join(cmd) for cmd in invoked]
    assert any("clone" in c and build_mod.VCPKG_REPO_URL in c for c in flat_cmds)
    assert "[vcpkg] Cloning" in buf.getvalue()


def test_ensure_vcpkg_raises_on_clone_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_run(cmd, desc, **_kwargs):
        if "clone" in cmd:
            return False, "network error"
        return True, ""

    monkeypatch.setattr(build_mod.utils, "run_command", fake_run)

    with pytest.raises(RuntimeError, match="clone vcpkg"):
        _ensure_vcpkg(tmp_path, out=io.StringIO())


def test_ensure_vcpkg_warns_on_baseline_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_valid_vcpkg_dir(tmp_path)
    (tmp_path / "vcpkg.json").write_text(
        '{"builtin-baseline": "01f602195983451bc83e72f4214af2cbc495aa94"}'
    )

    def fake_run(cmd, desc, **_kwargs):
        if "rev-parse" in cmd:
            return True, "ffffffffffffffffffffffffffffffffffffffff\n"
        return True, ""

    monkeypatch.setattr(build_mod.utils, "run_command", fake_run)

    buf = io.StringIO()
    _ensure_vcpkg(tmp_path, out=buf)

    output = buf.getvalue()
    assert "differs from clone HEAD" in output
    assert "01f602195983" in output
    assert "ffffffffffff" in output


def test_migrate_noop_when_no_install(tmp_path: Path) -> None:
    buf = io.StringIO()
    _migrate_to_local_vcpkg(tmp_path, out=buf)
    assert buf.getvalue() == ""


def test_migrate_noop_when_local_root(tmp_path: Path) -> None:
    info_dir = tmp_path / "build" / "vcpkg_installed" / "vcpkg"
    info_dir.mkdir(parents=True)
    (info_dir / "manifest-info.json").write_text(
        json.dumps({"vcpkg_root": str(tmp_path / "vcpkg")})
    )
    installed = tmp_path / "build" / "vcpkg_installed"

    buf = io.StringIO()
    _migrate_to_local_vcpkg(tmp_path, out=buf)

    assert installed.exists(), "local-root install must not be wiped"
    assert "Detected stale" not in buf.getvalue()


def test_migrate_wipes_when_foreign_root(tmp_path: Path) -> None:
    info_dir = tmp_path / "build" / "vcpkg_installed" / "vcpkg"
    info_dir.mkdir(parents=True)
    foreign = "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\vcpkg"
    (info_dir / "manifest-info.json").write_text(json.dumps({"vcpkg_root": foreign}))
    installed = tmp_path / "build" / "vcpkg_installed"

    buf = io.StringIO()
    _migrate_to_local_vcpkg(tmp_path, out=buf)

    assert not installed.exists(), "foreign-root install must be wiped"
    assert "Detected stale install" in buf.getvalue()


def test_migrate_noop_on_corrupt_json(tmp_path: Path) -> None:
    info_dir = tmp_path / "build" / "vcpkg_installed" / "vcpkg"
    info_dir.mkdir(parents=True)
    (info_dir / "manifest-info.json").write_text("not valid json")
    installed = tmp_path / "build" / "vcpkg_installed"

    buf = io.StringIO()
    _migrate_to_local_vcpkg(tmp_path, out=buf)

    assert installed.exists(), "corrupt manifest must not trigger wipe"


def test_migrate_noop_when_root_field_empty(tmp_path: Path) -> None:
    info_dir = tmp_path / "build" / "vcpkg_installed" / "vcpkg"
    info_dir.mkdir(parents=True)
    (info_dir / "manifest-info.json").write_text(json.dumps({"unrelated": "value"}))
    installed = tmp_path / "build" / "vcpkg_installed"

    buf = io.StringIO()
    _migrate_to_local_vcpkg(tmp_path, out=buf)

    assert installed.exists()
