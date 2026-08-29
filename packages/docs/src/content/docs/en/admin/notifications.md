---
title: Notifications
description: Who gets told, on which channel, and how loudly — in-app, email, Telegram, webhook.
---

**What this is for.** Notification Settings is where you decide which events reach you, on which channel, and at what volume. Each preference is one event-pattern × channel row. You use this so budget warnings, agent events, and similar signals land in the in-app bell, email, Telegram, or a webhook — without waking you for noise. **Critical** severity always bypasses quiet hours and batching.

## When to use it

- You want the in-app bell for some events and **Telegram** or **Email** for others.
- You only want **Warning** and above, not every **Info**.
- You want a quiet window (including overnight), except for **Critical**.
- You want a digest instead of a burst of emails or webhook POSTs.
- You need a signed HTTPS webhook for an automation host (n8n, Zapier, Home Assistant, and the like).

## Typical workflow

1. Open the sidebar **Settings** group **Modules** → **Notifications** (`/notifications-settings`).
2. Under **Add Preference**, type an **Event pattern** (for example `agent.*`, `budget.warning`, or `*`).
3. Choose **Channel**, **Minimum severity**, and **Delivery mode**.
4. Optionally set **Quiet from** and **Quiet to**. Overnight ranges such as 22:00–07:00 work.
5. Click **Add**. The row appears under **Active Preferences**.
6. If the channel is **Webhook**, fill **Webhook Endpoint** and click **Save webhook**.

You should see the new row with its pattern, channel, ≥ severity, and optional **digest** / quiet badges.

## Features

One row per event-pattern × channel. Patterns are segment globs: `*` matches everything; `agent.*` matches one segment after `agent`; `budget.warning` matches that event only.

**Channel** options: **Web** (in-app / WebSocket push), **Email**, **Telegram**, **Webhook**. Email and Telegram only deliver when those integrations are actually configured (SMTP from Secrets / a paired Telegram bot). Picking the channel here does not create that integration.

**Immediate** sends now. **Batched** queues a digest (email and webhook; default window five minutes). **Web** and **Telegram** skip batching. **Critical** always sends immediately and ignores quiet hours.

Quiet hours use `HH:MM` and wrap overnight.

A webhook POST is JSON (`event`, `severity`, `title`, `body`, `data`, `createdAt`, `notificationId`). An optional shared secret adds `X-EYAS-Signature: sha256=…` (HMAC-SHA256). Extra HTTP headers can be stored on the endpoint (API); the form itself has URL, secret, and **Enabled**. The page hint: only https URLs; loopback and metadata hosts (`169.254.169.254`, `.internal`) are blocked.

Failed sends go to a retry queue (three attempts, exponential backoff starting at 30 seconds). After that they sit as **Failed (dead letter)**. **Retry Queue** is shown when retries are enabled.

The header bell lists notifications and mark-read. This page is preferences only.

## Fields and controls

<h2 id="preferences">Active preferences</h2>

| Control | Meaning |
|---------|---------|
| **Active Preferences** | Existing rows. Empty: *No preferences yet. Add one below.* |
| Event pattern badge | Glob that matched, for example `agent.*` |
| Channel badge | **Web** / **Email** / **Telegram** / **Webhook** |
| ≥ severity | Minimum severity this row accepts |
| **digest** | Shown when **Delivery mode** is **Batched** |
| quiet `from`–`to` | Quiet hours on this row |
| Trash | Delete that pattern × channel row |

<h2 id="add-preference">Add preference</h2>

| Control | Meaning |
|---------|---------|
| **Event pattern** | Placeholder: `agent.* or budget.warning or *` |
| **Channel** | **Web**, **Email**, **Telegram**, **Webhook** |
| **Minimum severity** | **Info**, **Warning**, **Error**, **Critical** |
| **Delivery mode** | **Immediate** or **Batched** |
| **Quiet from** / **Quiet to** | Time inputs. Both required to store quiet hours; leave blank for none |
| **Add** | Save the row (disabled until the pattern is non-empty) |

<h2 id="webhook">Webhook endpoint</h2>

| Control | Meaning |
|---------|---------|
| **URL** | Destination. Placeholder `https://hooks.example.com/eyas` |
| **Shared secret (optional — enables HMAC-SHA256 signatures)** | Password field. If a secret already exists: *(unchanged — leave blank to keep existing)* |
| **Enabled** | When unchecked, the webhook is stored but not used |
| **Save webhook** | Persist URL / secret / enabled (disabled until URL is non-empty) |
| **Remove** | Delete the stored webhook (only if one exists) |

<h2 id="retry-queue">Retry queue</h2>

| Control | Meaning |
|---------|---------|
| **Pending** | Retries still scheduled |
| **Failed (dead letter)** | Exhausted attempts |
| **Refresh** | Reload preferences, webhook, and retry stats |

## Related

- [Settings overview](/docs/en/admin/settings/)
- [Extensions](/docs/en/admin/extensions/)
- [Remote nodes](/docs/en/admin/nodes/)
- [Hands](/docs/en/admin/hands/)
- [Channels overview](/docs/en/communication/channels/)
- [Telegram](/docs/en/communication/telegram/)
- [Secrets](/docs/en/admin/secrets/)
