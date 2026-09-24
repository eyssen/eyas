---
title: Geheimnisse & API-Schlüssel
description: Verschlüsselter Vault für Provider/Kanal-Keys plus Maschinen-API-Keys für die EYAS-API.
---

**Wozu das da ist.** Zwei Sorten Secret. **Geheimnisse** (`/secrets`) ist der verschlüsselte Store: Provider-Keys, Kanal-Token, Backup-Ziele. Werte nie in Logs. **API-Schlüssel** (`/api-keys`) rufen *EYAS* auf, nicht Anthropic. Master-Passwort aus dem Setup verschlüsselt Payloads.

## Wann du es brauchst

- Karte sagt **Kein API-Key**.
- Kanal-Token nicht in YAML/History.
- CI braucht programmatischen Zugriff — Key einmal kopieren, später widerrufen.
- Scope **System / Benutzer / Agent**.

## Typischer Ablauf

1. **Geheimnisse** — Scope-Tab, **Geheimnis hinzufügen**.
2. **API-Schlüssel** — **API-Schlüssel erstellen**, optionale Ablauf-Tage.
3. Banner sofort kopieren: *Jetzt kopieren. Wird nicht wieder gezeigt.*
4. Ungenutzte **widerrufen**.

Provider- und Kanal-Tokens landen automatisch hier. Backup-Keys als Wert *oder* Env-Name (`BACKUP_S3_ACCESS_KEY`). TOTP-Seed für 2FA ebenfalls hier (z. B. `github-totp`, Scope **System**) oder im macOS-Schlüsselbund (`-s <Name>` / `eyas-totp-<Name>`). `browser_totp` gibt nur den 6-stelligen Code; der geht an `browser_fill`. Der Seed steht nicht im Action-Cache. [Browser Use](/docs/de/automation/browser-use/).

Der API-Schlüssel der Grok CLI liegt hier als `grok-cli-api-key` (Scope **System**), wenn du auf der Anmeldekarte der Grok CLI **Stattdessen API-Schlüssel verwenden** wählst. EYAS übergibt ihn nur an Läufe der Grok CLI, als `XAI_API_KEY`. Du kannst ihn auch hier unter diesem Namen anlegen; **Abmelden** im Anbieter-Panel löscht ihn. Siehe [Anbieter — Grok und Kimi für EYAS anmelden](/docs/de/ai/providers/#sign-in-grok-and-kimi-for-eyas). Die Gerätecode-Anmeldungen von Grok und Kimi sind keine Geheimnisse in diesem Store, sondern Dateien in EYAS' eigenen CLI-Homes.

## Verwandt

- [Setup — Master-Passwort](/docs/de/setup-wizard/)
- [Anbieter](/docs/de/ai/providers/)
- [Sicherung](/docs/de/admin/backup/)
- [Kanäle](/docs/de/communication/channels/)
- [Browser Use](/docs/de/automation/browser-use/) (`browser_totp`)
