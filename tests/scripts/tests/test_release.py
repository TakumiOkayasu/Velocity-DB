"""Tests for release utilities - encoding and None guard."""

import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# scriptsディレクトリをパスに追加
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib.release import (
    categorize_commits,
    generate_release_notes,
    get_commits_since_tag,
    get_latest_tag,
    increment_version,
)

DUMMY_ROOT = Path("/tmp/dummy")


class TestGetLatestTag:
    """get_latest_tag のテスト。"""

    @patch("_lib.release.subprocess.run")
    def test_uses_utf8_encoding(self, mock_run: MagicMock) -> None:
        """encoding='utf-8'でsubprocess.runを呼ぶこと。"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="v1.0.0\n"
        )
        get_latest_tag(DUMMY_ROOT)
        _, kwargs = mock_run.call_args
        assert kwargs["encoding"] == "utf-8"

    @patch("_lib.release.subprocess.run")
    def test_returns_version_without_v_prefix(self, mock_run: MagicMock) -> None:
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="v2.1.0\nv1.0.0\n"
        )
        assert get_latest_tag(DUMMY_ROOT) == "2.1.0"

    @patch("_lib.release.subprocess.run")
    def test_handles_none_stdout(self, mock_run: MagicMock) -> None:
        """stdout=Noneでクラッシュしないこと。"""
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=0, stdout=None)
        assert get_latest_tag(DUMMY_ROOT) is None

    @patch("_lib.release.subprocess.run")
    def test_handles_no_tags(self, mock_run: MagicMock) -> None:
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=0, stdout="\n")
        assert get_latest_tag(DUMMY_ROOT) is None

    @patch("_lib.release.subprocess.run")
    def test_handles_nonzero_returncode(self, mock_run: MagicMock) -> None:
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=128, stdout="")
        assert get_latest_tag(DUMMY_ROOT) is None


class TestGetCommitsSinceTag:
    """get_commits_since_tag のテスト。"""

    @patch("_lib.release.subprocess.run")
    def test_uses_utf8_encoding(self, mock_run: MagicMock) -> None:
        """encoding='utf-8'でsubprocess.runを呼ぶこと。"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="feat: test|abc1234|author\n"
        )
        get_commits_since_tag("1.0.0", DUMMY_ROOT)
        _, kwargs = mock_run.call_args
        assert kwargs["encoding"] == "utf-8"

    @patch("_lib.release.subprocess.run")
    def test_handles_none_stdout(self, mock_run: MagicMock) -> None:
        """stdout=Noneでクラッシュしないこと。"""
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=0, stdout=None)
        result = get_commits_since_tag("1.0.0", DUMMY_ROOT)
        assert result == []

    @patch("_lib.release.subprocess.run")
    def test_parses_japanese_commits(self, mock_run: MagicMock) -> None:
        """日本語コミットメッセージを正しくパースすること。"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="feat: 日本語の新機能|abc1234|author\nfix: バグ修正|def5678|author\n",
        )
        result = get_commits_since_tag("1.0.0", DUMMY_ROOT)
        assert len(result) == 2
        assert result[0]["message"] == "feat: 日本語の新機能"
        assert result[0]["hash"] == "abc1234"

    @patch("_lib.release.subprocess.run")
    def test_handles_empty_stdout(self, mock_run: MagicMock) -> None:
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=0, stdout="")
        assert get_commits_since_tag("1.0.0", DUMMY_ROOT) == []

    @patch("_lib.release.subprocess.run")
    def test_handles_nonzero_returncode(self, mock_run: MagicMock) -> None:
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=128, stdout="")
        assert get_commits_since_tag("1.0.0", DUMMY_ROOT) == []


class TestCategorizeCommits:
    """categorize_commits のテスト。"""

    def test_categorizes_by_prefix(self) -> None:
        commits = [
            {"message": "feat: new feature", "hash": "a"},
            {"message": "fix: bug fix", "hash": "b"},
            {"message": "perf: speed up", "hash": "c"},
            {"message": "refactor: clean up", "hash": "d"},
            {"message": "docs: update readme", "hash": "e"},
            {"message": "chore: update deps", "hash": "f"},
        ]
        result = categorize_commits(commits)
        assert len(result["feat"]) == 1
        assert len(result["fix"]) == 1
        assert len(result["perf"]) == 1
        assert len(result["refactor"]) == 1
        assert len(result["docs"]) == 1
        assert len(result["other"]) == 1

    def test_japanese_messages(self) -> None:
        commits = [
            {"message": "feat: 日本語の新機能", "hash": "a"},
            {"message": "fix: バグ修正", "hash": "b"},
        ]
        result = categorize_commits(commits)
        assert "日本語の新機能" in result["feat"][0]
        assert "バグ修正" in result["fix"][0]

    def test_empty_commits(self) -> None:
        result = categorize_commits([])
        assert all(len(v) == 0 for v in result.values())


class TestIncrementVersion:
    """increment_version のテスト。"""

    def test_patch_bump(self) -> None:
        assert increment_version("1.0.0", "patch") == "1.0.1"

    def test_minor_bump(self) -> None:
        assert increment_version("1.2.3", "minor") == "1.3.0"

    def test_major_bump(self) -> None:
        assert increment_version("1.2.3", "major") == "2.0.0"


class TestGenerateReleaseNotes:
    """generate_release_notes のテスト。"""

    @patch("_lib.release.subprocess.run")
    def test_generates_notes_with_japanese(self, mock_run: MagicMock) -> None:
        mock_run.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="feat: 新機能追加|abc1234|author\nfix: バグ修正|def5678|author\n",
        )
        notes = generate_release_notes("1.1.0", "1.0.0", DUMMY_ROOT)
        assert "v1.1.0" in notes
        assert "新機能追加" in notes
        assert "バグ修正" in notes

    def test_no_prev_tag(self) -> None:
        notes = generate_release_notes("1.0.0", None, DUMMY_ROOT)
        assert "v1.0.0" in notes
