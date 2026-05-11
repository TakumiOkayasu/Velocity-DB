#!/usr/bin/env bash
# Conventional Commits 検証
# Usage: check-commit-msg.sh <commit-msg-file>
set -euo pipefail

PATTERN='^(feat|fix|docs|style|refactor|test|chore|perf|build|ci|revert)(\(.+\))?!?: .+'

if ! grep -qE "$PATTERN" "$1"; then
  echo "❌ commit message must follow Conventional Commits"
  echo "   allowed types: feat|fix|docs|style|refactor|test|chore|perf|build|ci|revert"
  echo "   example: feat(api): add user auth"
  exit 1
fi
