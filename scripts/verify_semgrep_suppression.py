"""Verify that the LLVM annotation suppresses exactly one finding in a full scan."""

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


def verify(baseline: dict, annotated: dict, match_line: int) -> dict:
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
    expected = Counter(
        {key: count for key, count in before.items() if key[:3] == (RULE, TARGET, match_line)}
    )
    if expected.total() != 1:
        raise ValueError("Expected exactly one unsuppressed LLVM finding")
    if before - after != expected or after - before:
        raise ValueError("Suppression must remove only the expected LLVM finding")
    return {
        "version": annotated["version"],
        "baseline_findings": before.total(),
        "annotated_findings": after.total(),
        "suppressed": list(expected.elements()),
        "scanned_files": len(annotated["paths"]["scanned"]),
        "unchanged_scan_warnings": len(annotated["errors"]),
    }


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
    target = root / TARGET
    original = target.read_bytes()
    lines = original.splitlines(keepends=True)
    annotations = [i for i, line in enumerate(lines) if b"nosem" in line]
    if len(annotations) != 1 or lines[annotations[0]].strip() != ANNOTATION.encode():
        raise ValueError("Expected exactly one rule-specific LLVM annotation")
    index = annotations[0]
    # Preserve line numbers and all other annotations. Never execute the modified source.
    lines[index] = lines[index].replace(ANNOTATION.encode(), b"")
    try:
        target.write_bytes(b"".join(lines))
        baseline = scan(root, output / "baseline.json")
    finally:
        target.write_bytes(original)
    annotated = scan(root, output / "annotated.json")
    summary = verify(baseline, annotated, index + 2)
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
