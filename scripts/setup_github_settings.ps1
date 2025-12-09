#!/usr/bin/env pwsh
# Setup GitHub repository settings for Dependabot auto-merge
# Requires: gh CLI (GitHub CLI)

$ErrorActionPreference = "Stop"

$REPO = "TakumiOkayasu/Pre-DateGrip"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  GitHub Repository Settings - Dependabot Auto-Merge Setup" -ForegroundColor Cyan
Write-Host "  Repository: $REPO" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check if gh CLI is installed
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "Error: gh CLI is not installed" -ForegroundColor Red
    Write-Host "Install: winget install GitHub.cli" -ForegroundColor Yellow
    exit 1
}

# Check if authenticated
$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Not authenticated with GitHub" -ForegroundColor Red
    Write-Host "Run: gh auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "[1/4] Enabling auto-merge..." -ForegroundColor Green
gh api repos/$REPO -X PATCH -f allow_auto_merge=true
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Auto-merge enabled" -ForegroundColor Green
} else {
    Write-Host "  ✗ Failed to enable auto-merge" -ForegroundColor Red
}
Write-Host ""

Write-Host "[2/4] Configuring Actions permissions..." -ForegroundColor Green
# Set workflow permissions to read-write
gh api repos/$REPO/actions/permissions/workflow -X PUT -f default_workflow_permissions=write -f can_approve_pull_request_reviews=true
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Actions permissions configured" -ForegroundColor Green
} else {
    Write-Host "  ✗ Failed to configure Actions permissions" -ForegroundColor Red
}
Write-Host ""

Write-Host "[3/4] Setting up branch protection for 'main'..." -ForegroundColor Green

# Create branch protection rule
$branchProtection = @{
    required_status_checks = @{
        strict = $true
        contexts = @("Lint", "CI Success")
    }
    enforce_admins = $true
    required_pull_request_reviews = @{
        required_approving_review_count = 1
        dismiss_stale_reviews = $false
    }
    restrictions = $null
    required_linear_history = $true
    allow_force_pushes = $false
    allow_deletions = $false
    required_conversation_resolution = $false
} | ConvertTo-Json -Depth 10

try {
    $branchProtection | gh api repos/$REPO/branches/main/protection -X PUT --input -
    Write-Host "  ✓ Branch protection configured" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ Branch protection may already exist or failed: $_" -ForegroundColor Yellow
    Write-Host "  Updating existing protection..." -ForegroundColor Yellow
    try {
        $branchProtection | gh api repos/$REPO/branches/main/protection -X PATCH --input -
        Write-Host "  ✓ Branch protection updated" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ Failed to configure branch protection" -ForegroundColor Red
    }
}
Write-Host ""

Write-Host "[4/4] Verifying settings..." -ForegroundColor Green
Write-Host ""

# Verify auto-merge
$repoInfo = gh api repos/$REPO | ConvertFrom-Json
if ($repoInfo.allow_auto_merge) {
    Write-Host "  ✓ Auto-merge: Enabled" -ForegroundColor Green
} else {
    Write-Host "  ✗ Auto-merge: Disabled" -ForegroundColor Red
}

# Verify Actions permissions
$actionsPerms = gh api repos/$REPO/actions/permissions/workflow | ConvertFrom-Json
if ($actionsPerms.default_workflow_permissions -eq "write" -and $actionsPerms.can_approve_pull_request_reviews) {
    Write-Host "  ✓ Actions permissions: Read/Write + Can approve PRs" -ForegroundColor Green
} else {
    Write-Host "  ✗ Actions permissions: Not configured correctly" -ForegroundColor Red
}

# Verify branch protection
try {
    $protection = gh api repos/$REPO/branches/main/protection | ConvertFrom-Json
    Write-Host "  ✓ Branch protection: Configured" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Branch protection: Not configured" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Check Security tab for Dependabot alerts" -ForegroundColor White
Write-Host "  2. Wait for next Monday 9:00 JST for Dependabot to run" -ForegroundColor White
Write-Host "  3. Or manually trigger: Insights → Dependency graph → Dependabot" -ForegroundColor White
Write-Host ""
