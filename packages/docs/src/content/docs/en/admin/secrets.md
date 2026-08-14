---
title: Secrets & API keys
description: Encrypted secrets store and machine API keys.
---

## Secrets

**Route:** `/secrets`.

| Concept | Meaning |
|---------|---------|
| Master password | Set at setup — encrypts secret payloads |
| Scope | system / user / agent boundaries |
| Secret entry | Name + value; value never shown in logs |
| Used by | Providers, channels, integrations |

## API keys (machine)

**Route:** `/api-keys`.

Issue keys for programmatic access to EYAS APIs (not provider keys). Revoke when unused.

## Related

- [Setup — master password](/docs/en/setup-wizard/)
- [Providers](/docs/en/ai/providers/)
