"""Tests for backend CTest commands shared by local and CI runs."""

from pathlib import Path
from unittest.mock import Mock

import pytest
from _lib import build as build_mod
from _lib import test as test_mod


@pytest.mark.parametrize("build_type", ["Debug", "Release"])
def test_backend_runs_suite_then_csv_repeat_with_same_environment(
    build_type: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "build").mkdir()
    monkeypatch.setattr(test_mod.utils, "get_project_root", lambda: tmp_path)
    environment = Mock()
    environment.activate.return_value = {"Path": "msvc"}
    commands: list[list[str]] = []

    def run(cmd: list[str], _label: str, **kwargs: object) -> tuple[bool, str]:
        assert kwargs["env"] is environment.activate.return_value
        assert kwargs["cwd"] == tmp_path
        commands.append(cmd)
        return True, ""

    monkeypatch.setattr(test_mod.utils, "run_command", run)

    assert test_mod.test_backend(build_type=build_type, environment=environment)
    environment.activate.assert_called_once()
    assert commands == [
        [
            "ctest",
            "--preset",
            build_type.lower(),
            "--output-on-failure",
            "--parallel",
            "-LE",
            "perf",
            "--no-tests=error",
        ],
        [
            "ctest",
            "--preset",
            build_type.lower(),
            "--output-on-failure",
            "-R",
            r"^CSVExporterTest\.",
            "--parallel",
            "5",
            "--repeat",
            "until-fail:20",
            "--no-tests=error",
        ],
    ]


@pytest.mark.parametrize("failure_at", [0, 1])
def test_backend_fails_on_suite_or_repeat_failure(
    failure_at: int, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "build").mkdir()
    monkeypatch.setattr(test_mod.utils, "get_project_root", lambda: tmp_path)
    commands: list[list[str]] = []

    def run(cmd: list[str], _label: str, **_kwargs: object) -> tuple[bool, str]:
        commands.append(cmd)
        return len(commands) - 1 != failure_at, ""

    monkeypatch.setattr(test_mod.utils, "run_command", run)

    assert not test_mod.test_backend(environment=Mock())
    assert len(commands) == failure_at + 1


def test_benchmark_does_not_repeat_csv_tests(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "build").mkdir()
    monkeypatch.setattr(test_mod.utils, "get_project_root", lambda: tmp_path)
    commands: list[list[str]] = []

    def run(cmd: list[str], _label: str, **_kwargs: object) -> tuple[bool, str]:
        commands.append(cmd)
        return True, ""

    monkeypatch.setattr(test_mod.utils, "run_command", run)

    assert test_mod.bench_backend(environment=Mock())
    assert commands == [
        ["ctest", "--preset", "release", "--output-on-failure", "-L", "perf", "--no-tests=error"]
    ]


def test_backend_prefers_uv_managed_ctest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "build").mkdir()
    scripts_dir = tmp_path / "venv" / "Scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "cmake.exe").touch()
    (scripts_dir / "ninja.exe").touch()
    monkeypatch.setattr(test_mod.utils, "get_project_root", lambda: tmp_path)
    monkeypatch.setattr(build_mod.sysconfig, "get_path", lambda _name: str(scripts_dir))
    environment = Mock()
    environment.activate.return_value = {"Path": r"C:\VS\CMake\bin;C:\Windows"}
    observed_paths: list[str] = []

    def run(_cmd: list[str], _label: str, **kwargs: object) -> tuple[bool, str]:
        observed_paths.append(kwargs["env"]["Path"])
        return True, ""

    monkeypatch.setattr(test_mod.utils, "run_command", run)

    assert test_mod.test_backend(environment=environment)
    assert observed_paths == [
        rf"{scripts_dir};C:\VS\CMake\bin;C:\Windows",
        rf"{scripts_dir};C:\VS\CMake\bin;C:\Windows",
    ]
