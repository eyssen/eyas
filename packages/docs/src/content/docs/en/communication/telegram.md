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
- A yellow or red tool is waiting and you want **Approve** / **Deny** on Telegram instead of opening the web UI.
- You want a fresh thread from the same chat (`/new` or `/start`).

## Typical workflow

1. Open Telegram → **@BotFather** → `/newbot` — display name + username ending in `bot`.
2. Copy the HTTP API token (`123456:ABC-…`).
3. In EYAS **Communication**, expand Telegram, paste **Bot token from @BotFather**, choose **Agent for inbound messages**, press **Save & connect**.
4. Message the bot. Approve the pairing code under **Communication → Pairing**.
5. Further DMs from that sender run the bound agent on the same conversation. Leave the token field blank later to keep the stored value. Send `/new` or `/start` when you want a new thread.

## Features

- Pairing-enabled: DMs need an **approved pairing** request first. The channel card shows a **Pairing** badge.
- Multiple bots = multiple instances (see [Channels overview](/docs/en/communication/channels/)).
- Token is stored encrypted (secrets scope: system, key `telegram-bot-token`).
- Mode **Autonomous / Managed** is the same toggle as other channels.

<h3 id="threads">Threads</h3>

After pairing, the **first message** creates a conversation. Later messages from that chat continue the same mapping. `/new`, `/start`, and `/new@bot` drop the mapping — the bot replies *Started a new conversation. Send a message to begin.* The slash command itself is **not** sent to the model. There is no ticket ingest on this channel.

<h3 id="approval-ping">Approve / Deny from Telegram</h3>

When a yellow or red tool is waiting, EYAS pings the conversation's Telegram chat (or an approved pairing if this thread has no mapping) with **Approve** and **Deny**. The buttons use the same [Autonomy](/docs/en/agents/autonomy/) decide path as the web queue, so a parked run resumes. The ping names the tool and a short reason — **never** raw tool arguments.

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
- [Autonomy](/docs/en/agents/autonomy/)
