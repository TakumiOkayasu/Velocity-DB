"""The local check must propagate the same failures as CI."""

import argparse
from unittest.mock import Mock

import pdg
import pytest


@pytest.mark.parametrize(
    "failed", ["python", "scripts", "lint", "frontend", "build", "backend", None]
)
def test_check_propagates_each_stage_failure(
    monkeypatch: pytest.MonkeyPatch, failed: str | None
) -> None:
    stages = {
        "python": (pdg.lint, "lint_python"),
        "scripts": (pdg, "test_scripts"),
        "lint": (pdg.lint, "lint_all"),
        "frontend": (pdg.test, "test_frontend"),
        "build": (pdg.build, "build_all"),
        "backend": (pdg.test, "test_backend"),
    }
    mocks = {}
    for name, (module, attribute) in stages.items():
        mocks[name] = Mock(return_value=name != failed)
        monkeypatch.setattr(module, attribute, mocks[name])
    assert pdg.cmd_check(argparse.Namespace(type="Release")) == (failed is None)
    if failed in {"python", "scripts", "build"}:
        mocks["backend"].assert_not_called()
    elif failed is None:
        for mock in mocks.values():
            mock.assert_called_once()


def test_script_command_preserves_test_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    run = Mock(return_value=(False, "LLVM lock missing"))
    monkeypatch.setattr(pdg.utils, "run_command", run)
    assert not pdg.test_scripts()
    assert run.call_args.args[0][1:] == ["-m", "pytest", "scripts/tests", "-q"]
    assert run.call_args.kwargs["env"] == {"VELOCITYDB_TEST_LLVM": "1"}
