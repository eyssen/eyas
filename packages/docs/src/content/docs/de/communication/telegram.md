---
title: Telegram
description: BotFather-Token, Secrets-Vault, Agent-Bindung und Pairing für DMs.
---

**Wozu das da ist.** Telegram ist der First-Class-Chat-Kanal: ein BotFather-Bot, dessen DMs (nach Pairing) einen gebundenen EYAS-Agenten laufen lassen. Secrets landen im Vault, nicht in YAML.

**Route:** `/communication` → **Kanäle** → Telegram. Pairing: **Kommunikation → Pairing**.

## Wann du es brauchst

- Assistent vom Handy.
- Zweiter Bot (Arbeit vs. privat) als weitere Instanz.
- DMs werden ignoriert — Pairing noch nicht freigegeben.
- Gelbes/rotes Tool wartet, und du willst **Freigeben** / **Ablehnen** in Telegram.
- Neuer Thread aus demselben Chat (`/new` oder `/start`).

## Typischer Ablauf

1. Telegram → **@BotFather** → `/newbot`.
2. HTTP-API-Token kopieren.
3. In EYAS Token einfügen, **Agent für eingehende Nachrichten**, **Speichern & verbinden**.
4. Bot anschreiben. Code unter **Pairing** freigeben.
5. Weitere DMs dieses Senders laufen denselben Conversation. Leeres Token-Feld behält den gespeicherten Wert. `/new` oder `/start` startet einen neuen Thread.

## Felder

| Feld | Bedeutung |
|------|-----------|
| **Bot-Token von @BotFather** | Telegram-Bot-API-Token (verschlüsselt, Key `telegram-bot-token`) |
| **Agent für eingehende Nachrichten** | Wer antwortet |
| **Speichern & verbinden** | Persist + Connect |
| **gesetzt** | Token schon da; leer = behalten |

Pairing-Badge auf der Karte. Mehrere Bots = mehrere Instanzen. Modus Autonom/Verwaltet wie andere Kanäle.

Nach Pairing legt die **erste Nachricht** eine Conversation an; weitere Nachrichten setzen sie fort. `/new`, `/start`, `/new@bot` lösen das Mapping — der Bot antwortet *Started a new conversation. Send a message to begin.* Der Slash-Befehl geht **nicht** an das Modell.

Gelbes/rotes Tool: Telegram-Ping mit **Approve** / **Deny** an den Chat der Conversation (sonst ein freigegebenes Pairing). Dieselbe [Autonomie](/docs/de/agents/autonomy/)-`decide()`-Strecke. Der Ping nennt Tool und Kurzgrund — **nie** rohe Tool-Args.

## Verwandt

- [Kanäle](/docs/de/communication/channels/)
- [Geheimnisse](/docs/de/admin/secrets/)
- [Agenten — Kanäle](/docs/de/agents/configure/)
- [Autonomie](/docs/de/agents/autonomy/)
