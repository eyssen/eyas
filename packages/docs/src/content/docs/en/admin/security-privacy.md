---
title: Security & privacy
description: Security gate, audit, privacy, security events.
---

| Area | Route / meaning |
|------|-----------------|
| **Security gate** | Runtime policy before dangerous tools |
| **Security events** | `/security` event stream |
| **Audit** | `/audit` immutable action log |
| **Privacy** | `/privacy` retention / redaction controls |

### Browser SSRF protection

Browser tools block requests to **private / metadata** hosts (cloud metadata, loopback, RFC1918, etc.) to reduce server-side request forgery risk. Prefer `browser_snapshot` for compact accessibility trees when agents only need structure.

### Remote node SSH

Remote-node **SSH invoke** (via Nodes) runs guarded commands; **destructive** command patterns require an explicit force flag. Non-SSH node types may return not-implemented for invoke.

Combine with [Autonomy](/docs/en/agents/autonomy/) (approvals) and [Secrets](/docs/en/admin/secrets/).

## Related

- [Autonomy](/docs/en/agents/autonomy/)
- [Users](/docs/en/admin/users/)
- [Tools](/docs/en/automation/tools/)
- [Observability & nodes](/docs/en/admin/observability/)
