---
title: Secrets & API keys
description: Encrypted vault for provider/channel keys, plus machine API keys for the EYAS API.
---

**What this is for.** Two different kinds of secret live here. **Secrets** (`/secrets`) is the encrypted key-value store: provider API keys, channel tokens, backup destination keys. Values never appear in logs. **API keys** (`/api-keys`) are credentials *for calling EYAS*, not for calling Anthropic. The master password from setup encrypts payloads.

## When to use it

- A provider card says **No API key** and you want to store it in the vault (the provider panel also writes here).
- A channel token should not sit in YAML or shell history.
- CI needs programmatic access to this instance — issue an EYAS API key, copy it once, revoke later.
- You need to see whether a secret is **system / user / agent** scoped.

## Typical workflow

1. Open **Secrets** (`/secrets`). Pick a **scope** tab: **System / User / Agent**.
2. **Add Secret** — name (e.g. `my-api-key`) and value. Save. Empty: *No secrets in this scope*.
3. Open **API Keys** (`/api-keys`). **Create API Key** — name, optional expiry in days.
4. Copy the key from the banner immediately: *Copy this key now. It will not be shown again.*
5. **Revoke** unused keys (cannot be undone).

## Features

Provider keys you paste on [Providers](/docs/en/ai/providers/) land in this vault automatically. Channel tokens from [Communication](/docs/en/communication/channels/) do too. Backup offsite keys can be pasted as values *or* as env var names (e.g. `BACKUP_S3_ACCESS_KEY`).

A TOTP seed for 2FA form-fill lives here too (name e.g. `github-totp`, scope **System**), or in the macOS Keychain (`security find-generic-password -s <name>` / `eyas-totp-<name>`). `browser_totp` returns only the 6-digit code; pass it to `browser_fill`. The seed never appears in the action cache. See [Browser Use](/docs/en/automation/browser-use/).

## Fields and controls

<h2 id="secrets">Secrets (`/secrets`)</h2>

Subtitle: *Encrypted key-value store.*

| Concept | Meaning |
|---------|---------|
| Master password | Set at setup — encrypts secret payloads |
| Scope | **System / User / Agent** |
| **Add Secret** | Name + value |
| Columns | **Scope**, **Module**, **Created** |
| Used by | Providers, channels, integrations |

<h2 id="api-keys">API keys (`/api-keys`)</h2>

Subtitle: *Manage API keys for programmatic access.*

| Control | Meaning |
|---------|---------|
| **Create API Key** | Issue a new key |
| Name | e.g. CI/CD, CLI tool |
| Expires in days | Optional; empty = no expiry |
| **Key Prefix** | Shown after create; full key only once |
| **Last Used / Expires** | Usage and expiry |
| Revoke | Permanent |

Empty: *No API keys. Create one to enable programmatic access.*

## Related

- [Setup — master password](/docs/en/setup-wizard/)
- [Providers](/docs/en/ai/providers/)
- [Backup](/docs/en/admin/backup/)
- [Channels](/docs/en/communication/channels/)
- [Browser Use](/docs/en/automation/browser-use/) (`browser_totp`)
