---
title: Telegram
description: BotFather token, secrets vault, agent-kötés és DM-párosítás.
---

**Mire való.** A Telegram az első osztályú chat-csatorna: BotFather bot, amelynek bejövő DM-jei (párosítás után) egy kötött EYAS agentet futtatnak. Setup kb. egy perc plusz egy párosítás-jóváhagyás. A titok a titkosított vaultba kerül, nem YAML-be.

**Útvonal:** `/communication` → **Csatornák** → Telegram kártya. Párosítás: **Kommunikáció → Párosítás**.

## Mikor használd

- A telefonodról akarod üzenni az asszisztensnek.
- Második bot (munka vs személyes) külön példányként.
- A DM-ek némák, és még nem hagytad jóvá a párosítást.

## Tipikus folyamat

1. Telegram → **@BotFather** → `/newbot` — megjelenő név + `bot`-ra végződő username.
2. Másold az HTTP API tokent (`123456:ABC-…`).
3. EYAS **Kommunikáció**, Telegram, **Bot token a @BotFather-től**, **Agent a bejövő üzenetekhez**, **Mentés és csatlakozás**.
4. Írj a botnak. Jóváhagyd a kódot **Kommunikáció → Párosítás**.
5. Ettől a küldőtől a további DM-ek a kötött agentet futtatják. Később üresen hagyott tokenmező megtartja a tárolt értéket.

## Funkciók

- Párosítás: a DM-ekhez **jóváhagyott párosítás** kell. A kártyán **Párosítás** badge.
- Több bot = több példány (lásd [Csatornák](/docs/hu/communication/channels/)).
- Token titkosítva (system scope, kulcs `telegram-bot-token`).
- **Önálló / Felügyelt** ugyanaz a kapcsoló, mint a többi csatornán.

## Mezők és vezérlők

| Mező | Jelentés |
|------|----------|
| **Bot token a @BotFather-től** | Telegram bot API token (titkosítva) |
| Placeholder | Példa alak (`123456789:AAHdqTcv…`) |
| Hint | Telegram → @BotFather → `/newbot` → „Use this token to access the HTTP API” |
| **Agent a bejövő üzenetekhez** | Ki válaszol |
| **Mentés és csatlakozás** | Persist + connect |
| **beállítva** | Token már tárolva; üres = megtartás |

## Kapcsolódó

- [Csatornák áttekintés](/docs/hu/communication/channels/)
- [Titkok](/docs/hu/admin/secrets/)
- [Agentek — csatornák](/docs/hu/agents/configure/)
