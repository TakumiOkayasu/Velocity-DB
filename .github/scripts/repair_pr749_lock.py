"""One-time, branch-scoped repair; remove this script and workflow after completion."""

import json
import os
import re
import subprocess
from pathlib import Path

BRANCH = "dependabot/bun/frontend/development-dependencies-c69597e4fd"
ALLOWED = {"frontend/package.json", "frontend/bun.lock"}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def main() -> None:
    expected = os.environ["EXPECTED_HEAD"]
    if not re.fullmatch(r"[0-9a-f]{40}", expected) or git("rev-parse", "HEAD") != expected:
        raise SystemExit("Unexpected checkout; refusing to modify the branch")
    if git("status", "--porcelain"):
        raise SystemExit("Working tree is not clean")

    path = Path("frontend/package.json")
    source = path.read_text(encoding="utf-8")
    data = json.loads(source)
    old = "npm:@voidzero-dev/vite-plus-core@0.3.1"
    new = "npm:@voidzero-dev/vite-plus-core@0.3.3"
    if data["devDependencies"]["vite-plus"] != "0.3.3":
        raise SystemExit("Vite+ version changed; re-review required")
    for section in ("devDependencies", "overrides"):
        if data[section]["vite"] != old:
            raise SystemExit("Vite alias changed; re-review required")
    before = f'"vite": "{old}"'
    if source.count(before) != 2:
        raise SystemExit("Expected exactly two Vite aliases")
    path.write_text(source.replace(before, f'"vite": "{new}"'), encoding="utf-8")

    subprocess.run(
        ["bun", "install", "--lockfile-only", "--ignore-scripts"], cwd="frontend", check=True
    )
    subprocess.run(
        ["bun", "install", "--frozen-lockfile", "--ignore-scripts"], cwd="frontend", check=True
    )
    changed = set(git("diff", "--name-only").splitlines())
    if changed != ALLOWED:
        raise SystemExit(f"Unexpected changed paths: {sorted(changed)}")
    git("diff", "--check")
    git("fetch", "origin", BRANCH)
    if git("rev-parse", "FETCH_HEAD") != expected:
        raise SystemExit("Remote branch advanced; refusing to overwrite it")
    git("config", "user.name", "github-actions[bot]")
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    git("add", "--", *sorted(ALLOWED))
    git("commit", "-m", "fix(deps): align Vite alias and lockfile with Vite+ 0.3.3")
    git("push", "origin", f"HEAD:refs/heads/{BRANCH}")


if __name__ == "__main__":
    main()
