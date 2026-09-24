import pytest

from scripts.check_ci_results import main, validate_ci_results


def results(*, backend: str = "success") -> dict[str, str]:
    return {
        "lint-cpp": "success",
        "lint-frontend": "success",
        "build-frontend": "success",
        "build-backend": backend,
    }


def test_accepts_successful_backend() -> None:
    assert validate_ci_results(results()) == []


def test_accepts_intentionally_skipped_backend() -> None:
    assert validate_ci_results(results(backend="skipped")) == []


def test_rejects_failed_or_cancelled_backend() -> None:
    for result in ("failure", "cancelled"):
        assert validate_ci_results(results(backend=result)) == [
            f"build-backend={result} (expected success or skipped)"
        ]


def test_frontend_and_lint_jobs_still_require_success() -> None:
    actual = results(backend="skipped")
    actual["lint-frontend"] = "skipped"
    actual["build-frontend"] = "cancelled"

    assert validate_ci_results(actual) == [
        "lint-frontend=skipped (expected success)",
        "build-frontend=cancelled (expected success)",
    ]


def test_cli_returns_failure_for_non_terminal_backend_result() -> None:
    assert (
        main(
            [
                "--lint-cpp",
                "success",
                "--lint-frontend",
                "success",
                "--build-frontend",
                "success",
                "--build-backend",
                "in_progress",
            ]
        )
        == 1
    )


@pytest.mark.parametrize(
    "result", ["success", "failure", "cancelled", "skipped", "in_progress", ""]
)
def test_frontend_matrix_gate_requires_success(result: str) -> None:
    assert main(["--frontend-result", result]) == (0 if result == "success" else 1)


@pytest.mark.parametrize("args", [[], ["--frontend-result", "success", "--lint-cpp", "failure"]])
def test_gate_rejects_missing_or_mixed_results(args: list[str]) -> None:
    with pytest.raises(SystemExit) as error:
        main(args)
    assert error.value.code == 2
