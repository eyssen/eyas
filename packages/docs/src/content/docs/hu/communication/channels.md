---
title: Csatornák áttekintés
description: Külső üzenetküldő példányok — típusok, módok, bejövő sor, párosítás. Nem Kapcsolatok, nem Kezek.
---

**Mire való.** A csatorna az, ahogy a gépen kívüli emberek üzennek egy EYAS agentnek: Telegram, Slack, e-mail és a katalógus többi. Minden példánynak saját titka és kötött agentje van. **Nem** [Kapcsolatok](/docs/hu/admin/connections/) (Odoo, GitHub, MCP leltár) és **nem** [Kezek](/docs/hu/admin/hands/) (helyi eszköz OS/CLI toolokkal). Az MCP és az A2A más alakú integráció, saját oldalon él.

**Útvonal:** `/communication` → fülek **Csatornák · Bejövő sor · Párosítás**. Alcím: *Kapcsold be az üzenetcsatornákat, és rendeld az elsődleges agenthez.*

## Mikor használd

- Az elsődleges agenttel Telegramról (vagy más katalógustípusról) akarsz beszélni, UI nélkül.
- Két ugyanolyan típusú bot (munka + személyes) — második példány.
- A bejövő üzenetek elakadtak, és a tartós sort kell használnod (egy **holt** sor újrapróbálása).
- Telegram DM párosító kódra vár.

## Tipikus folyamat

1. **Kommunikáció** (`/communication`) → **Csatornák**.
2. Nyiss ki egy katalóguskártyát, vagy **Új példány** ugyanabból a típusból.
3. Titkok, **Agent a bejövő üzenetekhez**, **Mentés és csatlakozás**.
4. **Önálló** (felügyelet nélkül, autonómia-létra) vagy **Felügyelt** (biztonsági kapu minden toolhíváson).
5. Telegram DM: írj a botnak, majd **Párosítás**. **Bejövő sor**, ha a kézbesítés elhasal.

## Funkciók

Ugyanabból a típusból **több fiók** (pl. két Telegram bot), mindegyik saját credentialdel és agenttel. **Új példány** vagy kártyán **Új … példány**.

### Csatornatípusok (katalógus) {#channel-types}

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

Minden kártya **Hogyan állítsd be** részt nyit számozott lépésekkel a hitelesítési űrlap előtt. A webhook-típusoknál a **Publikálandó webhook útvonalak** is látszik.

## Mezők és vezérlők

### Példány létrehozása {#create-instance}

| Mező | Jelentés |
|------|----------|
| **Csatorna típusa** | Katalógus-sablon |
| **Megjelenő név** | pl. Munka Signal, Személyes Telegram |
| **Létrehozás és csatlakozás** | Példány + connect |
| **Példány törlése** | Példány + credential (megerősítés) |

### Státusz {#status}

| Státusz | Jelentés |
|---------|----------|
| **Kapcsolódva** | Élő kapcsolat |
| **Szétkapcsolva** | Nincs kapcsolat |
| **Hitelesítés megadva** | Titok tárolva, Connect kellhet |
| **Nincs beállítva** | Hiányzó titok |
| **Hiba** | Utolsó hiba |
| Health **Ütközés / Hitelesítési hiba / Csökkentett** | Üzem |

### Mód {#mode}

| Mód | Jelentés |
|-----|----------|
| **Önálló** | Felügyelet nélkül; a fokozatos autonómia-létra kapuz |
| **Felügyelt** | A biztonsági kapu minden toolhívást felügyel |

Kattintásra vált.

### Memória a csatornaválaszokban {#memory-in-replies}

A tulajdonos **belső** hangján adott válasz ugyanazt a felidézett memóriablokkot kapja az aktuális dátummal és idővel, mint egy chatkör (lásd [Memória — Hogyan jut el a felidézés a modellhez](/docs/hu/knowledge/memory/#how-recall-reaches-the-model)). Az a válasz, amelynek hanghatóköre **Külső** — a beszélgetésen beállított **Kényszerítés: Külső** vagy egy ideiglenes felülírás miatt —, csak a dátumot és az időt kapja: kívülálló olvasóhoz nem kerül felidézett tulajdonosi memória. Ha az EYAS nem tudja megállapítani egy válasz hanghatókörét, az is felidézett memória nélkül megy ki. A memóriatoolok változatlanok, és továbbra is a biztonsági kapu felügyeli őket.

A kötött agent **Tools** listája a csatornaválaszokra is ugyanúgy vonatkozik, mint minden más útra, kiegészítve a `memory_search` és a `memory_expand` toollal ([Agentek — Toolok](/docs/hu/agents/configure/#tools--constraints)). Amit a csatorna küldői írnak, azt az EYAS *peer* szövegként jegyzi meg, nem a tiédként.

**Memóriarögzítés csatornaválaszokon.** Minden csatornaválasz mostantól az EYAS tartós memóriarögzítését (capture) is lefuttatja, ugyanazokkal a `memory.capture.*` beállításokkal, mint egy chatkör. A küldő üzenetét az EYAS harmadik fél szavaiként olvassa: soha nem hozhat létre jegyzetet arról, hogy ki vagy, sem szabályt arról, hogyan dolgozzon az EYAS; csak `reference`, `project` vagy `domain` jegyzet születhet belőle, amely `trust: peer` jelölést kap és peer bizalmi szinten tárolódik, és egy ilyen jegyzet soha nem egészíti ki a saját jegyzeteid egyikét. A hosszküszöb csak a küldő szavait számolja, így egy rövid „ok” nem vált ki modellhívást, és egy csatornás beszélgetés minden üzenete egyetlen közös `maxPerConversation` plafonon osztozik. Lásd [Memória — A capture alapból be van kapcsolva](/docs/hu/knowledge/memory/#capture-is-on-by-default).

**Modell és effort.** A csatornabeszélgetés a kötött agent modelljét követi; ha az agentnek nincs modellje, az első válasszal a telepítés alapértelmezése rögzül a beszélgetésen. Az agent saját reasoning effortja is érvényes. Minden csatornaválasz rögzíti a válaszoló providert és modellt, valamint azt az effortot, amellyel futott.

### Elutasított üzenetek (adatvédelem) {#refused-messages}

Egy csatorna mindig távoli célnak számít. Az a bejövő üzenet, amely olyan értéket tartalmaz, amelyet az adatvédelmi policy **block**-ra állít — alapból IBAN, bankszámlaszám, adószám, személyi igazolvány szám, kártyaszám vagy amerikai SSN, valamint bármely block-ra állított egyéni minta —, még azelőtt elutasításra kerül, hogy bármi tárolódna:

- A küldő automatikus választ kap azon a nyelven, amelyen írt (angol, magyar, német, spanyol, francia vagy klingon; ha nem egyértelmű, angolul). A válasz megnevezi a típusokat, az értékeket soha, és arra kéri a küldőt, hogy ezek nélkül küldje újra.
- Nem jön létre beszélgetés, üzenet vagy agent-futás. A **Bejövő sor**ban az esemény **kihagyva** állapotot kap `privacy_blocked` hibával, és csak a maszkolt szövege marad meg. Ha az értesítés küldése elbukik, az eseményt az EYAS úgy próbálja újra, mint bármely kézbesítést.
- A policy változása előtt már tárolt üzeneteket az EYAS utólag nem utasítja el. Az e-mail-címeket és telefonszámokat (mask osztály) és a warn osztályú értékeket soha nem utasítja el.

Minden elutasítás `privacy.inbound_refused` auditbejegyzést kap (típusok és a bejövő esemény azonosítója, érték soha). Lásd [Biztonság és adatvédelem — Elutasított üzenetek](/docs/hu/admin/security-privacy/#refused-messages).

### Hitelesítés és agent-kötés {#credentials}

| Mező | Jelentés |
|------|----------|
| Titokmezők | Csatornaspecifikus |
| *Hagyd üresen a jelenlegi érték megtartásához* | Szerkesztéskor |
| **beállítva** | Titok már tárolva |
| **Agent a bejövő üzenetekhez** | Ki válaszol; alap az elsődleges |
| **— nincs (üzenet mentve, nincs automatikus válasz) —** | Csak tárolás |
| **Kötött agent** | Jelenlegi |
| **Mentés és csatlakozás** | Persist + connect |
| **Teszt / Kapcsolódás / Szétkapcsolás / Újracsatlakozás / Beállítás** | Életciklus |

### Bejövő sor {#inbound}

A bejövő csatornaüzenetek tartós, legalább egyszeri kézbesítésű sora. A sikertelen kézbesítéseket az EYAS késleltetve újrapróbálja, végül holtnak jelöli; a **holt** sorok újra sorba tehetők.

| Oszlop | Jelentés |
|--------|----------|
| **Forrás** | Csatorna-példány |
| **Küldő** | Id / név |
| **Üzenet** | Törzs |
| **Próbálkozások** | Kézbesítési kísérletek |
| **Beérkezett** | Kor (*N mp / perce / órája*) |

Az **Állapot** oszlop értéke **függőben**, **kézbesítve**, **holt** vagy **kihagyva**; egy sikertelen vagy kihagyott sor oka az üzenet alatt látszik (például `privacy_blocked`, lásd [fent](#refused-messages)). Egy **holt** sort az **Újra** gomb visszatesz a sorba; a **Frissítés** újratölti a listát.

### Párosítás {#pairing}

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
