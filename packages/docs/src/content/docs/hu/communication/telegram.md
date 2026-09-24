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
- Sárga vagy piros tool vár, és Telegramon akarod **Jóváhagyás** / **Elutasítás**ra vinni.
- Új szálat akarsz ugyanabból a chatből (`/new` vagy `/start`).

## Tipikus folyamat

1. Telegram → **@BotFather** → `/newbot` — megjelenő név + `bot`-ra végződő username.
2. Másold az HTTP API tokent (`123456:ABC-…`).
3. EYAS **Kommunikáció**, Telegram, **Bot token a @BotFather-től**, **Agent a bejövő üzenetekhez**, **Mentés és csatlakozás**.
4. Írj a botnak. Jóváhagyd a kódot **Kommunikáció → Párosítás**.
5. Ettől a küldőtől a további DM-ek ugyanazon a beszélgetésen futtatják a kötött agentet. Később üresen hagyott tokenmező megtartja a tárolt értéket. Új szálhoz küldj `/new` vagy `/start` parancsot.

## Funkciók

- Párosítás: a DM-ekhez **jóváhagyott párosítás** kell. A kártyán **Párosítás** badge.
- Több bot = több példány (lásd [Csatornák](/docs/hu/communication/channels/)).
- Token titkosítva (system scope, kulcs `telegram-bot-token`).
- **Önálló / Felügyelt** ugyanaz a kapcsoló, mint a többi csatornán.

<h3 id="threads">Szálak</h3>

Párosítás után az **első üzenet** létrehoz egy beszélgetést. A további üzenetek ugyanazt a mappinget folytatják. `/new`, `/start` és `/new@bot` elengedi a mappinget — a bot azt írja: *Started a new conversation. Send a message to begin.* Maga a slash command **nem** megy a modellnek.

<h3 id="approval-ping">Jóváhagyás Telegramon</h3>

Sárga vagy piros toolnál az EYAS **Approve** / **Deny** gombos pinget küld a beszélgetés Telegram-chatjére (vagy jóváhagyott párosításra, ha nincs mapping). A gombok ugyanazt az [Autonómia](/docs/hu/agents/autonomy/) `decide()` utat használják, mint a webes sor. A ping a tool nevét és egy rövid indokot tartalmaz — **soha** nyers tool-argumentumot.

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
- [Autonómia](/docs/hu/agents/autonomy/)
