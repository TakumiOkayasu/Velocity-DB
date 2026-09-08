"""Regression tests for repository-pinned LLVM lookup."""

import io
import subprocess
import tomllib
from pathlib import Path
from unittest.mock import Mock

import pytest
from _lib import lint, llvm, utils


def test_checked_in_lock_covers_both_platforms() -> None:
    root = utils.get_project_root()
    config = tomllib.loads((root / "mise.toml").read_text(encoding="utf-8"))
    version = config["tools"][llvm.LLVM_TOOL]["version"]
    lock = tomllib.loads((root / "mise.lock").read_text(encoding="utf-8"))
    entries = lock["tools"][llvm.LLVM_TOOL]
    for platform in ("linux-x64", "windows-x64"):
        matches = [
            entry[f"platforms.{platform}"]
            for entry in entries
            if entry["version"] == version and f"platforms.{platform}" in entry
        ]
        assert len(matches) == 1, f"Missing or ambiguous LLVM lock for {platform}"
        artifact = matches[0]
        assert artifact["url"].startswith(
            f"https://github.com/llvm/llvm-project/releases/download/llvmorg-{version}/"
        )
        assert artifact["checksum"].startswith("sha256:")
        assert len(artifact["checksum"]) == len("sha256:") + 64


@pytest.fixture
def project(tmp_path: Path) -> Path:
    (tmp_path / "mise.toml").write_text(
        '[tools."github:llvm/llvm-project"]\nversion = "23.1.0"\n', encoding="utf-8"
    )
    return tmp_path


@pytest.fixture(params=["LLVM with spaces", "LLVM & echo injected", "LLVM ; $(echo injected)"])
def binary(project: Path, request: pytest.FixtureRequest) -> Path:
    path = project / request.param / "bin" / "clang-format.exe"
    path.parent.mkdir(parents=True)
    path.touch()
    return path


def test_resolves_exact_tool_from_repo_without_activation(
    project: Path, binary: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    which = Mock(return_value="mise.exe")
    run = Mock(
        side_effect=[
            subprocess.CompletedProcess([], 0, f"{binary}\n"),
            subprocess.CompletedProcess([], 0, "clang-format version 23.1.0\n"),
        ]
    )
    monkeypatch.setattr(llvm.shutil, "which", which)
    monkeypatch.setattr(llvm.subprocess, "run", run)
    monkeypatch.chdir(project.parent)

    assert llvm.resolve_clang_format(project) == binary
    which.assert_called_once_with("mise")
    lookup, version = run.call_args_list
    assert lookup.args[0] == [
        "mise.exe",
        "which",
        "clang-format",
        "--tool",
        "github:llvm/llvm-project@23.1.0",
    ]
    assert lookup.kwargs["cwd"] == project
    assert lookup.kwargs["env"]["MISE_NOT_FOUND_AUTO_INSTALL"] == "false"
    assert lookup.kwargs["env"]["MISE_NOT_FOUND_SYSTEM_FALLBACK"] == "false"
    assert lookup.kwargs["stdin"] == subprocess.DEVNULL
    assert version.args[0] == [str(binary), "--version"]
    assert lookup.kwargs.get("shell", False) is False
    assert version.kwargs.get("shell", False) is False


@pytest.mark.parametrize("suffix", [" --version", "; echo injected", " & echo injected"])
def test_rejects_command_text_after_existing_path(
    project: Path, binary: Path, monkeypatch: pytest.MonkeyPatch, suffix: str
) -> None:
    run = Mock(return_value=subprocess.CompletedProcess([], 0, f"{binary}{suffix}"))
    monkeypatch.setattr(llvm.shutil, "which", lambda _name: "mise")
    monkeypatch.setattr(llvm.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="unavailable"):
        llvm.resolve_clang_format(project)
    assert run.call_count == 1


@pytest.mark.parametrize("version", ["22.1.8", "23.1.0git", "23.1.0-rc3", "unknown"])
def test_rejects_wrong_or_unparseable_version(
    project: Path, binary: Path, monkeypatch: pytest.MonkeyPatch, version: str
) -> None:
    monkeypatch.setattr(llvm.shutil, "which", lambda _name: "mise")
    monkeypatch.setattr(
        llvm.subprocess,
        "run",
        Mock(
            side_effect=[
                subprocess.CompletedProcess([], 0, str(binary)),
                subprocess.CompletedProcess([], 0, f"clang-format version {version}"),
            ]
        ),
    )
    with pytest.raises(RuntimeError, match="version mismatch"):
        llvm.resolve_clang_format(project)


def test_missing_mise_does_not_fall_back_to_system_llvm(
    project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        llvm.shutil, "which", lambda name: None if name == "mise" else "/system/clang-format"
    )
    with pytest.raises(RuntimeError, match="mise not found"):
        llvm.resolve_clang_format(project)


@pytest.mark.parametrize(
    "failure",
    [
        subprocess.CalledProcessError(1, ["mise"]),
        subprocess.TimeoutExpired(["mise"], 30),
        FileNotFoundError("mise"),
    ],
)
def test_lookup_failure_stops_without_installing(
    project: Path, monkeypatch: pytest.MonkeyPatch, failure: Exception
) -> None:
    run = Mock(side_effect=failure)
    monkeypatch.setattr(llvm.shutil, "which", lambda _name: "mise")
    monkeypatch.setattr(llvm.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="mise install"):
        llvm.resolve_clang_format(project)
    assert run.call_count == 1


@pytest.mark.parametrize("path", ["clang-format", "/not-installed/clang-format"])
def test_rejects_missing_or_relative_binary(
    project: Path, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    run = Mock(return_value=subprocess.CompletedProcess([], 0, path))
    monkeypatch.setattr(llvm.shutil, "which", lambda _name: "mise")
    monkeypatch.setattr(llvm.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="unavailable"):
        llvm.resolve_clang_format(project)
    assert run.call_count == 1


@pytest.mark.parametrize(
    "pin",
    [
        '"latest"',
        '"23"',
        '"23.1"',
        "23",
        "[]",
        '"23.1.0; echo injected"',
        '"23.1.0 & echo injected"',
        '"23.1.0$(echo injected)"',
        '"23.1.0 --help"',
    ],
)
def test_rejects_non_exact_pin(project: Path, pin: str, monkeypatch: pytest.MonkeyPatch) -> None:
    run = Mock()
    monkeypatch.setattr(llvm.subprocess, "run", run)
    (project / "mise.toml").write_text(
        f'[tools."github:llvm/llvm-project"]\nversion = {pin}\n', encoding="utf-8"
    )
    with pytest.raises(RuntimeError, match="Cannot read the LLVM version"):
        llvm.resolve_clang_format(project)
    run.assert_not_called()


def test_lint_propagates_resolution_failure_before_fixing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lint, "resolve_clang_format", Mock(side_effect=RuntimeError("mismatch")))
    run = Mock()
    monkeypatch.setattr(lint.subprocess, "run", run)
    out = io.StringIO()
    assert not lint.lint_cpp(fix=True, out=out)
    assert "mismatch" in out.getvalue()
    run.assert_not_called()


@pytest.mark.parametrize("parallel", [False, True])
def test_combined_lint_propagates_cpp_failure(
    monkeypatch: pytest.MonkeyPatch, parallel: bool
) -> None:
    monkeypatch.setattr(lint, "lint_frontend", lambda **_kwargs: True)
    monkeypatch.setattr(lint, "resolve_clang_format", Mock(side_effect=RuntimeError("unavailable")))
    assert not lint.lint_all(parallel=parallel)
