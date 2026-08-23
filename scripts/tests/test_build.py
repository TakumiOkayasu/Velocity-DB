"""Tests for build utilities."""

import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib import build as build_mod
from _lib.build import _ensure_vcpkg, _migrate_to_local_vcpkg, _read_vcpkg_baseline


def test_build_all_runs_sequentially_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    monkeypatch.setattr(build_mod.utils, "get_project_root", lambda: tmp_path)
    monkeypatch.setattr(
        build_mod,
        "build_frontend",
        lambda **_kwargs: calls.append("frontend") or True,
    )
    monkeypatch.setattr(
        build_mod,
        "build_backend",
        lambda **_kwargs: calls.append("backend") or True,
    )

    assert build_mod.build_all()
    assert calls == ["frontend", "backend"]


def test_build_all_keeps_parallel_execution_as_opt_in(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[str, bool]] = []
    copied: list[str] = []

    monkeypatch.setattr(build_mod.utils, "get_project_root", lambda: tmp_path)

    def fake_frontend(*, clean: bool, out: io.StringIO) -> bool:
        calls.append(("frontend", clean))
        print("frontend output", file=out)
        return True

    def fake_backend(
        *,
        build_type: str,
        clean: bool,
        copy_frontend: bool,
        out: io.StringIO,
    ) -> bool:
        assert build_type == "Debug"
        assert not copy_frontend
        calls.append(("backend", clean))
        print("backend output", file=out)
        return True

    monkeypatch.setattr(build_mod, "build_frontend", fake_frontend)
    monkeypatch.setattr(build_mod, "build_backend", fake_backend)
    monkeypatch.setattr(
        build_mod,
        "_copy_frontend_to_build",
        lambda build_type: copied.append(build_type),
    )

    assert build_mod.build_all(build_type="Debug", clean=True, parallel=True)
    assert set(calls) == {("frontend", True), ("backend", True)}
    assert copied == ["Debug"]


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

    def fake_subprocess_run(cmd, **_kwargs):
        invoked.append(list(cmd))
        return build_mod.subprocess.CompletedProcess(cmd, 0, "deadbeef\n", "")

    monkeypatch.setattr(build_mod.utils, "run_command", fake_run)
    monkeypatch.setattr(build_mod.subprocess, "run", fake_subprocess_run)

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


def test_ensure_vcpkg_syncs_on_baseline_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_valid_vcpkg_dir(tmp_path)
    baseline = "01f602195983451bc83e72f4214af2cbc495aa94"
    (tmp_path / "vcpkg.json").write_text(f'{{"builtin-baseline": "{baseline}"}}')

    invoked: list[list[str]] = []

    def fake_run(cmd, desc, **_kwargs):
        invoked.append(list(cmd))
        return True, ""

    def fake_subprocess_run(cmd, **_kwargs):
        invoked.append(list(cmd))
        return build_mod.subprocess.CompletedProcess(
            cmd, 0, "ffffffffffffffffffffffffffffffffffffffff\n", ""
        )

    monkeypatch.setattr(build_mod.utils, "run_command", fake_run)
    monkeypatch.setattr(build_mod.subprocess, "run", fake_subprocess_run)

    buf = io.StringIO()
    _ensure_vcpkg(tmp_path, out=buf)

    flat = [" ".join(cmd) for cmd in invoked]
    assert any("fetch" in c and baseline in c for c in flat), (
        "drift should trigger git fetch of baseline"
    )
    assert any("checkout" in c and baseline in c for c in flat), (
        "drift should trigger git checkout of baseline"
    )
    assert any("bootstrap-vcpkg.bat" in c for c in flat), (
        "post-sync bootstrap should re-run for port-tool integrity"
    )
    assert "Syncing clone to baseline" in buf.getvalue()


def test_ensure_vcpkg_reports_error_on_fetch_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_valid_vcpkg_dir(tmp_path)
    baseline = "01f602195983451bc83e72f4214af2cbc495aa94"
    (tmp_path / "vcpkg.json").write_text(f'{{"builtin-baseline": "{baseline}"}}')

    def fake_run(cmd, desc, **_kwargs):
        if "fetch" in cmd:
            return False, "network error"
        return True, ""

    def fake_subprocess_run(cmd, **_kwargs):
        return build_mod.subprocess.CompletedProcess(
            cmd, 0, "ffffffffffffffffffffffffffffffffffffffff\n", ""
        )

    monkeypatch.setattr(build_mod.utils, "run_command", fake_run)
    monkeypatch.setattr(build_mod.subprocess, "run", fake_subprocess_run)

    buf = io.StringIO()
    with pytest.raises(RuntimeError, match="Failed to sync project-local vcpkg"):
        _ensure_vcpkg(tmp_path, out=buf)

    assert "failed to fetch baseline" in buf.getvalue()


def test_ensure_vcpkg_rejects_invalid_clone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_valid_vcpkg_dir(tmp_path)
    (tmp_path / "vcpkg.json").write_text('{"builtin-baseline": "deadbeef"}')

    def fake_subprocess_run(cmd, **_kwargs):
        return build_mod.subprocess.CompletedProcess(cmd, 128, "", "not a git repository")

    monkeypatch.setattr(build_mod.subprocess, "run", fake_subprocess_run)

    buf = io.StringIO()
    with pytest.raises(RuntimeError, match="Failed to sync project-local vcpkg"):
        _ensure_vcpkg(tmp_path, out=buf)

    assert "invalid project-local clone" in buf.getvalue()


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
