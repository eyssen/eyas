---
title: Ingress He
description: Cloudflare He lo'taHvIS Hurvo' EYAS yInarghmoH.
---

**He:** `/ingress`.

Ingress **Cloudflare Tunnel** (`cloudflared`) tagh. naDev HeDaq lojmIt poSmoHbe'taHvIS Hurvo' EYASvam DapollaH.

| SeHwI' | Del |
|--------|-----|
| **Dotlh** | rar pagh rarHa' ; He Qapchugh Hur URL |
| **yItagh / yImev** | `cloudflared` yIchu' pagh yImev |
| **He chaw'** | Cloudflare Zero Trust He chaw' — **SeHmey yItoD** vaultDaq qon |
| **Hur pong** | CloudflareDaq HeDaq rarlu'bogh Hur pong (chov: `eyas.example.com`) |
| **SeHmey yItoD** | Hur pong + chaw' qon. chImchugh mIw, tagh qonta'bogh chaw' lo'qa' |

## taghpa' poQ

1. [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) yIlIng 'ej `PATH`Daq yIpol.
2. He yIchu': [Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create** → Cloudflared.
3. He yIpoS → **Configure / Install connector** 'ej `--token` 'emvo' `eyJ…` chaw' neH yIqon (He pong pagh UUID Qo').
4. Hevam EYASDaq yInob (motlh `http://127.0.0.1:3100`).

chaw' pegh 'oH — pegh qawHaq pagh env yIlo' ; shell QonoSDaq yIchelQo'.

## latlh

- [SeHmey Del](/docs/tlh/admin/settings/)
- [peghmey](/docs/tlh/admin/secrets/)
- [AI bej 'ej vum](/docs/tlh/admin/observability/)
- [Hub](/docs/tlh/admin/security-privacy/)
