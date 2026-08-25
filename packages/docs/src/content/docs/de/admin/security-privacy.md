---
title: Sicherheit & Datenschutz
description: Gate, Audit, Privacy, SSRF, Remote-SSH.
---

| Bereich | Route / Bedeutung |
|---------|-------------------|
| Security Gate | Policy vor riskanten Tools |
| Security Events | `/security` |
| Audit | `/audit` |
| Privacy | `/privacy` Retention/Redaction |

### Browser-SSRF

Browser-Tools blockieren **private / Metadata**-Hosts. Für Struktur: `browser_snapshot`.

### Remote-Node SSH

SSH-Invoke mit Guard; destruktive Muster nur mit explizitem Force. Nicht-SSH-Typen ggf. ohne Invoke.

Kombinieren mit [Autonomie](/docs/de/agents/autonomy/) und [Secrets](/docs/de/admin/secrets/).
