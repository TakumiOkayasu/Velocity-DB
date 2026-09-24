"""Verify exactly scoped LLVM and frontend tool annotations in a full scan."""

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

RULE = (
    "python.lang.security.audit.dangerous-subprocess-use-tainted-env-args."
    "dangerous-subprocess-use-tainted-env-args"
)
TARGET = "scripts/_lib/llvm.py"
ANNOTATION = f"# nosemgrep: {RULE}"
FRONTEND_TARGET = "scripts/_lib/utils.py"


def findings(report: dict) -> Counter:
    """Compare locations, including duplicates, without unstable metadata fields."""
    return Counter(
        (
            item["check_id"],
            item["path"],
            item["start"]["line"],
            item["start"]["col"],
            item["end"]["line"],
            item["end"]["col"],
        )
        for item in report["results"]
        if item.get("extra", {}).get("is_ignored") is not True
    )


def verify(baseline: dict, annotated: dict, match_line: int, frontend_line: int) -> dict:
    for report in (baseline, annotated):
        if any(
            error.get("level") != "warn" or error.get("path") == TARGET
            for error in report["errors"]
        ):
            raise ValueError("Semgrep reported scan errors; suppression is unverified")
        if TARGET not in report["paths"]["scanned"]:
            raise ValueError("LLVM target was not scanned")
    if baseline["version"] != annotated["version"]:
        raise ValueError("Scanner versions differ")
    # Existing unrelated parse warnings stay visible in both saved reports.
    if Counter(json.dumps(error, sort_keys=True) for error in baseline["errors"]) != Counter(
        json.dumps(error, sort_keys=True) for error in annotated["errors"]
    ):
        raise ValueError("Scan diagnostics differ")
    if set(baseline["paths"]["scanned"]) != set(annotated["paths"]["scanned"]):
        raise ValueError("Scan coverage differs")
    before, after = findings(baseline), findings(annotated)
    expected = Counter()
    for target, line in ((TARGET, match_line), (FRONTEND_TARGET, frontend_line)):
        matching = Counter(
            {key: count for key, count in before.items() if key[:3] == (RULE, target, line)}
        )
        if matching.total() != 1:
            raise ValueError(f"Expected exactly one unsuppressed finding: {target}")
        expected.update(matching)
    if before - after != expected or after - before:
        raise ValueError("Suppressions must remove only the expected findings")
    return {
        "version": annotated["version"],
        "baseline_findings": before.total(),
        "annotated_findings": after.total(),
        "suppressed": list(expected.elements()),
        "scanned_files": len(annotated["paths"]["scanned"]),
        "unchanged_scan_warnings": len(annotated["errors"]),
    }


def verify_environment(report: dict, frontend_line: int) -> list[str]:
    """Reject environment taint other than the separately proven frontend call."""
    targets = [FRONTEND_TARGET, "scripts/_lib/windows_environment.py"]
    expected_ignored = 0
    for target in targets:
        if target not in report["paths"]["scanned"]:
            raise ValueError(f"Environment target was not scanned: {target}")
        if any(e.get("level") != "warn" or e.get("path") == target for e in report["errors"]):
            raise ValueError(f"Environment scan has errors: {target}")
        if any(
            f["path"] == target
            and f["check_id"] == RULE
            and not (
                target == FRONTEND_TARGET
                and f["start"]["line"] == frontend_line
                and f.get("extra", {}).get("is_ignored") is True
            )
            for f in report["results"]
        ):
            raise ValueError(f"Unexpected environment-tainted subprocess: {target}")
        if target == FRONTEND_TARGET:
            expected_ignored = sum(
                f["path"] == target
                and f["check_id"] == RULE
                and f["start"]["line"] == frontend_line
                and f.get("extra", {}).get("is_ignored") is True
                for f in report["results"]
            )
    if expected_ignored > 1:
        raise ValueError("Duplicate ignored frontend finding")
    return targets


def scan(root: Path, output: Path) -> dict:
    subprocess.run(
        [
            "semgrep",
            "scan",
            "--config=auto",
            "--config=p/security-audit",
            "--config=p/owasp-top-ten",
            "--json",
            f"--output={output}",
            "--exclude=node_modules",
            "--exclude=build",
            "--exclude=dist",
            "--exclude=third_party",
            ".",
        ],
        cwd=root,
        check=True,
        timeout=600,
    )
    return json.loads(output.read_text(encoding="utf-8"))


def main(output: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    output = output.resolve()
    if output.is_relative_to(root):
        raise ValueError("Evidence directory must be outside the scanned repository")
    output.mkdir(parents=True, exist_ok=True)
    originals: dict[Path, bytes] = {}
    baselines: dict[Path, bytes] = {}
    match_lines: dict[str, int] = {}
    for name in (TARGET, FRONTEND_TARGET):
        path = root / name
        original = path.read_bytes()
        lines = original.splitlines(keepends=True)
        annotations = [i for i, line in enumerate(lines) if b"nosem" in line]
        if len(annotations) != 1 or lines[annotations[0]].strip() != ANNOTATION.encode():
            raise ValueError(f"Expected exactly one rule-specific annotation: {name}")
        index = annotations[0]
        # Keep source line numbers stable; never execute the modified source.
        lines[index] = lines[index].replace(ANNOTATION.encode(), b"")
        originals[path] = original
        baselines[path] = b"".join(lines)
        match_lines[name] = index + 2
    try:
        for path, source in baselines.items():
            path.write_bytes(source)
        baseline = scan(root, output / "baseline.json")
    finally:
        for path, source in originals.items():
            path.write_bytes(source)
    annotated = scan(root, output / "annotated.json")
    summary = verify(baseline, annotated, match_lines[TARGET], match_lines[FRONTEND_TARGET])
    summary["verified_environment_targets"] = verify_environment(
        annotated, match_lines[FRONTEND_TARGET]
    )
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
