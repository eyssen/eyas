---
title: Telegram
description: BotFather token, secrets vault, agent binding, and pairing for DMs.
---

**What this is for.** Telegram is the first-class chat channel: a BotFather bot whose inbound DMs (after pairing) run a bound EYAS agent. Setup is about one minute plus a pairing approve. Secrets land in the encrypted vault, not in YAML.

**Route:** `/communication` → **Channels** → Telegram card. Pairing: **Communication → Pairing**.

## When to use it

- You want to message your assistant from your phone.
- You need a second bot (work vs personal) as another instance.
- DMs are ignored and you have not approved pairing yet.

## Typical workflow

1. Open Telegram → **@BotFather** → `/newbot` — display name + username ending in `bot`.
2. Copy the HTTP API token (`123456:ABC-…`).
3. In EYAS **Communication**, expand Telegram, paste **Bot token from @BotFather**, choose **Agent for inbound messages**, press **Save & connect**.
4. Message the bot. Approve the pairing code under **Communication → Pairing**.
5. Further DMs from that sender run the bound agent. Leave the token field blank later to keep the stored value.

## Features

- Pairing-enabled: DMs need an **approved pairing** request first. The channel card shows a **Pairing** badge.
- Multiple bots = multiple instances (see [Channels overview](/docs/en/communication/channels/)).
- Token is stored encrypted (secrets scope: system, key `telegram-bot-token`).
- Mode **Autonomous / Managed** is the same toggle as other channels.

## Fields and controls

| Field | Meaning |
|-------|---------|
| **Bot token from @BotFather** | Telegram bot API token (stored encrypted) |
| Placeholder | Example token shape (`123456789:AAHdqTcv…`) |
| Hint | Telegram → @BotFather → `/newbot` → “Use this token to access the HTTP API” |
| **Agent for inbound messages** | Agent that answers DMs/groups as configured |
| **Save & connect** | Persist and connect |
| **set** | Token already stored; blank keeps it |

## Related

- [Channels overview](/docs/en/communication/channels/)
- [Secrets](/docs/en/admin/secrets/)
- [Agents — channels tab](/docs/en/agents/configure/)
