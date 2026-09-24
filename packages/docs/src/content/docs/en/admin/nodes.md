---
title: Remote nodes
description: Other machines EYAS can reach (SSH, WebSocket, Tailscale) so agents can run work off this box.
---

**What this is for.** Remote Nodes is the inventory of other machines this EYAS instance can reach. You register a name, host, and connection type so agents can run work off this box — typically over SSH. Health is **online**, **offline**, or **unknown**. This page is the registry; it is not Observability telemetry and not a Hand (desktop/CLI pairing).

## When to use it

- You want an agent to run a command on another host, not only on this instance.
- You are adding a machine you reach by **SSH**, **WebSocket**, or **Tailscale**.
- You need to see whether a node was last seen, or to rename / retarget / remove it.
- You need a guarded SSH invoke (destructive patterns blocked unless forced) — that is an API on SSH nodes, not a button on this page.

## Typical workflow

1. Open the sidebar **Settings** group **Infrastructure** → **Nodes** (`/nodes`).
2. Click **Add Node**.
3. Fill **Name** (placeholder `my-node`), **Host** (placeholder `192.168.1.100:3100`), and **Type** (**SSH**, **WebSocket**, or **Tailscale**).
4. Click **Save**. The card appears with a status dot and the type badge.
5. Pencil edits name, host, and type. Trash removes the node.

Empty state: *No remote nodes configured*. After save you should see the host in monospace and, when known, **Last seen**.

## Features

Each card shows **Name**, a status dot, a **Type** badge, **Host**, and **Last seen** when the registry has a timestamp.

Status colours on this page: **online** (green), **offline** (red), **unknown** (amber). New nodes start **offline** until something marks them seen.

**Type** in the dialog is **SSH**, **WebSocket**, or **Tailscale**. The add/edit dialog does not collect a capabilities list; the node record can still store capabilities for agents.

SSH nodes can be invoked through a guarded executor (`POST` invoke). Patterns such as `rm -f` / `rm -r`, `mkfs`, `dd if=`, and fork bombs are refused unless `forceDestructive` is explicitly true. Non-SSH types return “not implemented” for invoke. Credentials (username, password or private key) come from the invoke body or the node’s stored config — never logged.

WebSocket and Tailscale types are inventory + health on this page; they do not gain an invoke button here.

## Fields and controls

<h2 id="add-node">Add / edit node</h2>

| Control | Meaning |
|---------|---------|
| **Add Node** | Open the create dialog |
| Node count | Header badge when at least one node exists |
| **Name** | Human label. Placeholder `my-node` |
| **Host** | Address. Placeholder `192.168.1.100:3100` |
| **Type** | **SSH**, **WebSocket**, or **Tailscale** |
| **Save** / **Saving…** | Persist (disabled until name and host are non-empty) |
| Pencil | **Edit Node** — same fields |
| Trash | Delete the node |

<h2 id="health">Health</h2>

| Control | Meaning |
|---------|---------|
| Status dot | **online** / **offline** / **unknown** |
| Type badge | Connection type on the card |
| **Last seen** | Timestamp when the registry last marked the node seen |

## Related

- [Settings overview](/docs/en/admin/settings/)
- [Hands](/docs/en/admin/hands/)
- [Notifications](/docs/en/admin/notifications/)
- [Extensions](/docs/en/admin/extensions/)
- [Ingress](/docs/en/admin/ingress/)
- [Observability & ops](/docs/en/admin/observability/)
- [Secrets](/docs/en/admin/secrets/)
