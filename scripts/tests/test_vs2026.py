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
from _lib import windows_environment as utils


@pytest.fixture
def installation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(utils, "program_files_x86", lambda: tmp_path / "installer-root")
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
    monkeypatch.setattr(utils, "program_files_x86", lambda: tmp_path)
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
        env = utils.WindowsMsvcEnvironment().activate(out=io.StringIO())
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
        pytest.raises(RuntimeError, match="Failed to activate"),
    ):
        utils.WindowsMsvcEnvironment().activate(out=io.StringIO())


def test_ci_exports_only_changed_values(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "github-env"
    monkeypatch.setenv("GITHUB_ENV", str(target))
    monkeypatch.setenv("UNCHANGED", "keep")
    monkeypatch.setenv("IMAGEVERSION", "20260907.1")
    monkeypatch.setenv("VCTOOLSVERSION", "14.51")
    with patch.object(
        utils.WindowsMsvcEnvironment,
        "activate",
        return_value={"UNCHANGED": "keep", "LIB": "x=y", "VCToolsVersion": "14.51"},
    ):
        setup_msvc_ci.main(utils.WindowsMsvcEnvironment())
    lines = target.read_text().splitlines()
    assert "UNCHANGED" not in target.read_text()
    assert lines[0] == f"LIB<<{lines[2]}"
    assert lines[1] == "x=y"
    assert "vs2026-20260907.1-14.51" in lines


@pytest.mark.skipif(os.name != "nt", reason="Requires Windows and installed VS 2026")
def test_real_vs2026_compiles_cpp(tmp_path: Path) -> None:
    env = utils.WindowsMsvcEnvironment().activate()
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
        env = {
            key.upper(): value for key, value in utils.WindowsMsvcEnvironment().activate().items()
        }
        assert env["VCTOOLSVERSION"] == "14.51"


def test_environment_cannot_redirect_vswhere(
    installation: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = tmp_path / "untrusted/Microsoft Visual Studio/Installer/vswhere.exe"
    fake.parent.mkdir(parents=True)
    fake.touch()
    monkeypatch.setenv("PROGRAMFILES(X86)", str(tmp_path / "untrusted"))
    monkeypatch.setenv("PATH", str(fake.parent))
    result = subprocess.CompletedProcess([], 0, discovery(installation), "")
    with patch.object(utils.subprocess, "run", return_value=result) as run:
        assert utils.find_vcvars() == installation / "VC/Auxiliary/Build/vcvars64.bat"
    assert Path(run.call_args.args[0][0]) == (
        tmp_path / "installer-root/Microsoft Visual Studio/Installer/vswhere.exe"
    )


def test_folder_lookup_failure_does_not_launch_subprocess() -> None:
    with (
        patch.object(utils, "program_files_x86", side_effect=OSError("lookup failed")),
        patch.object(utils.subprocess, "run") as run,
        pytest.raises(OSError, match="lookup failed"),
    ):
        utils.find_vcvars()
    run.assert_not_called()


@pytest.mark.skipif(os.name != "nt", reason="Requires Windows Known Folder API and VS 2026")
def test_real_discovery_ignores_programfiles_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    expected = utils.find_vcvars()
    assert expected is not None
    monkeypatch.setenv("PROGRAMFILES(X86)", str(tmp_path / "untrusted"))
    assert utils.find_vcvars() == expected


@pytest.mark.parametrize(
    "status,folder", [(0, "valid"), (-2147467259, "valid"), (0, ""), (0, "relative")]
)
def test_known_folder_api_releases_memory_and_rejects_invalid_results(
    tmp_path: Path, status: int, folder: str
) -> None:
    import ctypes
    from unittest.mock import Mock
    from uuid import UUID

    text = str(tmp_path / "Program Files (x86) 日本語") if folder == "valid" else folder
    buffer = ctypes.create_unicode_buffer(text)
    shell32, ole32 = Mock(), Mock()

    def get_path(folder_id: object, flags: int, token: object, output: object) -> int:
        assert (
            ctypes.string_at(folder_id, 16) == UUID("7c5a40ef-a0fb-4bfc-874a-c0f2e0b9fa8e").bytes_le
        )
        assert flags == 0 and token is None
        ctypes.cast(output, ctypes.POINTER(ctypes.c_wchar_p))[0] = ctypes.cast(
            buffer, ctypes.c_wchar_p
        )
        return status

    shell32.SHGetKnownFolderPath.side_effect = get_path
    with patch.object(ctypes, "WinDLL", side_effect=[shell32, ole32], create=True) as load:
        if status == 0 and folder == "valid":
            assert utils.program_files_x86() == Path(text)
        else:
            with pytest.raises(OSError):
                utils.program_files_x86()
    assert [call.args[0] for call in load.call_args_list] == ["shell32.dll", "ole32.dll"]
    assert all(call.kwargs == {"winmode": 0x00000800} for call in load.call_args_list)
    ole32.CoTaskMemFree.assert_called_once()
    assert ctypes.cast(ole32.CoTaskMemFree.call_args.args[0], ctypes.c_void_p).value == (
        ctypes.addressof(buffer)
    )


@pytest.mark.parametrize("command", ["test_backend", "bench_backend"])
def test_backend_commands_use_injected_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, command: str
) -> None:
    from _lib import test as commands

    class FakeEnvironment:
        def activate(self, out: object = None) -> dict[str, str]:
            return {"TEST_TOOLCHAIN": "injected"}

    (tmp_path / "build").mkdir()
    monkeypatch.setattr(commands.utils, "get_project_root", lambda: tmp_path)
    with patch.object(commands.utils, "run_command", return_value=(True, "")) as run:
        assert getattr(commands, command)(environment=FakeEnvironment())
    assert run.call_args.kwargs["env"] == {"TEST_TOOLCHAIN": "injected"}


def test_activation_failure_prevents_test_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from _lib import test as commands

    class FailingEnvironment:
        def activate(self, out: object = None) -> dict[str, str]:
            raise RuntimeError("activation failed")

    (tmp_path / "build").mkdir()
    monkeypatch.setattr(commands.utils, "get_project_root", lambda: tmp_path)
    with patch.object(commands.utils, "run_command") as run, pytest.raises(RuntimeError):
        commands.test_backend(environment=FailingEnvironment())
    run.assert_not_called()
