---
title: Channels overview
description: External messaging instances — types, modes, inbound queue, pairing. Not Connections, not Hands.
---

**What this is for.** Channels are how people outside this machine message an EYAS agent: Telegram, Slack, email, and the rest of the catalogue. Each instance has its own secrets and a bound agent. This is **not** [Connections](/docs/en/admin/connections/) (Odoo, GitHub, MCP inventory) and **not** [Hands](/docs/en/admin/hands/) (a local device that offers OS/CLI tools). MCP and A2A are integrations of a different shape and live on their own pages.

**Route:** `/communication` → tabs **Channels · Inbound Queue · Pairing**. Subtitle: *Connect messaging channels and bind them to your primary agent.*

## When to use it

- You want to talk to your primary agent from Telegram (or another catalogue type) without opening the web UI.
- You run two bots of the same type (work + personal) and need a second instance.
- Inbound messages are stuck and you need the durable queue (retry a **dead** row).
- A Telegram DM is waiting on a pairing code.

## Typical workflow

1. Open **Communication** (`/communication`) on the **Channels** tab.
2. Expand a catalogue card, or **Add instance** for another account of the same type.
3. Paste the secrets, pick **Agent for inbound messages**, press **Save & connect**.
4. Choose **Autonomous** (unattended, still gated by the autonomy ladder) or **Managed** (security gate on every tool call).
5. For Telegram DMs: message the bot, then approve the code on **Pairing**. Watch **Inbound Queue** if deliveries fail.

## Features

You can run **several accounts of the same type** (e.g. two Telegram bots), each with its own credentials and agent. Use **Add instance** or per-card **Add … instance**.

### Channel types (catalogue)

These are the messaging types EYAS lists. MCP / A2A are **not** chat channels.

| Type | What you connect | Pairing | Extra |
|------|------------------|---------|-------|
| **Telegram** | BotFather HTTP API token | Yes — unknown DMs | First-class; see [Telegram](/docs/en/communication/telegram/) |
| **Discord** | Application bot token | No | Needs `discord.js` at runtime |
| **Slack** | Bot token (`xoxb-`) + app-level token (`xapp-`) | No | Socket Mode — no public webhook |
| **Email (SMTP/IMAP)** | SMTP (required) + optional IMAP | No | Any mailbox |
| **Gmail (API)** | OAuth client id/secret, refresh token, mailbox | No | Gmail API |
| **Microsoft 365 (Graph)** | Tenant, client id/secret, mailbox UPN | No | Graph app credentials |
| **WhatsApp Business** | Phone number id, access token, verify token, app secret | No | Webhook `/api/v1/webhooks/whatsapp` |
| **Signal** | Bot E.164 number + signal-cli HTTP bridge URL | No | EYAS does not embed Signal |
| **Google Chat** | Project/app id, optional send token and default space | No | Webhook `/api/v1/channels/googlechat/webhook` |
| **Microsoft Teams** | App id, app password, optional tenant | No | Webhook `/api/v1/channels/teams/webhook` |

Each card expands **How to set this up** with numbered steps before the credential form. Webhook types also list **Webhook paths to expose**.

## Fields and controls

<h2 id="create-instance">Create instance</h2>

| Field | Meaning |
|-------|---------|
| **Channel type** | Template from the catalogue |
| **Display name** | e.g. Work Signal, Personal Telegram |
| **Create & connect** | Create instance and start connect flow |
| **Delete instance** | Remove instance + its credentials (confirm) |

<h2 id="status">Instance status</h2>

| Status | Meaning |
|--------|---------|
| **Connected** | Live connection |
| **Disconnected** | Not connected |
| **Credentials set** | Secrets stored, may need Connect |
| **Not configured** | Missing secrets |
| **Error** | Last error |
| Health **Conflict / Auth error / Degraded** | Operational health |

<h2 id="mode">Mode</h2>

| Mode | Meaning |
|------|---------|
| **Autonomous** | Runs unattended; graduated-autonomy ladder still gates actions |
| **Managed** | Security gate governs every tool call |

Click toggles between modes (tooltips explain each).

<h2 id="credentials">Credentials & agent binding</h2>

| Field | Meaning |
|-------|---------|
| Secret fields | Channel-specific (see the card / Telegram chapter) |
| *Leave blank to keep current value* | Placeholder when editing |
| **set** badge | Secret already stored |
| **Agent for inbound messages** | Which agent answers; default primary assistant |
| **— none (messages stored, no auto-reply) —** | Store only |
| **Bound agent** | Currently bound agent |
| **Save & connect** | Persist secrets and connect |
| **Test / Connect / Disconnect / Reconnect / Configure** | Lifecycle actions |

<h2 id="inbound">Inbound Queue tab</h2>

Durable at-least-once queue of inbound channel messages. Failed deliveries back off and dead-letter; **dead** rows can be re-queued.

| Column | Meaning |
|--------|---------|
| **Source** | Channel instance |
| **Sender** | Sender id / name |
| **Message** | Body |
| **Attempts** | Delivery tries |
| **Received** | Age (*Ns/Nm/Nh ago*) |

Statuses: **pending**, **delivered**, **dead**, **skipped**. Retry a dead row from the row action.

<h2 id="pairing">Pairing tab</h2>

Unknown senders get a pairing code and wait here. Approving grants the channel access to its bound agent; pairings survive restarts. Telegram is the catalogue type with **supportsPairing**.

| Control | Meaning |
|---------|---------|
| **Pairing** badge | On the channel card when pairing is required |
| **Approve / Reject** | Decision for a pending request |
| Columns | Source, Sender, Code, Requested |

Empty: *No pending pairing requests.*

## Related

- [Telegram](/docs/en/communication/telegram/)
- [A2A](/docs/en/communication/a2a/)
- [Agents — channels tab](/docs/en/agents/configure/)
- [Connections](/docs/en/admin/connections/)
- [Hands](/docs/en/admin/hands/)
- [Ingress](/docs/en/admin/ingress/)
