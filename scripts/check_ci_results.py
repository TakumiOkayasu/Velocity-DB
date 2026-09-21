"""Validate the terminal results of jobs required by the CI success gate."""

from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence

REQUIRED_SUCCESS_JOBS = ("lint-cpp", "lint-frontend", "build-frontend")
BACKEND_JOB = "build-backend"


def validate_ci_results(results: Mapping[str, str]) -> list[str]:
    """Return descriptions of results that must fail the aggregate CI gate."""
    failures = [
        f"{job}={results.get(job, 'missing')} (expected success)"
        for job in REQUIRED_SUCCESS_JOBS
        if results.get(job) != "success"
    ]

    backend_result = results.get(BACKEND_JOB, "missing")
    if backend_result not in {"success", "skipped"}:
        failures.append(f"{BACKEND_JOB}={backend_result} (expected success or skipped)")
    return failures


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    for job in (*REQUIRED_SUCCESS_JOBS, BACKEND_JOB):
        parser.add_argument(f"--{job}", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    results = {
        job: getattr(args, job.replace("-", "_")) for job in (*REQUIRED_SUCCESS_JOBS, BACKEND_JOB)
    }
    failures = validate_ci_results(results)
    if failures:
        print("CI gate failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("All required jobs passed or were intentionally skipped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
