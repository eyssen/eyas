---
title: Kanäle — Überblick
description: Externe Messaging-Instanzen — Typen, Modi, Inbound-Queue, Pairing. Nicht Verbindungen, nicht Hände.
---

**Wozu das da ist.** Kanäle sind, wie Menschen außerhalb dieser Maschine einem EYAS-Agenten schreiben: Telegram, Slack, E-Mail und der Rest des Katalogs. Jede Instanz hat eigene Secrets und einen gebundenen Agenten. Das ist **nicht** [Verbindungen](/docs/de/admin/connections/) und **nicht** [Hände](/docs/de/admin/hands/). MCP und A2A leben auf eigenen Seiten.

**Route:** `/communication` → **Kanäle · Eingangsqueue · Pairing**.

## Wann du es brauchst

- Mit dem Primary-Agenten von Telegram (oder einem anderen Katalogtyp) ohne Web-UI.
- Zwei Bots desselben Typs — zweite Instanz.
- Inbound hängt — Queue, **dead**-Zeile neu einreihen.
- Telegram-DM wartet auf Pairing-Code.

## Typischer Ablauf

1. **Kommunikation** (`/communication`) → **Kanäle**.
2. Karte aufklappen oder **Instanz hinzufügen**.
3. Secrets, **Agent für eingehende Nachrichten**, **Speichern & verbinden**.
4. **Autonom** oder **Verwaltet**.
5. Telegram-DMs: Bot anschreiben, Code unter **Pairing**. **Eingangsqueue** bei Fehlern.

## Funktionen

Mehrere Konten desselben Typs. Katalog (MCP/A2A **keine** Chat-Kanäle):

| Typ | Pairing | Extra |
|-----|---------|-------|
| **Telegram** | Ja | [Telegram](/docs/de/communication/telegram/) |
| **Discord** | Nein | `discord.js` |
| **Slack** | Nein | Socket Mode, Tokens `xoxb-` + `xapp-` |
| **E-Mail (SMTP/IMAP)** | Nein | SMTP Pflicht, IMAP optional |
| **Gmail (API)** | Nein | OAuth |
| **Microsoft 365 (Graph)** | Nein | App-Credentials |
| **WhatsApp Business** | Nein | Webhook `/api/v1/webhooks/whatsapp` |
| **Signal** | Nein | signal-cli-HTTP-Bridge; EYAS bettet Signal nicht ein |
| **Google Chat** | Nein | Webhook `/api/v1/channels/googlechat/webhook` |
| **Microsoft Teams** | Nein | Webhook `/api/v1/channels/teams/webhook` |

Status: Connected / Disconnected / Credentials set / Not configured / Error. Modus: Autonom (Autonomy-Leiter) / Verwaltet (Security-Gate). Queue: pending / delivered / dead / skipped, Retry. Pairing: Approve/Reject, überlebt Restarts.

## Verwandt

- [Telegram](/docs/de/communication/telegram/)
- [A2A](/docs/de/communication/a2a/)
- [Agenten — Kanäle](/docs/de/agents/configure/)
- [Verbindungen](/docs/de/admin/connections/)
- [Hände](/docs/de/admin/hands/)
- [Ingress](/docs/de/admin/ingress/)
