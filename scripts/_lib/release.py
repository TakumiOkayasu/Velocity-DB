"""Release utilities for Velocity-DB build system."""

import re
import subprocess
from pathlib import Path


def get_latest_tag(project_root: Path) -> str | None:
    """Get latest semver tag from git."""
    result = subprocess.run(
        ["git", "tag", "--sort=-v:refname"],
        capture_output=True,
        encoding="utf-8",
        cwd=project_root,
    )
    if result.returncode != 0:
        return None
    stdout = result.stdout or ""
    tags = stdout.strip().split("\n")
    for tag in tags:
        if re.match(r"^v?\d+\.\d+\.\d+$", tag):
            return tag.lstrip("v")
    return None


def increment_version(version: str, bump: str) -> str:
    """Increment version number."""
    parts = [int(x) for x in version.split(".")]
    if bump == "major":
        return f"{parts[0] + 1}.0.0"
    elif bump == "minor":
        return f"{parts[0]}.{parts[1] + 1}.0"
    else:  # patch
        return f"{parts[0]}.{parts[1]}.{parts[2] + 1}"


def get_commits_since_tag(tag: str, project_root: Path) -> list[dict[str, str]]:
    """Get commits since the specified tag."""
    result = subprocess.run(
        ["git", "log", f"v{tag}..HEAD", "--pretty=format:%s|%h|%an"],
        capture_output=True,
        encoding="utf-8",
        cwd=project_root,
    )
    stdout = result.stdout or ""
    if result.returncode != 0 or not stdout.strip():
        return []
    commits: list[dict[str, str]] = []
    for line in stdout.strip().split("\n"):
        parts = line.split("|", maxsplit=2)
        if len(parts) >= 2:
            commits.append({"message": parts[0], "hash": parts[1]})
    return commits


def categorize_commits(commits: list[dict[str, str]]) -> dict[str, list[str]]:
    """Categorize commits by type."""
    categories: dict[str, list[str]] = {
        "feat": [],
        "fix": [],
        "perf": [],
        "refactor": [],
        "docs": [],
        "other": [],
    }
    for commit in commits:
        msg = commit["message"]
        if msg.startswith("feat"):
            categories["feat"].append(msg)
        elif msg.startswith("fix"):
            categories["fix"].append(msg)
        elif msg.startswith("perf"):
            categories["perf"].append(msg)
        elif msg.startswith("refactor"):
            categories["refactor"].append(msg)
        elif msg.startswith("docs"):
            categories["docs"].append(msg)
        else:
            categories["other"].append(msg)
    return categories


def generate_release_notes(version: str, prev_tag: str | None, project_root: Path) -> str:
    """Generate release notes markdown."""
    lines = [f"## v{version}\n"]

    if prev_tag:
        commits = get_commits_since_tag(prev_tag, project_root)
        categories = categorize_commits(commits)

        if categories["feat"]:
            lines.append("## ✨ New Features\n")
            for msg in categories["feat"]:
                clean = re.sub(r"^feat[:\s]*", "", msg)
                lines.append(f"- {clean}")
            lines.append("")

        if categories["fix"]:
            lines.append("## 🐛 Bug Fixes\n")
            for msg in categories["fix"]:
                clean = re.sub(r"^fix[:\s]*", "", msg)
                lines.append(f"- {clean}")
            lines.append("")

        if categories["perf"]:
            lines.append("## ⚡ Performance\n")
            for msg in categories["perf"]:
                clean = re.sub(r"^perf[:\s]*", "", msg)
                lines.append(f"- {clean}")
            lines.append("")

        if categories["refactor"]:
            lines.append("## 🔧 Internal Changes\n")
            for msg in categories["refactor"]:
                clean = re.sub(r"^refactor[:\s]*", "", msg)
                lines.append(f"- {clean}")
            lines.append("")

    return "\n".join(lines)
