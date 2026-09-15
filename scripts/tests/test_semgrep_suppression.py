"""Regression checks for the scan evidence gate, with no Semgrep dependency."""

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import verify_semgrep_suppression as gate


def finding(rule: str, line: int = 54) -> dict:
    return {
        "check_id": rule,
        "path": gate.TARGET,
        "start": {"line": line, "col": 13},
        "end": {"line": line, "col": 39},
    }


class SuppressionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.baseline = {
            "version": "test",
            "errors": [],
            "paths": {"scanned": [gate.TARGET]},
            "results": [finding(gate.RULE), finding("other-rule"), finding(gate.RULE, 35)],
        }
        self.annotated = copy.deepcopy(self.baseline)
        self.annotated["results"].pop(0)

    def test_only_target_disappears(self) -> None:
        summary = gate.verify(self.baseline, self.annotated, 54)
        self.assertEqual(summary["annotated_findings"], 2)

    def test_ignored_json_record_is_not_active(self) -> None:
        ignored = finding(gate.RULE) | {"extra": {"is_ignored": True}}
        self.annotated["results"].append(ignored)
        gate.verify(self.baseline, self.annotated, 54)

    def test_missing_or_ineffective_rule_fails(self) -> None:
        for baseline, annotated in [
            (self.annotated, self.annotated),
            (self.baseline, self.baseline),
        ]:
            with self.subTest(baseline=baseline), self.assertRaises(ValueError):
                gate.verify(baseline, annotated, 54)

    def test_other_rule_or_other_location_cannot_disappear(self) -> None:
        for index in (0, 1):
            annotated = copy.deepcopy(self.annotated)
            annotated["results"].pop(index)
            with self.subTest(index=index), self.assertRaises(ValueError):
                gate.verify(self.baseline, annotated, 54)

    def test_new_findings_and_duplicates_fail(self) -> None:
        for item in (finding("new-rule"), finding("other-rule")):
            annotated = copy.deepcopy(self.annotated)
            annotated["results"].append(item)
            with self.subTest(item=item), self.assertRaises(ValueError):
                gate.verify(self.baseline, annotated, 54)

    def test_scan_errors_coverage_and_version_changes_fail(self) -> None:
        for change in (
            {"errors": [{"message": "timeout"}]},
            {"paths": {"scanned": []}},
            {"version": "different"},
        ):
            for side in (0, 1):
                reports = [copy.deepcopy(self.baseline), copy.deepcopy(self.annotated)]
                reports[side].update(change)
                with self.subTest(change=change, side=side), self.assertRaises(ValueError):
                    gate.verify(*reports, 54)

    def test_original_source_restored_after_failed_scan(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            target = root / gate.TARGET
            target.parent.mkdir(parents=True)
            original = f"{gate.ANNOTATION}\r\nexample()\r\n".encode()
            target.write_bytes(original)
            with (
                patch.object(gate, "__file__", str(root / "scripts" / "gate.py")),
                patch.object(gate, "scan", side_effect=RuntimeError("scan failed")),
                self.assertRaises(RuntimeError),
            ):
                gate.main(Path(directory) / "evidence")
            self.assertEqual(target.read_bytes(), original)

    def test_unchanged_unrelated_parse_warnings_are_preserved(self) -> None:
        warning = {"level": "warn", "path": "other.yml", "message": "partial parse"}
        self.baseline["errors"] = [warning]
        self.annotated["errors"] = [warning]
        self.assertEqual(
            gate.verify(self.baseline, self.annotated, 54)["unchanged_scan_warnings"], 1
        )
        self.annotated["errors"] = []
        with self.assertRaises(ValueError):
            gate.verify(self.baseline, self.annotated, 54)

    def test_target_parse_warning_fails_even_when_unchanged(self) -> None:
        warning = {"level": "warn", "path": gate.TARGET, "message": "partial parse"}
        self.baseline["errors"] = [warning]
        self.annotated["errors"] = [warning]
        with self.assertRaises(ValueError):
            gate.verify(self.baseline, self.annotated, 54)


class EnvironmentScanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.targets = ["scripts/_lib/utils.py", "scripts/_lib/windows_environment.py"]
        self.report = {"paths": {"scanned": self.targets.copy()}, "errors": [], "results": []}

    def test_clean_targets_pass_and_keep_unrelated_findings(self) -> None:
        self.report["results"] = [finding("other-rule"), finding(gate.RULE)]
        self.assertEqual(gate.verify_environment(self.report), self.targets)
        self.assertEqual(len(self.report["results"]), 2)

    def test_missing_target_fails(self) -> None:
        for target in self.targets:
            report = copy.deepcopy(self.report)
            report["paths"]["scanned"].remove(target)
            with self.subTest(target=target), self.assertRaises(ValueError):
                gate.verify_environment(report)

    def test_active_and_ignored_findings_fail(self) -> None:
        for target in self.targets:
            for ignored in (True, False):
                report = copy.deepcopy(self.report)
                report["results"] = [
                    finding(gate.RULE) | {"path": target, "extra": {"is_ignored": ignored}}
                ]
                with self.subTest(target=target, ignored=ignored), self.assertRaises(ValueError):
                    gate.verify_environment(report)

    def test_partial_parse_and_scan_errors_fail(self) -> None:
        for error in [
            {"level": "error", "path": "other"},
            *({"level": "warn", "path": p} for p in self.targets),
        ]:
            report = copy.deepcopy(self.report)
            report["errors"] = [error]
            with self.subTest(error=error), self.assertRaises(ValueError):
                gate.verify_environment(report)

    def test_unrelated_warning_remains_visible(self) -> None:
        self.report["errors"] = [{"level": "warn", "path": "other.yml"}]
        gate.verify_environment(self.report)
        self.assertEqual(len(self.report["errors"]), 1)


if __name__ == "__main__":
    unittest.main()
