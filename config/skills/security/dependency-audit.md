---
name: dependency-audit
description: Dependency auditing, vulnerability scanning, and supply chain security
trigger_patterns:
  - "dependency audit"
  - "npm audit"
  - "vulnerability scan"
  - "supply chain"
  - "cve"
capabilities:
  - security
version: "1.0.0"
---
# Dependency Audit

## Regular Auditing Commands
```bash
# Bun
bun audit

# npm
npm audit
npm audit fix

# Check for outdated packages
bun outdated
npm outdated
```

## Automated Scanning
- **GitHub Dependabot** — auto-creates PRs for vulnerable deps
- **Snyk** — deep vulnerability scanning with fix suggestions
- **Socket.dev** — detects supply chain attacks (typosquatting, install scripts)

## License Compliance
```bash
# Check all dependency licenses
npx license-checker --summary
npx license-checker --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"
```

For EYAS (MIT project): only allow MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0.

## Supply Chain Security
- **Lock files** — always commit `bun.lockb` / `package-lock.json`
- **Pin versions** — exact versions in production, ranges only in libraries
- **Verify integrity** — lock file contains hashes, verify on install
- **Minimal dependencies** — fewer deps = smaller attack surface
- **Review new deps** — check maintainer, download count, last update, license

## Vulnerability Response
1. Assess severity (CVSS score) and exploitability
2. Check if the vulnerable code path is actually used
3. Update to patched version if available
4. If no patch: evaluate alternatives, apply workaround, or accept risk
5. Document decision in security log

## Best Practices
- Run `npm audit` in CI — fail on high/critical vulnerabilities
- Review transitive dependencies, not just direct ones
- Avoid packages with install scripts (`postinstall` can execute arbitrary code)
- Subscribe to security advisories for critical dependencies
- Audit quarterly at minimum, monthly is better
