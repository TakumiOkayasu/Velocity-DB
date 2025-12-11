#!/usr/bin/env python3
"""Setup GitHub repository settings for Dependabot auto-merge.

This script configures:
1. Auto-merge setting
2. GitHub Actions permissions (PR approval)
3. Branch protection rules for main branch

Requirements:
- gh CLI (GitHub CLI) must be installed and authenticated
"""

# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///

import json
import os
import subprocess
import sys
from typing import Any

# Force UTF-8 output on Windows
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"

REPO = "TakumiOkayasu/Pre-DateGrip"


def run_gh_command(args: list[str], input_data: str | None = None) -> dict[str, Any] | None:
    """Run gh CLI command and return JSON response."""
    try:
        cmd = ["gh"] + args
        result = subprocess.run(
            cmd,
            input=input_data,
            text=True,
            capture_output=True,
            check=True,
        )
        if result.stdout.strip():
            return json.loads(result.stdout)
        return None
    except subprocess.CalledProcessError as e:
        print(f"  [FAIL] Command failed: {' '.join(args)}", file=sys.stderr)
        print(f"  Error: {e.stderr}", file=sys.stderr)
        return None
    except json.JSONDecodeError:
        print(f"  [FAIL] Failed to parse JSON response", file=sys.stderr)
        return None


def check_gh_cli() -> bool:
    """Check if gh CLI is installed and authenticated."""
    try:
        subprocess.run(["gh", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: gh CLI is not installed", file=sys.stderr)
        print("Install: winget install GitHub.cli", file=sys.stderr)
        return False

    result = subprocess.run(["gh", "auth", "status"], capture_output=True)
    if result.returncode != 0:
        print("Error: Not authenticated with GitHub", file=sys.stderr)
        print("Run: gh auth login", file=sys.stderr)
        return False

    return True


def enable_auto_merge() -> bool:
    """Enable auto-merge setting for the repository."""
    print("[1/4] Enabling auto-merge...")
    result = run_gh_command(
        ["api", f"repos/{REPO}", "-X", "PATCH", "-f", "allow_auto_merge=true"]
    )
    if result and result.get("allow_auto_merge"):
        print("  [OK] Auto-merge enabled")
        return True
    print("  [FAIL] Failed to enable auto-merge")
    return False


def configure_actions_permissions() -> bool:
    """Configure GitHub Actions permissions to allow PR approvals."""
    print("\n[2/4] Configuring Actions permissions...")

    # Note: This API call may fail with type error for can_approve_pull_request_reviews
    # The setting might need to be configured manually in GitHub UI
    result = run_gh_command([
        "api",
        f"repos/{REPO}/actions/permissions/workflow",
        "-X",
        "PUT",
        "-f",
        "default_workflow_permissions=write",
        "-F",
        "can_approve_pull_request_reviews=true",
    ])

    if result is not None:
        print("  [OK] Actions permissions configured")
        return True

    # Even if the API call fails, check if the setting is already correct
    current = run_gh_command(["api", f"repos/{REPO}/actions/permissions/workflow"])
    if current and current.get("can_approve_pull_request_reviews"):
        print("  [OK] Actions permissions already configured")
        return True

    print("  [WARN] Failed to configure Actions permissions via API")
    print("  -> Manual configuration required at:")
    print(f"    https://github.com/{REPO}/settings/actions")
    print("    -> Enable 'Allow GitHub Actions to create and approve pull requests'")
    return False


def setup_branch_protection() -> bool:
    """Setup branch protection rules for main branch."""
    print("\n[3/4] Setting up branch protection for 'main'...")

    protection_rules = {
        "required_status_checks": {
            "strict": True,
            "contexts": ["Lint", "CI Success"],
        },
        "enforce_admins": True,
        "required_pull_request_reviews": {
            "required_approving_review_count": 1,
            "dismiss_stale_reviews": False,
        },
        "restrictions": None,
        "required_linear_history": True,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "required_conversation_resolution": False,
    }

    input_data = json.dumps(protection_rules)
    result = run_gh_command(
        ["api", f"repos/{REPO}/branches/main/protection", "-X", "PUT", "--input", "-"],
        input_data=input_data,
    )

    if result:
        print("  [OK] Branch protection configured")
        return True

    print("  [WARN] Branch protection may already exist, trying PATCH...")
    result = run_gh_command(
        ["api", f"repos/{REPO}/branches/main/protection", "-X", "PATCH", "--input", "-"],
        input_data=input_data,
    )

    if result:
        print("  [OK] Branch protection updated")
        return True

    print("  [FAIL] Failed to configure branch protection")
    return False


def verify_settings() -> None:
    """Verify all settings are configured correctly."""
    print("\n[4/4] Verifying settings...\n")

    # Verify auto-merge
    repo_info = run_gh_command(["api", f"repos/{REPO}"])
    if repo_info and repo_info.get("allow_auto_merge"):
        print("  [OK] Auto-merge: Enabled")
    else:
        print("  [FAIL] Auto-merge: Disabled")

    # Verify Actions permissions
    actions_perms = run_gh_command(["api", f"repos/{REPO}/actions/permissions/workflow"])
    if (
        actions_perms
        and actions_perms.get("default_workflow_permissions") == "write"
        and actions_perms.get("can_approve_pull_request_reviews")
    ):
        print("  [OK] Actions permissions: Read/Write + Can approve PRs")
    else:
        print("  [FAIL] Actions permissions: Not configured correctly")

    # Verify branch protection
    protection = run_gh_command(["api", f"repos/{REPO}/branches/main/protection"])
    if protection:
        print("  [OK] Branch protection: Configured")
    else:
        print("  [FAIL] Branch protection: Not configured")


def main() -> int:
    """Main entry point."""
    print("=" * 60)
    print("  GitHub Repository Settings - Dependabot Auto-Merge Setup")
    print(f"  Repository: {REPO}")
    print("=" * 60)
    print()

    if not check_gh_cli():
        return 1

    success = True
    success &= enable_auto_merge()
    success &= configure_actions_permissions()
    success &= setup_branch_protection()

    verify_settings()

    print()
    print("=" * 60)
    print("  Setup Complete!")
    print("=" * 60)
    print()
    print("Next steps:")
    print("  1. Check Security tab for Dependabot alerts")
    print("  2. Wait for next Monday 9:00 JST for Dependabot to run")
    print("  3. Or manually trigger: Insights -> Dependency graph -> Dependabot")
    print()

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
