---
title: Ingress tunnel
description: Reach this EYAS from outside the LAN through a Cloudflare Tunnel — no inbound ports.
---

**What this is for.** Ingress starts a **Cloudflare Tunnel** (`cloudflared`) so phones, a second office, or a webhook provider can reach this instance without you opening inbound ports on the router. It is remote *access to this box*, not a [remote node](/docs/en/admin/nodes/) (a machine agents SSH into) and not a [Hand](/docs/en/admin/hands/).

**Route:** `/ingress`.

## When to use it

- You want `https://eyas.example.com` on this laptop/VPS without port-forwarding.
- Telegram/WhatsApp/Teams webhooks need a public HTTPS URL.
- You are travelling and still want the UI, with Cloudflare in front.

## Typical workflow

1. Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and keep it on `PATH`.
2. Create a tunnel: [Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create** → Cloudflared.
3. Open the tunnel → **Configure / Install connector** and copy only the `eyJ…` token after `--token` (not the tunnel name or UUID).
4. Point the tunnel at this instance (typically `http://127.0.0.1:3100` — **3100**, not 3000).
5. In EYAS **Ingress** (`/ingress`), paste **Tunnel token** and **Hostname**, **Save settings**, **Start**. Status shows the public URL when up.

## Features

The token is a secret — prefer the Secrets vault or an env var over pasting it into shell history. **Start** reuses the saved token if the field is empty.

## Fields and controls

| Control | Meaning |
|---------|---------|
| **Status** | Connected or disconnected; public URL when the tunnel is up |
| **Start / Stop** | Spawn or terminate `cloudflared` |
| **Tunnel token** | Token from the Cloudflare Zero Trust tunnel — **Save settings** stores it in the vault |
| **Hostname** | Public name you attached to the tunnel in Cloudflare (e.g. `eyas.example.com`) |
| **Save settings** | Persists hostname + token. Start reuses the saved token if the field is empty |

## Related

- [Settings overview](/docs/en/admin/settings/)
- [Secrets](/docs/en/admin/secrets/)
- [Observability & ops](/docs/en/admin/observability/)
- [Security](/docs/en/admin/security-privacy/)
- [Channels](/docs/en/communication/channels/) (webhook types)
- [Nodes](/docs/en/admin/nodes/)
