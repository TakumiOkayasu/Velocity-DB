"""Regression checks for the scan evidence gate, with no Semgrep dependency."""

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import verify_semgrep_suppression as gate


def finding(rule: str, line: int = 54, path: str = gate.TARGET) -> dict:
    return {
        "check_id": rule,
        "path": path,
        "start": {"line": line, "col": 13},
        "end": {"line": line, "col": 39},
    }


class SuppressionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.baseline = {
            "version": "test",
            "errors": [],
            "paths": {"scanned": [gate.TARGET, gate.FRONTEND_TARGET, gate.BUILD_TARGET]},
            "results": [
                finding(gate.RULE),
                finding(gate.RULE, 200, gate.FRONTEND_TARGET),
                finding(gate.RULE, 396, gate.BUILD_TARGET),
                finding("other-rule"),
                finding(gate.RULE, 35),
            ],
        }
        self.annotated = copy.deepcopy(self.baseline)
        self.annotated["results"] = self.annotated["results"][3:]

    def test_only_target_disappears(self) -> None:
        summary = gate.verify(self.baseline, self.annotated, 54, 200, 396)
        self.assertEqual(summary["annotated_findings"], 2)
        self.assertEqual(len(summary["suppressed"]), 3)

    def test_ignored_json_record_is_not_active(self) -> None:
        ignored = finding(gate.RULE) | {"extra": {"is_ignored": True}}
        self.annotated["results"].append(ignored)
        gate.verify(self.baseline, self.annotated, 54, 200, 396)

    def test_missing_or_ineffective_rule_fails(self) -> None:
        for baseline, annotated in [
            (self.annotated, self.annotated),
            (self.baseline, self.baseline),
        ]:
            with self.subTest(baseline=baseline), self.assertRaises(ValueError):
                gate.verify(baseline, annotated, 54, 200, 396)

    def test_other_rule_or_other_location_cannot_disappear(self) -> None:
        for index in (0, 1):
            annotated = copy.deepcopy(self.annotated)
            annotated["results"].pop(index)
            with self.subTest(index=index), self.assertRaises(ValueError):
                gate.verify(self.baseline, annotated, 54, 200, 396)

    def test_new_findings_and_duplicates_fail(self) -> None:
        for item in (finding("new-rule"), finding("other-rule")):
            annotated = copy.deepcopy(self.annotated)
            annotated["results"].append(item)
            with self.subTest(item=item), self.assertRaises(ValueError):
                gate.verify(self.baseline, annotated, 54, 200, 396)

    def test_frontend_finding_must_disappear_at_exact_location(self) -> None:
        for changed in (
            [finding(gate.RULE, 200, gate.FRONTEND_TARGET)],
            [finding(gate.RULE, 201, gate.FRONTEND_TARGET)],
        ):
            annotated = copy.deepcopy(self.annotated)
            annotated["results"].extend(changed)
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                gate.verify(self.baseline, annotated, 54, 200, 396)

    def test_build_finding_must_disappear_at_exact_location(self) -> None:
        for line in (396, 397):
            annotated = copy.deepcopy(self.annotated)
            annotated["results"].append(finding(gate.RULE, line, gate.BUILD_TARGET))
            with self.subTest(line=line), self.assertRaises(ValueError):
                gate.verify(self.baseline, annotated, 54, 200, 396)

    def test_another_build_finding_cannot_be_hidden(self) -> None:
        for item in (
            finding(gate.RULE, 500, gate.BUILD_TARGET),
            finding("other-rule", 396, gate.BUILD_TARGET),
        ):
            baseline = copy.deepcopy(self.baseline)
            baseline["results"].append(item)
            with self.subTest(item=item), self.assertRaises(ValueError):
                gate.verify(baseline, self.annotated, 54, 200, 396)

    def test_duplicate_build_baseline_finding_fails(self) -> None:
        self.baseline["results"].append(finding(gate.RULE, 396, gate.BUILD_TARGET))
        with self.assertRaises(ValueError):
            gate.verify(self.baseline, self.annotated, 54, 200, 396)

    def test_all_targets_must_be_scanned_even_when_coverage_matches(self) -> None:
        for target in (gate.TARGET, gate.FRONTEND_TARGET, gate.BUILD_TARGET):
            baseline = copy.deepcopy(self.baseline)
            annotated = copy.deepcopy(self.annotated)
            baseline["paths"]["scanned"].remove(target)
            annotated["paths"]["scanned"].remove(target)
            with self.subTest(target=target), self.assertRaises(ValueError):
                gate.verify(baseline, annotated, 54, 200, 396)

    def test_build_parse_warning_cannot_be_accepted_as_unchanged(self) -> None:
        warning = {"level": "warn", "path": gate.BUILD_TARGET, "message": "partial parse"}
        self.baseline["errors"] = [warning]
        self.annotated["errors"] = [warning]
        with self.assertRaises(ValueError):
            gate.verify(self.baseline, self.annotated, 54, 200, 396)

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
                    gate.verify(*reports, 54, 200, 396)

    def test_original_source_restored_after_failed_scan(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            target = root / gate.TARGET
            target.parent.mkdir(parents=True)
            original = f"{gate.ANNOTATION}\r\nexample()\r\n".encode()
            target.write_bytes(original)
            frontend_target = root / gate.FRONTEND_TARGET
            frontend_target.write_bytes(original)
            build_target = root / gate.BUILD_TARGET
            build_target.write_bytes(original)
            with (
                patch.object(gate, "__file__", str(root / "scripts" / "gate.py")),
                patch.object(gate, "scan", side_effect=RuntimeError("scan failed")),
                self.assertRaises(RuntimeError),
            ):
                gate.main(Path(directory) / "evidence")
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(frontend_target.read_bytes(), original)
            self.assertEqual(build_target.read_bytes(), original)

    def test_unchanged_unrelated_parse_warnings_are_preserved(self) -> None:
        warning = {"level": "warn", "path": "other.yml", "message": "partial parse"}
        self.baseline["errors"] = [warning]
        self.annotated["errors"] = [warning]
        self.assertEqual(
            gate.verify(self.baseline, self.annotated, 54, 200, 396)["unchanged_scan_warnings"], 1
        )
        self.annotated["errors"] = []
        with self.assertRaises(ValueError):
            gate.verify(self.baseline, self.annotated, 54, 200, 396)

    def test_target_parse_warning_fails_even_when_unchanged(self) -> None:
        warning = {"level": "warn", "path": gate.TARGET, "message": "partial parse"}
        self.baseline["errors"] = [warning]
        self.annotated["errors"] = [warning]
        with self.assertRaises(ValueError):
            gate.verify(self.baseline, self.annotated, 54, 200, 396)


class EnvironmentScanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.targets = [
            gate.FRONTEND_TARGET,
            gate.BUILD_TARGET,
            "scripts/_lib/windows_environment.py",
        ]
        self.report = {"paths": {"scanned": self.targets.copy()}, "errors": [], "results": []}

    def test_clean_targets_pass_and_keep_unrelated_findings(self) -> None:
        self.report["results"] = [finding("other-rule"), finding(gate.RULE)]
        self.assertEqual(gate.verify_environment(self.report, 200, 396), self.targets)
        self.assertEqual(len(self.report["results"]), 2)

    def test_missing_target_fails(self) -> None:
        for target in self.targets:
            report = copy.deepcopy(self.report)
            report["paths"]["scanned"].remove(target)
            with self.subTest(target=target), self.assertRaises(ValueError):
                gate.verify_environment(report, 200, 396)

    def test_active_and_ignored_findings_fail(self) -> None:
        for target in self.targets:
            for ignored in (True, False):
                report = copy.deepcopy(self.report)
                report["results"] = [
                    finding(gate.RULE) | {"path": target, "extra": {"is_ignored": ignored}}
                ]
                if target == gate.FRONTEND_TARGET and ignored:
                    report["results"][0]["start"]["line"] = 200
                    self.assertEqual(gate.verify_environment(report, 200, 396), self.targets)
                else:
                    with (
                        self.subTest(target=target, ignored=ignored),
                        self.assertRaises(ValueError),
                    ):
                        gate.verify_environment(report, 200, 396)

    def test_frontend_ignored_finding_elsewhere_fails(self) -> None:
        self.report["results"] = [
            finding(gate.RULE, 201, gate.FRONTEND_TARGET) | {"extra": {"is_ignored": True}}
        ]
        with self.assertRaises(ValueError):
            gate.verify_environment(self.report, 200, 396)

    def test_duplicate_frontend_ignored_finding_fails(self) -> None:
        item = finding(gate.RULE, 200, gate.FRONTEND_TARGET) | {"extra": {"is_ignored": True}}
        self.report["results"] = [item, copy.deepcopy(item)]
        with self.assertRaises(ValueError):
            gate.verify_environment(self.report, 200, 396)

    def test_only_exact_build_ignored_finding_is_allowed(self) -> None:
        for line, ignored in ((396, True), (396, False), (397, True)):
            self.report["results"] = [
                finding(gate.RULE, line, gate.BUILD_TARGET) | {"extra": {"is_ignored": ignored}}
            ]
            with self.subTest(line=line, ignored=ignored):
                if line == 396 and ignored:
                    self.assertEqual(gate.verify_environment(self.report, 200, 396), self.targets)
                else:
                    with self.assertRaises(ValueError):
                        gate.verify_environment(self.report, 200, 396)

    def test_duplicate_build_ignored_finding_fails(self) -> None:
        item = finding(gate.RULE, 396, gate.BUILD_TARGET) | {"extra": {"is_ignored": True}}
        self.report["results"] = [item, copy.deepcopy(item)]
        with self.assertRaises(ValueError):
            gate.verify_environment(self.report, 200, 396)

    def test_partial_parse_and_scan_errors_fail(self) -> None:
        for error in [
            {"level": "error", "path": "other"},
            *({"level": "warn", "path": p} for p in self.targets),
        ]:
            report = copy.deepcopy(self.report)
            report["errors"] = [error]
            with self.subTest(error=error), self.assertRaises(ValueError):
                gate.verify_environment(report, 200, 396)

    def test_unrelated_warning_remains_visible(self) -> None:
        self.report["errors"] = [{"level": "warn", "path": "other.yml"}]
        gate.verify_environment(self.report, 200, 396)
        self.assertEqual(len(self.report["errors"]), 1)


if __name__ == "__main__":
    unittest.main()
