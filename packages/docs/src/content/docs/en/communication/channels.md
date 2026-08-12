---
title: Channels overview
description: Channel instances, modes, binding agents, inbound queue, pairing.
---

**Route:** `/communication` → tabs **Channels · Inbound Queue · Pairing**.

Subtitle: *Connect messaging channels and bind them to your primary agent.*

## Multi-instance

You can run **several accounts of the same type** (e.g. two Telegram bots), each with its own credentials and agent. Use **Add instance** or per-card **Add … instance**.

## Create instance

| Field | Meaning |
|-------|---------|
| **Channel type** | Template (Telegram, Signal, …) |
| **Display name** | e.g. Work Signal, Personal Telegram |
| **Create & connect** | Create instance and start connect flow |
| **Delete instance** | Remove instance + its credentials (confirm) |

## Instance status

| Status | Meaning |
|--------|---------|
| **Connected** | Live connection |
| **Disconnected** | Not connected |
| **Credentials set** | Secrets stored, may need Connect |
| **Not configured** | Missing secrets |
| **Error** | Last error |
| Health **Conflict / Auth error / Degraded** | Operational health |

## Mode

| Mode | Meaning |
|------|---------|
| **Autonomous** | Runs unattended; graduated-autonomy ladder still gates actions |
| **Managed** | Security gate governs every tool call |

Click toggles between modes (tooltips explain each).

## Credentials & agent binding

| Field | Meaning |
|-------|---------|
| Secret fields | Channel-specific (see Telegram / Signal sections) |
| *Leave blank to keep current value* | Placeholder when editing |
| **set** badge | Secret already stored |
| **Agent for inbound messages** | Which agent answers; default primary assistant |
| **— none (messages stored, no auto-reply) —** | Store only |
| **Bound agent** | Currently bound agent |
| **Save & connect** | Persist secrets and connect |
| **Test / Connect / Disconnect / Reconnect / Configure** | Lifecycle actions |

## Inbound Queue tab

Queued inbound messages awaiting processing/display (timestamps as *Ns/Nm/Nh ago*).

## Pairing tab

Channels that require **pairing** (e.g. Telegram DMs) show a **Pairing** badge. Approve pairing codes here before DMs work.

## Related

- [Telegram](/docs/en/communication/telegram/)
- [Agents — channels tab](/docs/en/agents/configure/)
