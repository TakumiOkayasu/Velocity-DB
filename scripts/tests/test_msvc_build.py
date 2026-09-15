"""MSVC upgrades must invalidate PCH and object files before compilation."""

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib import build
from _lib.environment import BuildEnvironment
from _lib.windows_environment import WindowsMsvcEnvironment


class MsvcBuildTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.build_dir = self.root / "build"
        self.compiler = self.root / "toolset" / "cl.exe"
        self.compiler.parent.mkdir()
        for name in ("cl.exe", "c1xx.dll", "c2.dll"):
            self.compiler.with_name(name).write_bytes(b"old compiler")
        self.env = {"PATH": str(self.compiler.parent)}
        self.which = patch.object(build.shutil, "which", return_value=str(self.compiler))
        self.which.start()
        self.addCleanup(self.which.stop)
        self.pch = self.build_dir / "backend/CMakeFiles/VelocityDBCore.dir/cmake_pch.cxx.pch"
        self.pch.parent.mkdir(parents=True)
        self.pch.write_bytes(b"old PCH")
        self.obj = self.pch.with_name("ssh_tunnel.cpp.obj")
        self.obj.write_bytes(b"old object")
        self.stamp = self.build_dir / "msvc-fingerprint.json"
        self.fingerprint = build._msvc_fingerprint(self.env)
        self.stamp.write_text(self.fingerprint, encoding="utf-8")
        self.source = self.root / "frontend/dist/index.html"
        self.source.parent.mkdir(parents=True)
        self.source.write_text("frontend")

    def prepare(self) -> None:
        build._prepare_msvc_build(
            self.root, self.build_dir, build._msvc_fingerprint(self.env), io.StringIO()
        )

    def test_unchanged_compiler_keeps_incremental_outputs(self) -> None:
        self.prepare()
        self.assertTrue(self.pch.exists())
        self.assertTrue(self.obj.exists())

    def test_in_place_updates_remove_nested_pch_and_objects(self) -> None:
        for name in ("cl.exe", "c1xx.dll", "c2.dll"):
            with self.subTest(binary=name):
                binary = self.compiler.with_name(name)
                metadata = binary.stat()
                binary.write_bytes(b"new compiler")
                os.utime(binary, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
                self.prepare()
                self.assertFalse(self.build_dir.exists())
                self.assertTrue(self.source.exists())
                binary.write_bytes(b"old compiler")
                self.pch.parent.mkdir(parents=True)
                self.pch.write_bytes(b"old PCH")
                self.obj.write_bytes(b"old object")
                self.stamp.write_text(self.fingerprint, encoding="utf-8")

    def test_compiler_path_change_invalidates_outputs(self) -> None:
        moved = self.root / "new-toolset"
        moved.mkdir()
        for name in ("cl.exe", "c1xx.dll", "c2.dll"):
            (moved / name).write_bytes(b"old compiler")
        with patch.object(build.shutil, "which", return_value=str(moved / "cl.exe")):
            self.prepare()
        self.assertFalse(self.pch.exists())

    def test_legacy_and_corrupt_identity_rebuild(self) -> None:
        for identity in (None, "incomplete JSON"):
            with self.subTest(identity=identity):
                if identity is None:
                    self.stamp.unlink()
                else:
                    self.build_dir.mkdir()
                    self.stamp.write_text(identity)
                self.prepare()
                self.assertFalse(self.build_dir.exists())

    def test_missing_compiler_fails_before_cleanup(self) -> None:
        with (
            patch.object(build.shutil, "which", return_value=None),
            self.assertRaises(RuntimeError),
        ):
            self.prepare()
        self.assertTrue(self.pch.exists())

    def test_cached_compiler_change_removes_all_outputs(self) -> None:
        (self.build_dir / "CMakeCache.txt").write_text("CMAKE_CXX_COMPILER:FILEPATH=/old/cl.exe\n")
        build._clear_stale_cmake_cache(self.root, self.build_dir, self.env, out=io.StringIO())
        self.assertFalse(self.pch.exists())
        self.assertFalse(self.obj.exists())
        self.assertTrue(self.source.exists())

    @unittest.skipUnless(os.name == "nt", "Requires a Windows MSVC installation")
    def test_installed_msvc_identity_is_readable(self) -> None:
        self.which.stop()
        env = WindowsMsvcEnvironment().activate(out=io.StringIO())
        self.assertIn("c1xx.dll", build._msvc_fingerprint(env))

    def test_missing_compiler_dll_fails_before_cleanup(self) -> None:
        self.compiler.with_name("c1xx.dll").unlink()
        with self.assertRaises(OSError):
            self.prepare()
        self.assertTrue(self.pch.exists())

    def test_refuses_cleanup_outside_project(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "outside workspace"):
            build._prepare_msvc_build(self.root / "other-project", self.build_dir, "new")
        self.assertTrue(self.pch.exists())

    def test_backend_records_identity_only_after_configure(self) -> None:
        for configure_ok, compile_ok in ((False, False), (True, False), (True, True)):
            with self.subTest(configure_ok=configure_ok, compile_ok=compile_ok):
                self.compiler.write_bytes(b"new compiler")
                self.build_dir.mkdir(exist_ok=True)
                self.stamp.write_text(self.fingerprint, encoding="utf-8")
                calls = []
                environment = Mock(spec=BuildEnvironment)
                environment.activate.return_value = self.env.copy()

                def run(
                    cmd: list[str],
                    _description: str,
                    *,
                    calls: list[str] = calls,
                    configure_ok: bool = configure_ok,
                    compile_ok: bool = compile_ok,
                    **_kwargs: object,
                ) -> tuple[bool, str]:
                    if "--build" not in cmd:
                        self.assertFalse(self.build_dir.exists())
                        self.build_dir.mkdir()
                        calls.append("configure")
                        self.assertFalse(self.stamp.exists())
                        return configure_ok, ""
                    calls.append("build")
                    self.assertEqual(
                        self.stamp.read_text(encoding="utf-8"), build._msvc_fingerprint(self.env)
                    )
                    return compile_ok, ""

                with (
                    patch.object(build.utils, "get_project_root", return_value=self.root),
                    patch.object(build.utils, "check_build_tools", return_value=True),
                    patch.object(build, "_ensure_vcpkg", return_value=self.root / "vcpkg"),
                    patch.object(build, "_find_ninja", return_value=None),
                    patch.object(build.utils, "run_command", side_effect=run),
                    patch.object(build.utils, "clear_webview2_cache"),
                ):
                    self.assertEqual(
                        build.build_backend(
                            environment=environment, copy_frontend=False, out=io.StringIO()
                        ),
                        configure_ok and compile_ok,
                    )
                environment.activate.assert_called_once()
                self.assertEqual(calls, ["configure", "build"] if configure_ok else ["configure"])
                self.assertEqual(self.stamp.exists(), configure_ok)


if __name__ == "__main__":
    unittest.main()
