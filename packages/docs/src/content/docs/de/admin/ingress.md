---
title: Ingress-Tunnel
description: EYAS remote über einen Cloudflare-Tunnel erreichbar machen.
---

**Route:** `/ingress`.

Ingress startet einen **Cloudflare Tunnel** (`cloudflared`), damit diese EYAS-Instanz außerhalb des lokalen Netzes erreichbar ist — ohne eingehende Ports.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Status** | Verbunden oder getrennt; öffentliche URL, wenn der Tunnel läuft |
| **Start / Stop** | `cloudflared` starten oder beenden |
| **Tunnel-Token** | Token aus dem Cloudflare Zero Trust-Tunnel — **Einstellungen speichern** legt es im Vault ab |
| **Hostname** | Öffentlicher Name am Tunnel in Cloudflare (z. B. `eyas.example.com`) |
| **Einstellungen speichern** | Hostname + Token dauerhaft. Start nutzt das gespeicherte Token, wenn das Feld leer ist |

## Voraussetzungen

1. [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installieren und im `PATH` halten.
2. Im [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) einen Tunnel anlegen und das Token kopieren.
3. Den Tunnel auf diese Instanz zeigen (typisch `http://127.0.0.1:3100`).

Das Token ist ein Geheimnis — lieber Vault oder Umgebungsvariable als Shell-History.

## Verwandt

- [Einstellungen](/docs/de/admin/settings/)
- [Secrets](/docs/de/admin/secrets/)
- [Observability & Ops](/docs/de/admin/observability/)
- [Sicherheit](/docs/de/admin/security-privacy/)
