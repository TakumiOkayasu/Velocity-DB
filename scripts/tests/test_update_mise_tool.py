"""The upgrade job must change Bun without disturbing the LLVM or Node pins."""

import tomllib
from pathlib import Path

import pytest

from scripts.update_mise_tool import current_version, update_version


def test_update_bun_preserves_other_tools(tmp_path: Path) -> None:
    config = tmp_path / "mise.toml"
    config.write_text(
        '[tools]\nnode = "24.21.0"\nbun = "1.4.2"\n\n'
        '[tools."github:llvm/llvm-project"]\nversion = "23.1.1"\n',
        encoding="utf-8",
    )

    assert current_version(config, "bun") == "1.4.2"
    update_version(config, "bun", "1.4.3")

    assert tomllib.loads(config.read_text(encoding="utf-8"))["tools"] == {
        "node": "24.21.0",
        "bun": "1.4.3",
        "github:llvm/llvm-project": {"version": "23.1.1"},
    }


@pytest.mark.parametrize("version", ["latest", "1.4.3-rc.1", "1.4.3\nnode = 'bad'"])
def test_rejects_non_exact_versions(tmp_path: Path, version: str) -> None:
    config = tmp_path / "mise.toml"
    original = '[tools]\nbun = "1.4.2"\n'
    config.write_text(original, encoding="utf-8")

    with pytest.raises(ValueError, match="exact bun release"):
        update_version(config, "bun", version)

    assert config.read_text(encoding="utf-8") == original


def test_rejects_missing_bun_pin(tmp_path: Path) -> None:
    config = tmp_path / "mise.toml"
    config.write_text('[tools]\nnode = "24.21.0"\n', encoding="utf-8")
    with pytest.raises(KeyError):
        update_version(config, "bun", "1.4.3")
