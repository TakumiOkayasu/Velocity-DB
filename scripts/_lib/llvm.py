"""Resolve the repository's LLVM release without shell activation or installation."""

import os
import re
import shutil
import subprocess
import tomllib
from pathlib import Path

LLVM_TOOL = "github:llvm/llvm-project"


def resolve_clang_format(project_root: Path) -> Path:
    """Return the pinned binary, or fail before formatting any source files."""
    try:
        with (project_root / "mise.toml").open("rb") as config_file:
            version = tomllib.load(config_file)["tools"][LLVM_TOOL]["version"]
        if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
            raise ValueError("LLVM must be pinned to an exact release in mise.toml")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RuntimeError(f"Cannot read the LLVM version: {exc}") from exc

    mise = shutil.which("mise")
    if not mise:
        raise RuntimeError(
            "mise not found. Install mise, then run `mise trust` and "
            f"`mise install --locked {LLVM_TOOL}`."
        )

    # Scope lookup to this repository and this tool, never an unrelated PATH binary.
    env = os.environ | {
        "MISE_NOT_FOUND_AUTO_INSTALL": "false",
        "MISE_NOT_FOUND_SYSTEM_FALLBACK": "false",
    }
    try:
        result = subprocess.run(
            [mise, "which", "clang-format", "--tool", f"{LLVM_TOOL}@{version}"],
            cwd=project_root,
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            encoding="utf-8",
            check=True,
            timeout=30,
        )
        binary = Path(result.stdout.strip())
        if not binary.is_absolute() or not binary.is_file():
            raise ValueError("mise did not return an installed absolute executable path")
        # Trusted local mise selects the executable; this is not application input.
        # argv + shell=False (the default) preserves path metacharacters as data.
        # File/version checks are not authentication of a compromised local toolchain.
        result = subprocess.run(
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args
            [str(binary), "--version"],
            cwd=project_root,
            capture_output=True,
            encoding="utf-8",
            check=True,
            timeout=10,
        )
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise RuntimeError(
            f"LLVM {version} is unavailable. Run `mise trust` and "
            f"`mise install --locked {LLVM_TOOL}` "
            "in the repository root, then retry."
        ) from exc

    match = re.search(r"\bclang-format version (\S+)", result.stdout)
    if not match or match.group(1) != version:
        raise RuntimeError(
            f"clang-format version mismatch: expected {version}, got {result.stdout.strip()!r}"
        )
    return binary
