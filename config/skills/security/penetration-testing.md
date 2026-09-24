---
name: penetration-testing
description: Penetration testing methodology, tools, and common attack vectors
trigger_patterns:
  - "penetration testing"
  - "pentest"
  - "security testing"
  - "attack vector"
  - "vulnerability assessment"
capabilities:
  - security
version: "1.0.0"
---
# Penetration Testing Guide

## Testing Methodology
1. **Reconnaissance** — map endpoints, identify technologies, gather info
2. **Scanning** — automated vulnerability scanning, port scanning
3. **Exploitation** — attempt to exploit found vulnerabilities
4. **Post-exploitation** — assess impact, lateral movement potential
5. **Reporting** — document findings with severity, evidence, and remediation

## Common Attack Vectors for Web APIs
- **Authentication bypass** — default credentials, weak tokens, missing auth on endpoints
- **Injection** — SQL, NoSQL, command, LDAP injection
- **Broken access control** — IDOR (direct object reference), privilege escalation
- **SSRF** — making server request internal resources
- **Mass assignment** — sending unexpected fields that get saved
- **Rate limit bypass** — header manipulation, distributed requests

## Manual Testing Checklist
```
[ ] Try accessing resources without authentication
[ ] Try accessing other users' resources (change ID in URL)
[ ] Submit malicious input: ' OR 1=1 --, <script>alert(1)</script>
[ ] Test file upload with malicious files
[ ] Check for verbose error messages
[ ] Verify rate limiting actually blocks
[ ] Test expired/invalid/tampered tokens
[ ] Check for missing security headers
[ ] Try HTTP method tampering (GET vs POST)
[ ] Test for CORS misconfiguration
```

## Automated Tools
- **OWASP ZAP** — web application scanner (open source)
- **Burp Suite** — intercepting proxy for manual testing
- **nuclei** — template-based vulnerability scanner
- **sqlmap** — SQL injection detection and exploitation
- **ffuf** — directory and parameter fuzzing

## Reporting Template
For each finding:
- **Title**: clear, descriptive name
- **Severity**: Critical / High / Medium / Low / Info
- **Description**: what the vulnerability is
- **Evidence**: screenshots, request/response, reproduction steps
- **Impact**: what an attacker can achieve
- **Remediation**: specific fix recommendation

## Frequency
- Full pentest: annually or after major changes
- Automated scanning: weekly in CI/CD
- Bug bounty: continuous (if applicable)
