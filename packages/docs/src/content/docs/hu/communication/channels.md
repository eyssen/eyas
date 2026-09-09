---
title: Csatornák áttekintés
description: Külső üzenetküldő példányok — típusok, módok, bejövő sor, párosítás. Nem Kapcsolatok, nem Kezek.
---

**Mire való.** A csatorna az, ahogy a gépen kívüli emberek üzennek egy EYAS agentnek: Telegram, Slack, e-mail és a katalógus többi. Minden példánynak saját titka és kötött agentje van. **Nem** [Kapcsolatok](/docs/hu/admin/connections/) (Odoo, GitHub, MCP leltár) és **nem** [Kezek](/docs/hu/admin/hands/) (helyi eszköz OS/CLI toolokkal). Az MCP és az A2A más alakú integráció, saját oldalon él.

**Útvonal:** `/communication` → fülek **Csatornák · Bejövő sor · Párosítás**. Alcím: *Kapcsold be az üzenetcsatornákat, és rendeld az elsődleges agenthez.*

## Mikor használd

- Az elsődleges agenttel Telegramról (vagy más katalógustípusról) akarsz beszélni, UI nélkül.
- Két ugyanolyan típusú bot (munka + személyes) — második példány.
- A bejövő elakadt — tartós sor, **dead** sor újrapróbálása.
- Telegram DM párosító kódra vár.

## Tipikus folyamat

1. **Kommunikáció** (`/communication`) → **Csatornák**.
2. Nyiss ki egy katalóguskártyát, vagy **Új példány** ugyanabból a típusból.
3. Titkok, **Agent a bejövő üzenetekhez**, **Mentés és csatlakozás**.
4. **Önálló** (felügyelet nélkül, autonómia-létra) vagy **Felügyelt** (biztonsági kapu minden toolhíváson).
5. Telegram DM: írj a botnak, majd **Párosítás**. **Bejövő sor**, ha a kézbesítés elhasal.

## Funkciók

Ugyanabból a típusból **több fiók** (pl. két Telegram bot), mindegyik saját credentialdel és agenttel. **Új példány** vagy kártyán **Új … példány**.

### Csatornatípusok (katalógus)

Ezek az üzenetküldő típusok. MCP / A2A **nem** chat-csatorna.

| Típus | Mit kötsz | Párosítás | Extra |
|-------|-----------|-----------|-------|
| **Telegram** | BotFather HTTP API token | Igen — ismeretlen DM | Első osztályú; [Telegram](/docs/hu/communication/telegram/) |
| **Discord** | Application bot token | Nem | `discord.js` runtime |
| **Slack** | Bot token (`xoxb-`) + app-level (`xapp-`) | Nem | Socket Mode — nincs publikus webhook |
| **Email (SMTP/IMAP)** | SMTP (kötelező) + opcionális IMAP | Nem | Bármely mailbox |
| **Gmail (API)** | OAuth client id/secret, refresh token, mailbox | Nem | Gmail API |
| **Microsoft 365 (Graph)** | Tenant, client id/secret, mailbox UPN | Nem | Graph app |
| **WhatsApp Business** | Phone number id, access token, verify token, app secret | Nem | Webhook `/api/v1/webhooks/whatsapp` |
| **Signal** | Bot E.164 + signal-cli HTTP bridge URL | Nem | Az EYAS nem ágyazza be a Signalt |
| **Google Chat** | Project/app id, opcionális send token | Nem | Webhook `/api/v1/channels/googlechat/webhook` |
| **Microsoft Teams** | App id, jelszó, opcionális tenant | Nem | Webhook `/api/v1/channels/teams/webhook` |

Minden kártya **Hogyan állítsd be** számozott lépésekkel. Webhook-típusok: **Közzéteendő webhook-útvonalak**.

## Mezők és vezérlők

<h2 id="create-instance">Példány létrehozása</h2>

| Mező | Jelentés |
|------|----------|
| **Csatorna típusa** | Katalógus-sablon |
| **Megjelenő név** | pl. Munka Signal, Személyes Telegram |
| **Létrehozás és csatlakozás** | Példány + connect |
| **Példány törlése** | Példány + credential (megerősítés) |

<h2 id="status">Státusz</h2>

| Státusz | Jelentés |
|---------|----------|
| **Kapcsolódva** | Élő kapcsolat |
| **Szétkapcsolva** | Nincs kapcsolat |
| **Hitelesítés megadva** | Titok tárolva, Connect kellhet |
| **Nincs beállítva** | Hiányzó titok |
| **Hiba** | Utolsó hiba |
| Health **Ütközés / Hitelesítési hiba / Csökkentett** | Üzem |

<h2 id="mode">Mód</h2>

| Mód | Jelentés |
|-----|----------|
| **Önálló** | Felügyelet nélkül; a fokozatos autonómia-létra kapuz |
| **Felügyelt** | A biztonsági kapu minden toolhívást felügyel |

Kattintásra vált.

<h2 id="credentials">Hitelesítés és agent-kötés</h2>

| Mező | Jelentés |
|------|----------|
| Titokmezők | Csatornaspecifikus |
| *Hagyd üresen a jelenlegi érték megtartásához* | Szerkesztéskor |
| **beállítva** | Titok már tárolva |
| **Agent a bejövő üzenetekhez** | Ki válaszol; alap az elsődleges |
| **— nincs (üzenet tárolva, nincs auto-válasz) —** | Csak tárolás |
| **Kötött agent** | Jelenlegi |
| **Mentés és csatlakozás** | Persist + connect |
| **Teszt / Kapcsolódás / Szétkapcsolás / Újracsatlakozás / Beállítás** | Életciklus |

<h2 id="inbound">Bejövő sor</h2>

Tartós, legalább egyszeri kézbesítésű sor. A failed back-off és dead-letter; **dead** sor újrasorolható.

| Oszlop | Jelentés |
|--------|----------|
| **Forrás** | Csatorna-példány |
| **Küldő** | Id / név |
| **Üzenet** | Törzs |
| **Próbálkozások** | Kézbesítési kísérletek |
| **Érkezett** | Kor (*N mp / perce / órája*) |

Státusz: **pending**, **delivered**, **dead**, **skipped**. Dead sor retry a sor műveletből.

<h2 id="pairing">Párosítás</h2>

Ismeretlen küldő kódot kap, itt vár. A jóváhagyás a kötött agenthez ad hozzáférést; a párosítás túléli az újraindítást. Telegram a **supportsPairing** típus.

| Vezérlő | Jelentés |
|---------|----------|
| **Párosítás** badge | A kártyán, ha kell |
| **Jóváhagyás / Elutasítás** | Pending kérelem |
| Oszlopok | Forrás, Küldő, Kód, Kérve |

Üres: *Nincs függő párosítási kérelem.*

## Kapcsolódó

- [Telegram](/docs/hu/communication/telegram/)
- [A2A](/docs/hu/communication/a2a/)
- [Agentek — csatornák](/docs/hu/agents/configure/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [Kezek](/docs/hu/admin/hands/)
- [Ingress](/docs/hu/admin/ingress/)
