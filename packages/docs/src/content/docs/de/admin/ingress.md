---
title: Ingress-Tunnel
description: Diese EYAS von außerhalb des LAN über einen Cloudflare-Tunnel — ohne eingehende Ports.
---

**Wozu das da ist.** Ingress startet einen **Cloudflare Tunnel** (`cloudflared`), damit Handy, zweites Büro oder Webhook-Provider diese Instanz erreichen, ohne Router-Ports. Das ist Fernzugriff *auf diese Box*, kein [Remote-Knoten](/docs/de/admin/nodes/) und keine [Hand](/docs/de/admin/hands/).

**Route:** `/ingress`. Sidebar: **Ingress**.

## Wann du es brauchst

- `https://eyas.example.com` ohne Port-Forward.
- Telegram/WhatsApp/Teams-Webhooks brauchen öffentliches HTTPS.
- Unterwegs UI, Cloudflare davor.

## Typischer Ablauf

1. [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) auf `PATH`.
2. Tunnel in Zero Trust anlegen.
3. Nur das `eyJ…`-Token nach `--token` kopieren.
4. Tunnel auf `http://127.0.0.1:3100` (**3100**, nicht 3000).
5. **Tunnel-Token** + **Hostname**, **Einstellungen speichern**, **Start**. Status zeigt die öffentliche URL.

Token ist ein Secret. **Start** nutzt den gespeicherten Token, wenn das Feld leer ist.

## Verwandt

- [Einstellungen](/docs/de/admin/settings/)
- [Geheimnisse](/docs/de/admin/secrets/)
- [Observability](/docs/de/admin/observability/)
- [Sicherheit](/docs/de/admin/security-privacy/)
- [Kanäle](/docs/de/communication/channels/)
- [Knoten](/docs/de/admin/nodes/)
