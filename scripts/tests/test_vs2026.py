"""VS 2026 selection and the shared local/CI environment boundary."""

import io
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import setup_msvc_ci
from _lib import utils


@pytest.fixture
def installation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("PROGRAMFILES(X86)", str(tmp_path / "installer-root"))
    vswhere = tmp_path / "installer-root/Microsoft Visual Studio/Installer/vswhere.exe"
    vswhere.parent.mkdir(parents=True)
    vswhere.touch()
    root = tmp_path / "Custom & Tools/BuildTools"
    vcvars = root / "VC/Auxiliary/Build/vcvars64.bat"
    vcvars.parent.mkdir(parents=True)
    vcvars.touch()
    return root


def discovery(root: Path, version: str = "18.10.12201.205", preview: bool = False) -> str:
    return json.dumps(
        [{"installationPath": str(root), "installationVersion": version, "isPrerelease": preview}]
    )


def test_selects_latest_stable_cpp_installation(installation: Path) -> None:
    with patch.object(utils.subprocess, "run") as run:
        run.return_value = subprocess.CompletedProcess([], 0, discovery(installation), "")
        output = io.StringIO()
        assert utils.find_vcvars(out=output) == installation / "VC/Auxiliary/Build/vcvars64.bat"
    command = run.call_args.args[0]
    assert command[command.index("-version") + 1] == "[18.0,19.0)"
    assert (
        command[command.index("-requires") + 1]
        == "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"
    )
    assert command[command.index("-products") + 1] == "*"
    assert "-latest" in command
    assert "-prerelease" not in command
    assert run.call_args.kwargs["check"]
    assert run.call_args.kwargs["encoding"] == "utf-8-sig"
    assert "18.10.12201.205" in output.getvalue()


@pytest.mark.parametrize(
    "version,preview", [("17.14.0", False), ("19.0.0", False), ("18.11.0", True)]
)
def test_rejects_old_future_and_preview_installations(
    installation: Path, version: str, preview: bool
) -> None:
    result = subprocess.CompletedProcess([], 0, discovery(installation, version, preview), "")
    with (
        patch.object(utils.subprocess, "run", return_value=result),
        pytest.raises(RuntimeError, match="unsupported"),
    ):
        utils.find_vcvars()


def test_no_matching_installation_has_no_path_fallback(installation: Path) -> None:
    result = subprocess.CompletedProcess([], 0, "[]", "")
    with patch.object(utils.subprocess, "run", return_value=result):
        assert utils.find_vcvars() is None


def test_missing_vswhere_does_not_search_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PROGRAMFILES(X86)", str(tmp_path))
    with patch.object(utils.subprocess, "run") as run:
        assert utils.find_vcvars() is None
        run.assert_not_called()


def test_missing_batch_file_is_rejected(installation: Path) -> None:
    (installation / "VC/Auxiliary/Build/vcvars64.bat").unlink()
    result = subprocess.CompletedProcess([], 0, discovery(installation), "")
    with patch.object(utils.subprocess, "run", return_value=result):
        assert utils.find_vcvars() is None


def test_vswhere_failure_is_not_treated_as_missing_installation(installation: Path) -> None:
    with (
        patch.object(
            utils.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "vswhere")
        ),
        pytest.raises(subprocess.CalledProcessError),
    ):
        utils.find_vcvars()


def test_batch_path_is_data_and_environment_values_keep_equals(installation: Path) -> None:
    vcvars = installation / "VC/Auxiliary/Build/vcvars64.bat"
    result = subprocess.CompletedProcess(
        [], 0, "VisualStudioVersion=18.0\nVCToolsVersion=14.51\nVALUE=a=b\n", ""
    )
    with (
        patch.object(utils, "find_vcvars", return_value=vcvars),
        patch.object(utils.subprocess, "run", return_value=result) as run,
    ):
        env = utils.get_msvc_env(out=io.StringIO())
    assert str(vcvars) not in run.call_args.args[0]
    assert run.call_args.kwargs["env"]["VELOCITYDB_VCVARS"] == str(vcvars)
    assert "DisableDelayedExpansion" in run.call_args.args[0]
    assert "call " not in run.call_args.args[0].lower()
    assert env["VALUE"] == "a=b"
    assert "VELOCITYDB_VCVARS" not in env


def test_failed_batch_stops(installation: Path) -> None:
    with (
        patch.object(utils, "find_vcvars", return_value=installation),
        patch.object(
            utils.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "")
        ),
        pytest.raises(SystemExit) as failure,
    ):
        utils.get_msvc_env(out=io.StringIO())
    assert failure.value.code == 1


def test_ci_exports_only_changed_values(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "github-env"
    monkeypatch.setenv("GITHUB_ENV", str(target))
    monkeypatch.setenv("UNCHANGED", "keep")
    monkeypatch.setenv("IMAGEVERSION", "20260907.1")
    monkeypatch.setenv("VCTOOLSVERSION", "14.51")
    with patch.object(
        setup_msvc_ci,
        "get_msvc_env",
        return_value={"UNCHANGED": "keep", "LIB": "x=y", "VCToolsVersion": "14.51"},
    ):
        setup_msvc_ci.main()
    lines = target.read_text().splitlines()
    assert "UNCHANGED" not in target.read_text()
    assert lines[0] == f"LIB<<{lines[2]}"
    assert lines[1] == "x=y"
    assert "vs2026-20260907.1-14.51" in lines


@pytest.mark.skipif(os.name != "nt", reason="Requires Windows and installed VS 2026")
def test_real_vs2026_compiles_cpp(tmp_path: Path) -> None:
    env = utils.get_msvc_env()
    source = tmp_path / "smoke.cpp"
    source.write_text("#include <iostream>\nint main() { std::cout << _MSC_VER; }\n")
    subprocess.run(
        ["cl.exe", "/nologo", "/EHsc", str(source), "/Fe:smoke.exe"],
        cwd=tmp_path,
        env=env,
        check=True,
    )
    result = subprocess.run(
        [str(tmp_path / "smoke.exe")], capture_output=True, text=True, check=True
    )
    assert int(result.stdout) >= 1950


@pytest.mark.skipif(os.name != "nt", reason="Requires cmd.exe")
def test_batch_path_with_shell_characters(tmp_path: Path) -> None:
    folder = tmp_path / "VS & %PATH% !tools"
    folder.mkdir()
    batch = folder / "vcvars64.bat"
    batch.write_text(
        "@echo off\nset VisualStudioVersion=18.0\nset VCToolsVersion=14.51\n", encoding="ascii"
    )
    with patch.object(utils, "find_vcvars", return_value=batch):
        assert utils.get_msvc_env()["VCToolsVersion"] == "14.51"
