# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the Taostats Auth Gateway,
please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email security concerns to the maintainers or use
GitHub's private vulnerability reporting feature:

1. Go to the repository's **Security** tab
2. Click **Report a vulnerability**
3. Provide a detailed description of the issue

## What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Depends on severity, but we aim for:
  - Critical: 24-48 hours
  - High: 1 week
  - Medium/Low: Next release cycle

## Scope

The following are in scope:

- Authentication bypass
- Token forgery or manipulation
- SQL injection, XSS, or other injection attacks
- Cryptographic weaknesses
- Authorization flaws (scope escalation, etc.)
- Information disclosure
- Rate limiting bypass

The following are out of scope:

- Denial of service (volumetric)
- Social engineering
- Issues in dependencies (report these upstream)
- Issues requiring physical access to the server
