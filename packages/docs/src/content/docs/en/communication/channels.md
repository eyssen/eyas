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

### Channel types (catalogue) {#channel-types}

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

### Create instance {#create-instance}

| Field | Meaning |
|-------|---------|
| **Channel type** | Template from the catalogue |
| **Display name** | e.g. Work Signal, Personal Telegram |
| **Create & connect** | Create instance and start connect flow |
| **Delete instance** | Remove instance + its credentials (confirm) |

### Instance status {#status}

| Status | Meaning |
|--------|---------|
| **Connected** | Live connection |
| **Disconnected** | Not connected |
| **Credentials set** | Secrets stored, may need Connect |
| **Not configured** | Missing secrets |
| **Error** | Last error |
| Health **Conflict / Auth error / Degraded** | Operational health |

### Mode {#mode}

| Mode | Meaning |
|------|---------|
| **Autonomous** | Runs unattended; graduated-autonomy ladder still gates actions |
| **Managed** | Security gate governs every tool call |

Click toggles between modes (tooltips explain each).

### Memory in channel replies {#memory-in-replies}

A reply spoken in the owner's **internal** voice gets the same recalled-memory block, with the current date and time, as a chat turn (see [Memory — How recall reaches the model](/docs/en/knowledge/memory/#how-recall-reaches-the-model)). A reply whose voice scope is **External** — **Force External** set on the conversation, or a temporary override — gets the date and time only: no recalled owner memory is pushed to an outside reader. If EYAS cannot determine a reply's voice scope, the reply also goes out without recalled memory. The memory tools are unchanged and stay governed by the security gate.

The bound agent's **Tools** list applies to channel replies as on every other path, plus `memory_search` and `memory_expand` ([Configure — Tools](/docs/en/agents/configure/#tools--constraints)). What channel senders write is remembered as *peer* text, not as yours.

**Memory capture on channel replies.** Each channel reply now also runs EYAS's durable-memory capture, under the same `memory.capture.*` settings as a chat turn. The sender's message is read as a third party's words: it can never create a note about who you are or a rule for how EYAS should work, it can produce only `reference`, `project` or `domain` notes, which carry `trust: peer` and are stored at peer trust, and such a note never adds to one of your own notes. The length gate counts only the sender's words, so a short "ok" buys no model call, and a channel conversation shares one `maxPerConversation` ceiling across all its messages. See [Memory — Capture is on by default](/docs/en/knowledge/memory/#capture-is-on-by-default).

**Model and effort.** A channel conversation follows the bound agent's model; if the agent has none, the install default is fixed on the conversation with its first reply. The agent's own reasoning effort applies too. Each channel reply records the provider and model that answered, and the effort it ran with.

### Refused messages (privacy) {#refused-messages}

A channel always counts as a remote destination. An inbound message that carries a value the privacy policy sets to **block** — by default an IBAN, bank account number, tax number, personal ID card number, card number or US SSN, plus any custom pattern set to block — is refused before anything is stored:

- The sender gets an automatic reply in the language they wrote in (English, Hungarian, German, Spanish, French or Klingon; English if unclear). It names the types, never the values, and asks them to resend without those values.
- No conversation, message or agent run is created. In the **Inbound Queue** the event shows status **skipped** with error `privacy_blocked`, and only its masked text is kept. If sending the notice fails, the event is retried like any delivery.
- Messages already stored before a policy change are not refused later. E-mail addresses and phone numbers (mask class) and warn-class values are never refused.

Every refusal is audited as `privacy.inbound_refused` (types and the inbound event id, never a value). See [Security & privacy — Refused messages](/docs/en/admin/security-privacy/#refused-messages).

### Credentials & agent binding {#credentials}

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

### Inbound Queue tab {#inbound}

Durable at-least-once queue of inbound channel messages. Failed deliveries back off and dead-letter; **dead** rows can be re-queued.

| Column | Meaning |
|--------|---------|
| **Source** | Channel instance |
| **Sender** | Sender id / name |
| **Message** | Body |
| **Attempts** | Delivery tries |
| **Received** | Age (*Ns/Nm/Nh ago*) |

The **Status** column shows **pending**, **delivered**, **dead** or **skipped**; the reason of a failed or skipped row appears under the message (for example `privacy_blocked`, see [above](#refused-messages)). **Retry** on a **dead** row queues it again; **Refresh** reloads the list.

### Pairing tab {#pairing}

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
