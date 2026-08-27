---
title: Ingress tunnel
description: Expose EYAS remotely through a Cloudflare tunnel.
---

**Route:** `/ingress`.

Ingress starts a **Cloudflare Tunnel** (`cloudflared`) so you can reach this EYAS instance from outside the local network without opening inbound ports.

| Control | Meaning |
|---------|---------|
| **Status** | Connected or disconnected; public URL when the tunnel is up |
| **Start / Stop** | Spawn or terminate `cloudflared` |
| **Tunnel token** | Token from the Cloudflare Zero Trust tunnel — **Save settings** stores it in the vault |
| **Hostname** | Public name you attached to the tunnel in Cloudflare (e.g. `eyas.example.com`) |
| **Save settings** | Persists hostname + token. Start reuses the saved token if the field is empty |

## Prerequisites

1. Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and keep it on `PATH`.
2. Create a tunnel: [Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create** → Cloudflared.
3. Open the tunnel → **Configure / Install connector** and copy only the `eyJ…` token after `--token` (not the tunnel name or UUID).
4. Point the tunnel at this instance (typically `http://127.0.0.1:3100`).

The token is a secret — prefer the Secrets vault or an env var over pasting it into shell history.

## Related

- [Settings overview](/docs/en/admin/settings/)
- [Secrets](/docs/en/admin/secrets/)
- [Observability & ops](/docs/en/admin/observability/)
- [Security](/docs/en/admin/security-privacy/)
