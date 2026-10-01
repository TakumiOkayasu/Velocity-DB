"""Tests for backend CTest commands shared by local and CI runs."""

from pathlib import Path
from unittest.mock import Mock

import pytest
from _lib import test as test_mod


@pytest.fixture
def mise_ctest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Resolve backend tests through the repository-pinned mise CMake."""
    cmake = tmp_path / "mise" / "bin" / "cmake"
    ninja = tmp_path / "mise" / "bin" / "ninja"
    cmake.parent.mkdir(parents=True)
    cmake.touch()
    ninja.touch()
    monkeypatch.setattr(
        test_mod, "_resolve_mise_build_tools", lambda *_args, **_kwargs: (cmake, ninja)
    )
    return cmake.with_name("ctest")


@pytest.mark.parametrize("build_type", ["Debug", "Release"])
def test_backend_runs_suite_then_csv_repeat_with_same_environment(
    build_type: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mise_ctest: Path,
) -> None:
    (tmp_path / "build").mkdir()
    monkeypatch.setattr(test_mod.utils, "get_project_root", lambda: tmp_path)
    environment = Mock()
    environment.activate.return_value = {"PATH": "msvc"}
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
            str(mise_ctest),
            "--preset",
            build_type.lower(),
            "--output-on-failure",
            "--parallel",
            "-LE",
            "perf",
            "--no-tests=error",
        ],
        [
            str(mise_ctest),
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
    failure_at: int,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mise_ctest: Path,
) -> None:
    (tmp_path / "build").mkdir()
    monkeypatch.setattr(test_mod.utils, "get_project_root", lambda: tmp_path)
    commands: list[list[str]] = []

    def run(cmd: list[str], _label: str, **_kwargs: object) -> tuple[bool, str]:
        commands.append(cmd)
        return len(commands) - 1 != failure_at, ""

    monkeypatch.setattr(test_mod.utils, "run_command", run)

    environment = Mock()
    environment.activate.return_value = {"PATH": "msvc"}
    assert not test_mod.test_backend(environment=environment)
    assert len(commands) == failure_at + 1
    assert all(command[0] == str(mise_ctest) for command in commands)


def test_benchmark_does_not_repeat_csv_tests(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mise_ctest: Path,
) -> None:
    (tmp_path / "build").mkdir()
    monkeypatch.setattr(test_mod.utils, "get_project_root", lambda: tmp_path)
    commands: list[list[str]] = []

    def run(cmd: list[str], _label: str, **_kwargs: object) -> tuple[bool, str]:
        commands.append(cmd)
        return True, ""

    monkeypatch.setattr(test_mod.utils, "run_command", run)

    environment = Mock()
    environment.activate.return_value = {"PATH": "msvc"}
    assert test_mod.bench_backend(environment=environment)
    assert commands == [
        [
            str(mise_ctest),
            "--preset",
            "release",
            "--output-on-failure",
            "-L",
            "perf",
            "--no-tests=error",
        ]
    ]


def test_backend_uses_mise_managed_ctest(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mise_ctest: Path,
) -> None:
    (tmp_path / "build").mkdir()
    monkeypatch.setattr(test_mod.utils, "get_project_root", lambda: tmp_path)
    environment = Mock()
    environment.activate.return_value = {"PATH": "system-tools"}
    commands: list[list[str]] = []

    def run(cmd: list[str], _label: str, **kwargs: object) -> tuple[bool, str]:
        assert kwargs["env"] is environment.activate.return_value
        commands.append(cmd)
        return True, ""

    monkeypatch.setattr(test_mod.utils, "run_command", run)

    assert test_mod.test_backend(environment=environment)
    assert [command[0] for command in commands] == [str(mise_ctest), str(mise_ctest)]
