"""Read or update an exact tool pin in the project's mise.toml."""

import argparse
import re
import tomllib
from pathlib import Path

PROJECT_CONFIG = Path(__file__).resolve().parent.parent / "mise.toml"
EXACT_VERSION = re.compile(r"\d+\.\d+\.\d+\Z")


def current_version(path: Path, tool: str) -> str:
    """Return the pinned version, rejecting missing or floating pins."""
    with path.open("rb") as config_file:
        version = tomllib.load(config_file)["tools"][tool]
    if not isinstance(version, str) or not EXACT_VERSION.fullmatch(version):
        raise ValueError(f"{tool} must have an exact version in {path}")
    return version


def update_version(path: Path, tool: str, version: str) -> None:
    """Change only the selected assignment under [tools], retaining other tools."""
    if not EXACT_VERSION.fullmatch(version):
        raise ValueError(f"Expected an exact {tool} release")
    old = current_version(path, tool)
    source = path.read_text(encoding="utf-8")
    match = re.search(r"(?m)^\[tools\]\s*$", source)
    if match is None:
        raise ValueError("Missing [tools] section")
    section_end = re.search(r"(?m)^\[", source[match.end() :])
    end = match.end() + section_end.start() if section_end else len(source)
    section = source[match.end() : end]
    assignment = re.compile(rf'(?m)^(\s*{re.escape(tool)}\s*=\s*)"{re.escape(old)}"(\s*)$')
    if len(assignment.findall(section)) != 1:
        raise ValueError(f"Expected one {tool} assignment in [tools]")
    updated = assignment.sub(lambda found: f'{found[1]}"{version}"{found[2]}', section)
    path.write_text(source[: match.end()] + updated + source[end:], encoding="utf-8")


def main() -> None:
    """Expose read/update operations to the tool-version-upgrade workflow."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["current", "update"])
    parser.add_argument("tool", choices=["bun"])
    parser.add_argument("version", nargs="?")
    args = parser.parse_args()
    if args.action == "current":
        if args.version is not None:
            parser.error("current does not accept a version")
        print(current_version(PROJECT_CONFIG, args.tool))
    else:
        if args.version is None:
            parser.error("update requires a version")
        update_version(PROJECT_CONFIG, args.tool, args.version)


if __name__ == "__main__":
    main()
