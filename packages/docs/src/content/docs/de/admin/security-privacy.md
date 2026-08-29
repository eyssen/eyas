---
title: Sicherheit & Datenschutz
description: Security-Gate, Event-Stream, Audit-Log und PII-Scan — vor und nach Tools.
---

**Wozu das da ist.** Drei Operator-Flächen. Das **Security-Gate** erlaubt, verweigert oder eskaliert einen Tool-Aufruf *bevor* er läuft. **Sicherheitsereignisse** (`/security`) ist der Stream. **Audit** (`/audit`) das unveränderliche Action-Log. **Datenschutz** (`/privacy`) PII-Scan — derselbe Sanitizer, den Durable-Memory-Capture *vor* dem Vault-Write laufen lässt.

## Wann du es brauchst

- Tool-Aufruf verweigert — Checkpoint, Risiko, Grund.
- Browser-Tools dürfen keine Private/Metadata-Hosts treffen (SSRF). Headless-Profil ist EYAS-eigen (`data/browser/profile`), nie das tägliche Chrome-Profil (Chrome 136+). Snapshot-Indexe nach Navigation ungültig. `evaluate` nur in der Seite. `browser_totp` ist gelb (Seed in Geheimnisse/Schlüsselbund, nur der Code an `browser_fill`). Action-Cache speichert Locator, keine Secrets.
- Autonomie an, sehen was das Gate eskaliert.
- PII in Logs, Vault-Notizen, Outbound-Prompts.

## Typischer Ablauf

1. **Sicherheit** (`/security`): Allow/Deny/Escalate, Risiko, Tool, Checkpoint.
2. **Audit** (`/audit`): wer, Modul, Result (success/error/denied/rolled-back), Kosten. Rollback mit Bestätigung.
3. **Datenschutz** (`/privacy`): Stats, **PII-Scanner testen**.
4. Mit [Autonomie](/docs/de/agents/autonomy/) und [Geheimnisse](/docs/de/admin/secrets/).
5. SSH: [Knoten](/docs/de/admin/nodes/) — destruktive Muster brauchen Force-Flag.

Capture-Schalter: `memory.capture.enabled` (Default **an**). Siehe [FAQ](/docs/de/reference/faq/).

## Verwandt

- [Autonomie](/docs/de/agents/autonomy/)
- [Benutzer](/docs/de/admin/users/)
- [Werkzeuge](/docs/de/automation/tools/)
- [Observability](/docs/de/admin/observability/)
- [Knoten](/docs/de/admin/nodes/)
- [Speicher](/docs/de/knowledge/memory/)
