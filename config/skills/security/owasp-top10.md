---
name: owasp-top10
description: Web application security top 10 vulnerabilities and mitigations
trigger_patterns:
  - "owasp"
  - "top 10"
  - "web security"
  - "vulnerability"
  - "security audit"
capabilities:
  - security
version: "1.0.0"
---
# Web Application Security — Top 10 Risks

## 1. Broken Access Control
- Enforce server-side access checks on every request
- Deny by default — whitelist allowed actions
- Validate resource ownership before returning data

## 2. Cryptographic Failures
- Use strong algorithms (AES-256-GCM, bcrypt/argon2)
- Never store passwords in plaintext — hash with salt
- Encrypt sensitive data at rest and in transit (TLS 1.2+)

## 3. Injection
- Use parameterized queries (never string concatenation for SQL)
- Validate and sanitize all input
- Use ORM with prepared statements

## 4. Insecure Design
- Threat model during design phase
- Apply principle of least privilege
- Implement rate limiting and abuse prevention from the start

## 5. Security Misconfiguration
- Disable debug mode, directory listing, default credentials
- Keep dependencies updated — automate vulnerability scanning
- Remove unused features, endpoints, and sample data

## 6. Vulnerable Components
- Audit dependencies regularly (`npm audit`, `snyk`)
- Pin dependency versions, review updates before upgrading
- Monitor CVE databases for known vulnerabilities

## 7. Authentication Failures
- Implement MFA, account lockout, credential rotation
- Use established libraries — never roll your own auth

## 8. Data Integrity Failures
- Verify CI/CD pipeline integrity
- Sign and verify software updates and dependencies
- Use SRI for third-party scripts

## 9. Logging and Monitoring Gaps
- Log auth events, access control failures, input validation failures
- Alert on anomalies — failed login spikes, unusual data access

## 10. Server-Side Request Forgery (SSRF)
- Validate and whitelist outbound URLs
- Block internal network ranges (10.x, 172.16.x, 192.168.x)
- Use network-level controls (firewall, egress filtering)
