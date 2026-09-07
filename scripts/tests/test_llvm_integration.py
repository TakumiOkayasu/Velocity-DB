"""Opt-in tests against the installed official LLVM artifacts on Windows and Linux."""

import hashlib
import json
import os
import subprocess
from pathlib import Path

import pytest
from _lib import lint, llvm, utils

pytestmark = pytest.mark.skipif(
    os.environ.get("VELOCITYDB_TEST_LLVM") != "1", reason="requires mise install"
)


def test_official_llvm_without_activation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = utils.get_project_root()
    # Simulate an unrelated LLVM ahead of the managed installation on PATH.
    for name in ("clang-format", "clang-format.exe"):
        fake = tmp_path / name
        fake.write_text("not an executable\n", encoding="utf-8")
        fake.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path) + os.pathsep + os.environ["PATH"])
    monkeypatch.chdir(tmp_path)
    binary = llvm.resolve_clang_format(root)
    assert binary.parent != tmp_path
    assert lint.lint_cpp()

    # Identical LF inputs produce a per-source digest manifest for cross-OS comparison.
    manifest = {}
    sources = sorted(
        path for path in (root / "backend").rglob("*") if path.suffix in {".cpp", ".h"}
    )
    assert sources
    for source in sources:
        data = source.read_bytes().removeprefix(b"\xef\xbb\xbf").replace(b"\r\n", b"\n")
        formatted = subprocess.run(
            [str(binary), "--style=file", f"--assume-filename={source}"],
            input=data,
            capture_output=True,
            check=True,
        ).stdout
        manifest[source.relative_to(root).as_posix()] = hashlib.sha256(formatted).hexdigest()
    output = os.environ.get("VELOCITYDB_FORMAT_MANIFEST")
    if output:
        Path(output).write_text(
            json.dumps(manifest, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
        )


@pytest.mark.parametrize("newline", [b"\n", b"\r\n"])
@pytest.mark.parametrize("bom", [b"", b"\xef\xbb\xbf"])
def test_preserves_line_endings_and_bom(newline: bytes, bom: bytes) -> None:
    root = utils.get_project_root()
    binary = llvm.resolve_clang_format(root)
    source = bom + newline.join([b"int main(){", b"return 0;", b"}", b""])
    result = subprocess.run(
        [str(binary), "--style=file", f"--assume-filename={root / 'backend' / 'sample.cpp'}"],
        input=source,
        capture_output=True,
        check=True,
    )
    assert result.stdout == bom + newline.join([b"int main() {", b"    return 0;", b"}", b""])
