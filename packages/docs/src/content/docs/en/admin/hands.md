---
title: Hands
description: Pair a local “hand” so EYAS can use CLIs and desktop automation on a machine you control.
---

**What this is for.** Hands is the pairing hub for EYAS Hand clients — machines you control that expose CLI tools, OS automation, and/or computer-use to this server. A short-lived pairing code binds the device; connected hands report platform, architecture, OS, capabilities, and how many CLI/app tools they discovered. This is not a remote SSH node and not Observability.

## When to use it

- You want the agent to run a CLI or desktop action on *your* Mac, Windows, or Linux box, not only inside the server process.
- You are pairing a new Hand client and need a code that expires in five minutes.
- You need to see whether a hand is connected, what it can do (**CLI**, **OS Automation**, **Computer Use**), and how many tools it found.
- You want to disconnect a device you no longer trust.

## Typical workflow

1. Open the sidebar **Settings** group **Infrastructure** → **Hands** (`/hands`).
2. Click **Generate Pairing Code**. A large **Pairing Code** appears; it **Expires in 5 minutes — enter this code on your Hand device**.
3. Enter the code on the Hand client. The code disappears from this page when it expires.
4. **Refresh** if the new card is not visible yet.
5. Confirm platform · arch · OS, capability badges, and tool count, then keep the hand or **Disconnect**.

Empty state: *No hands connected* / *Generate a pairing code and connect an EYAS Hand client*. After pairing you should see a green connected dot and the short hand id.

## Features

Pairing codes last **300 seconds** (five minutes) and then vanish from the page. Generate failures show an error banner.

Each connected hand shows: name, short id, `platform · arch · osVersion`, **N tools**, protocol version, relative **Last seen**, and capability badges. Platform icons: Darwin, Windows, Linux (generic otherwise).

Capabilities reported by the client:

| Badge | Meaning |
|-------|---------|
| **CLI** | Command-line tools on that machine |
| **OS Automation** | OS-level automation |
| **Computer Use** | Desktop / computer-use |

Discovered tools are **cli** or **app** (id, name, path, optional version). This page shows the **count**, not a per-tool list.

**Disconnect** unregisters the hand (and tears down an MCP transport if that is how it connected). **Refresh** reloads the list.

## Fields and controls

<h2 id="pairing">Pairing code</h2>

| Control | Meaning |
|---------|---------|
| **Generate Pairing Code** / **Generating…** | Mint a code for the current user |
| **Pairing Code** | Large monospace code to type on the Hand |
| Expires in *n* minutes | Countdown copy; the card clears when the TTL elapses |
| **Refresh** | Reload connected hands |

<h2 id="connected-hands">Connected hands</h2>

| Control | Meaning |
|---------|---------|
| Name + short id | Hand label and first eight characters of `handId` |
| platform · arch · osVersion | Machine identity |
| **N tools** | How many CLI/app tools the hand reported |
| Protocol v*n* | Hand protocol version |
| **Last seen** | Relative time (*just now*, *Nm ago*, *Nh ago*, *Nd ago*) |
| **CLI** / **OS Automation** / **Computer Use** | Capability badges |
| Connected dot | Green while listed as connected |
| **Disconnect** / **Disconnecting…** | Unregister this hand |

## Related

- [Settings overview](/docs/en/admin/settings/)
- [Remote nodes](/docs/en/admin/nodes/)
- [Notifications](/docs/en/admin/notifications/)
- [Extensions](/docs/en/admin/extensions/)
- [Tools](/docs/en/automation/tools/)
- [MCP servers](/docs/en/ai/mcp/)
