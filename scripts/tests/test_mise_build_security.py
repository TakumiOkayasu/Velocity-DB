"""Regression checks for the trusted local mise build-tool boundary (#757)."""

import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _lib import build


class MiseBuildSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / "mise.toml"
        self.config.write_text('[tools]\ncmake = "4.4.3"\nninja = "1.13.2"\n', encoding="utf-8")
        tool_dir = self.root / "tools with spaces & characters"
        tool_dir.mkdir()
        suffix = ".exe" if os.name == "nt" else ""
        self.binaries = {name: tool_dir / f"{name}{suffix}" for name in ("cmake", "ninja")}
        for binary in self.binaries.values():
            binary.touch()
        self.mise = str(self.root / f"mise{suffix}")
        self.env = {"PATH": "system-tools", "INCLUDE": "trusted-msvc-include"}
        self.out = io.StringIO()
        self.which = patch.object(build.shutil, "which", return_value=self.mise)
        self.which.start()
        self.addCleanup(self.which.stop)

    def resolve(self) -> tuple[Path, Path]:
        return build._resolve_mise_build_tools(self.root, self.env, self.out)

    def test_literal_argv_environment_and_exact_tool_selection(self) -> None:
        inherited = {"PATH": "trusted-mise-path", "MISE_DATA_DIR": "trusted-tool-store"}

        def run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            self.assertIsInstance(cmd, list)
            self.assertFalse(kwargs.get("shell", False))
            self.assertEqual(kwargs["cwd"], self.root)
            self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
            self.assertIs(kwargs["check"], True)
            if cmd[0] == self.mise:
                name = cmd[2]
                version = "4.4.3" if name == "cmake" else "1.13.2"
                self.assertEqual(cmd, [self.mise, "which", name, "--tool", f"{name}@{version}"])
                self.assertEqual(kwargs["timeout"], 30)
                self.assertEqual(
                    kwargs["env"],
                    inherited
                    | {
                        "MISE_NOT_FOUND_AUTO_INSTALL": "false",
                        "MISE_NOT_FOUND_SYSTEM_FALLBACK": "false",
                    },
                )
                return subprocess.CompletedProcess(cmd, 0, f"{self.binaries[name]}\n", "")
            self.assertIn(Path(cmd[0]), self.binaries.values())
            self.assertEqual(cmd[1:], ["--version"])
            self.assertIn(" & ", cmd[0])
            self.assertIs(kwargs["env"], self.env)
            self.assertEqual(kwargs["timeout"], 10)
            version = (
                "cmake version 4.4.3\n" if Path(cmd[0]) == self.binaries["cmake"] else "1.13.2\n"
            )
            return subprocess.CompletedProcess(cmd, 0, version, "")

        with (
            patch.dict(os.environ, inherited, clear=True),
            patch.object(build.subprocess, "run", side_effect=run) as mocked,
        ):
            self.assertEqual(self.resolve(), (self.binaries["cmake"], self.binaries["ninja"]))
            self.assertEqual(mocked.call_count, 4)
            self.assertEqual(dict(os.environ), inherited)
        self.assertEqual(self.env["INCLUDE"], "trusted-msvc-include")

    def test_invalid_versions_fail_before_starting_any_process(self) -> None:
        for version in ('"latest"', '"4.4"', '"4.4.3; extra-command"', "443"):
            self.config.write_text(f'[tools]\ncmake = {version}\nninja = "1.13.2"\n')
            with self.subTest(version=version), patch.object(build.subprocess, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "exact versions"):
                    self.resolve()
                run.assert_not_called()

    def test_missing_mise_fails_before_starting_any_process(self) -> None:
        with (
            patch.object(build.shutil, "which", return_value=None),
            patch.object(build.subprocess, "run") as run,
        ):
            with self.assertRaisesRegex(RuntimeError, "mise not found"):
                self.resolve()
            run.assert_not_called()

    def test_invalid_resolved_path_is_never_executed(self) -> None:
        for result in ("", "relative-cmake", str(self.root / "missing"), str(self.root)):
            with (
                self.subTest(result=result),
                patch.object(
                    build.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], 0, result, ""),
                ) as run,
            ):
                with self.assertRaisesRegex(RuntimeError, "no installed cmake executable"):
                    self.resolve()
                self.assertEqual(run.call_count, 1)
                self.assertEqual(self.env["PATH"], "system-tools")

    def test_failed_lookup_and_timeout_do_not_fall_back(self) -> None:
        for error in (
            subprocess.CalledProcessError(1, [self.mise]),
            subprocess.TimeoutExpired([self.mise], 30),
        ):
            with (
                self.subTest(error=error),
                patch.object(build.subprocess, "run", side_effect=error) as run,
            ):
                with self.assertRaisesRegex(RuntimeError, "mise install --locked cmake ninja"):
                    self.resolve()
                self.assertEqual(run.call_count, 1)
                self.assertEqual(self.env["PATH"], "system-tools")

    def test_version_mismatch_does_not_publish_tool_paths(self) -> None:
        with patch.object(
            build.subprocess,
            "run",
            side_effect=[
                subprocess.CompletedProcess([], 0, str(self.binaries["cmake"]), ""),
                subprocess.CompletedProcess([], 0, "cmake version 0.0.0", ""),
            ],
        ) as run:
            with self.assertRaisesRegex(RuntimeError, "cmake version mismatch"):
                self.resolve()
            self.assertEqual(run.call_count, 2)
            self.assertEqual(self.env["PATH"], "system-tools")


if __name__ == "__main__":
    unittest.main()
