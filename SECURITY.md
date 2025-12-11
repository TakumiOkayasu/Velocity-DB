# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < 1.0   | :x:                |

**Note**: This project is currently in active development. Once version 1.0 is released, we will provide long-term support for stable versions.

## Reporting a Vulnerability

We take the security of Pre-DateGrip seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisories** (Recommended)
   - Navigate to the [Security tab](https://github.com/TakumiOkayasu/Pre-DateGrip/security/advisories)
   - Click "Report a vulnerability"
   - Fill in the details

2. **Email**
   - Send an email to: t.okayasu@twb.jp
   - Use a clear subject line: `[SECURITY] Vulnerability Report: <brief description>`

### What to Include

Please include the following information in your report:

- Type of vulnerability (e.g., SQL injection, XSS, authentication bypass)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Initial Response**: Within 48 hours of submission
- **Confirmation**: Within 7 days with preliminary assessment
- **Fix Timeline**:
  - Critical vulnerabilities: Within 7 days
  - High severity: Within 14 days
  - Medium/Low severity: Within 30 days

### Disclosure Policy

- We follow responsible disclosure practices
- We will work with you to understand and resolve the issue
- We will credit you in the security advisory (unless you prefer to remain anonymous)
- Please give us reasonable time to address the vulnerability before public disclosure

## Security Measures

### Current Security Practices

1. **Automated Security Scanning**
   - Semgrep security scans (manual trigger)
   - CodeQL analysis for TypeScript/JavaScript
   - Dependabot for dependency updates

2. **Code Review**
   - All changes require review before merge
   - Branch protection rules enforce CI checks

3. **Dependency Management**
   - Automated dependency updates via Dependabot
   - Weekly security patch reviews
   - Minimal external dependencies

4. **Build Security**
   - All builds run in isolated CI environments
   - No secrets in code or configuration files
   - Use of environment variables for sensitive data

### Known Security Considerations

**Database Credentials**
- Pre-DateGrip connects to SQL Server databases using user-provided credentials
- Credentials are stored locally in encrypted format (when saved)
- We recommend using Windows Authentication when possible

**Local Storage**
- Connection settings and query history are stored locally
- Files are stored in user's AppData directory with restricted permissions
- No data is transmitted to external servers

**Network Security**
- All database connections use native SQL Server security (TLS 1.2+)
- No telemetry or analytics data collection
- No external API calls (except optional update checks)

## Security Best Practices for Users

### For Database Connections

1. **Use Windows Authentication** when possible to avoid storing credentials
2. **Use SQL Server accounts with minimal permissions** - only grant necessary database access
3. **Enable connection encryption** in SQL Server connection settings
4. **Regularly rotate passwords** for SQL authentication

### For Development

1. **Never commit** database credentials or connection strings
2. **Use `.env` files** for local testing (already in `.gitignore`)
3. **Review security scan results** before merging PRs
4. **Keep dependencies updated** - monitor Dependabot PRs

### For Deployment

1. **Download releases only from official GitHub releases**
2. **Verify file checksums** (provided in release notes)
3. **Run with minimal privileges** - avoid running as administrator
4. **Keep Windows Defender enabled** for real-time protection

## Third-Party Security

### Dependencies

We regularly audit our dependencies:

**Frontend:**
- React 18 (UI framework)
- Monaco Editor (code editor)
- AG Grid (data grid)
- Zustand (state management)

**Backend:**
- webview/webview (UI wrapper)
- simdjson (JSON parsing)
- pugixml (XML parsing)
- ODBC Native API (database connectivity)

### Supply Chain Security

- All dependencies are locked with `bun.lockb` (frontend) and CMake (backend)
- Dependabot monitors for security updates
- CI/CD pipeline validates all builds

## Security Audit History

| Date | Type | Findings | Status |
|------|------|----------|--------|
| 2025-12-09 | CodeScanning | 10 workflow permission warnings | Fixed |
| - | - | - | - |

*Regular security audits will be documented here as they are performed.*

## Security-Related Configuration

### Repository Settings

- Branch protection enabled for `main` branch
- Required status checks: Lint, CI Success
- Required code review before merge
- Dependabot security updates enabled

### CI/CD Security

- Minimal workflow permissions (read-only by default)
- Secrets never exposed in logs
- Artifacts retained for limited time (7-30 days)

## Contact

For any security-related questions or concerns:
- **Security Issues**: Use GitHub Security Advisories or email t.okayasu@twb.jp
- **General Questions**: Open a GitHub Discussion

## Acknowledgments

We appreciate the security research community's efforts in responsibly disclosing vulnerabilities. Contributors who report valid security issues will be acknowledged in:
- GitHub Security Advisories
- Release notes
- This SECURITY.md file (with permission)

---

**Last Updated**: 2025-12-09
**Version**: 1.0
