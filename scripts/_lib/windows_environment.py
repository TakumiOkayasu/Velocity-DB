"""Windows implementation of the build environment contract."""

import ctypes
import json
import os
import subprocess
from pathlib import Path
from typing import TextIO
from uuid import UUID

# Windows SDK Knownfolders.h identifier, not an installation path/configuration.
# https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid
FOLDERID_ProgramFilesX86 = UUID("7c5a40ef-a0fb-4bfc-874a-c0f2e0b9fa8e")
# Windows SDK libloaderapi.h: restrict DLL loading to the system directory.
LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800


def program_files_x86() -> Path:
    """Resolve the machine folder through Windows, never process environment or PATH."""
    # LOAD_LIBRARY_SEARCH_SYSTEM32 also keeps DLL lookup independent of cwd/PATH.
    shell32 = ctypes.WinDLL("shell32.dll", winmode=LOAD_LIBRARY_SEARCH_SYSTEM32)
    ole32 = ctypes.WinDLL("ole32.dll", winmode=LOAD_LIBRARY_SEARCH_SYSTEM32)
    get_path = shell32.SHGetKnownFolderPath
    get_path.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_wchar_p),
    ]
    get_path.restype = ctypes.c_int32  # HRESULT is signed 32-bit, including on x64.
    free = ole32.CoTaskMemFree
    free.argtypes = [ctypes.c_void_p]
    free.restype = None
    # FOLDERID_ProgramFilesX86 (machine-wide, including non-default system drives).
    folder_id = (ctypes.c_ubyte * 16).from_buffer_copy(FOLDERID_ProgramFilesX86.bytes_le)
    value = ctypes.c_wchar_p()
    try:
        result = get_path(ctypes.byref(folder_id), 0, None, ctypes.byref(value))
        if result != 0 or not value.value:
            raise OSError(
                f"Cannot resolve Program Files (x86): HRESULT 0x{result & 0xFFFFFFFF:08X}"
            )
        path = Path(value.value)
        if not path.is_absolute():
            raise OSError("Windows returned a non-absolute Program Files (x86) path")
        return path
    finally:
        free(value)


def find_vcvars(out: TextIO | None = None) -> Path | None:
    """Find the latest stable VS 2026 installation with the x64 C++ tools."""
    installer = program_files_x86()
    vswhere = installer / "Microsoft Visual Studio" / "Installer" / "vswhere.exe"
    if not vswhere.is_file():
        return None
    result = subprocess.run(
        [
            str(vswhere),
            "-latest",
            "-products",
            "*",
            "-version",
            "[18.0,19.0)",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-format",
            "json",
            "-utf8",
        ],
        capture_output=True,
        encoding="utf-8-sig",
        check=True,
    )
    installations = json.loads(result.stdout)
    if not installations:
        return None
    installation = installations[0]
    version = installation["installationVersion"]
    if version.split(".")[0] != "18" or installation.get("isPrerelease", False):
        raise RuntimeError("vswhere returned an unsupported Visual Studio installation")
    vcvars = Path(installation["installationPath"]) / "VC" / "Auxiliary" / "Build" / "vcvars64.bat"
    if not vcvars.is_file():
        return None
    print(f"Visual Studio: {version} (2026 Stable)", file=out)
    return vcvars


class WindowsMsvcEnvironment:
    """Activate the supported Windows C++ toolchain for a child process."""

    def activate(self, out: TextIO | None = None) -> dict[str, str]:
        """Get the x64 environment from the selected stable VS 2026 installation."""
        vcvars = find_vcvars(out=out)
        if not vcvars:
            print("ERROR: Visual Studio 2026 Stable with x64 C++ tools was not found", file=out)
            print("Install or modify VS 2026 / Build Tools using Visual Studio Installer", file=out)
            raise RuntimeError("Visual Studio 2026 Stable with x64 C++ tools was not found")
        print(f"Using MSVC from: {vcvars}", file=out)

        # Keep the batch path out of shell source. Expansion occurs once, inside quotes;
        # delayed expansion is disabled, and CALL (which expands a second time) is not used.
        child_env = os.environ.copy()
        child_env["VELOCITYDB_VCVARS"] = str(vcvars)
        result = subprocess.run(  # nosemgrep: python.lang.security.audit.subprocess-shell-true
            'setlocal DisableDelayedExpansion & "%VELOCITYDB_VCVARS%" && set',
            capture_output=True,
            text=True,
            shell=True,  # Fixed command; vswhere's file path is passed only via the environment.
            env=child_env,
        )
        if result.returncode != 0:
            print("ERROR: Failed to run vcvars64.bat", file=out)
            raise RuntimeError("Failed to activate the Visual Studio environment")
        env = {}
        for line in result.stdout.splitlines():
            if "=" in line and not line.startswith("="):
                key, _, value = line.partition("=")
                env[key] = value
        env.pop("VELOCITYDB_VCVARS", None)
        normalized = {key.upper(): value for key, value in env.items()}
        if normalized.get("VISUALSTUDIOVERSION", "").split(".")[0] != "18":
            raise RuntimeError("vcvars64.bat did not activate Visual Studio 2026")
        print(f"MSVC toolset: {normalized.get('VCTOOLSVERSION', 'unknown')}", file=out)
        print(f"Windows SDK: {normalized.get('WINDOWSSDKVERSION', 'unknown')}", file=out)
        return env
