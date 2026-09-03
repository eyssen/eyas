---
title: Értesítések
description: Ki, melyik csatornán, milyen hangerőn kapja — in-app, e-mail, Telegram, webhook.
---

**Mire való.** Az Értesítési beállításokban döntöd el, mely események jutnak el hozzád, melyik csatornán, milyen hangerőn. Minden beállítás egy esemény-minta × csatorna sor. Így a költségfigyelmeztetések, ágensesemények és hasonlók a harangba, e-mailbe, Telegramra vagy webhookra kerülnek — zaj nélkül. A **Kritikus** súlyosság mindig felülírja a csendes órákat és a kötegelést.

## Mikor használd

- Egyes eseményeket az in-app harangba, másokat **Telegram**ra vagy **E-mail**re akarsz.
- Csak **Figyelmeztetés** és afelett kell, nem minden **Info**.
- Csendes ablakot akarsz (éjszakán át is), kivéve a **Kritikus**at.
- Kivonatot akarsz e-mail- vagy webhook-zápor helyett.
- Aláírt HTTPS webhook kell automatizáláshoz (n8n, Zapier, Home Assistant és hasonlók).

## Tipikus munkafolyamat

1. Nyisd az oldalsáv **Beállítások** csoport **Modulok** → **Értesítések** (`/notifications-settings`).
2. **Beállítás hozzáadása** alatt írj **Esemény-minta**t (például `agent.*`, `budget.warning` vagy `*`).
3. Válaszd a **Csatorna**t, a **Minimális súlyosság**t és a **Kézbesítési mód**t.
4. Opcionálisan **Csendes ettől** / **Csendes eddig**. Az éjszakai tartományok (22:00–07:00) működnek.
5. **Hozzáadás**. A sor megjelenik az **Aktív beállítások** alatt.
6. Ha a csatorna **Webhook**, töltsd ki a **Webhook végpont**ot, majd **Webhook mentése**.

Az új sorban ott kell lennie a mintának, a csatornának, a ≥ súlyosságnak, és opcionálisan a **kivonat** / csendes jelvényeknek.

## Funkciók

Egy sor esemény-mintánként × csatornánként. A minták szegmens-globok: a `*` mindent illeszt; az `agent.*` egy szegmenst az `agent` után; a `budget.warning` csak azt az eseményt.

**Csatorna:** **Web** (in-app / WebSocket), **E-mail**, **Telegram**, **Webhook**. E-mail és Telegram csak akkor kézbesít, ha az integráció tényleg be van állítva (SMTP a Titkokból / párosított Telegram-bot). A csatorna itt választása nem hozza létre az integrációt.

**Azonnali** most küld. **Kötegelt** kivonatot sorba állít (e-mail és webhook; alapból öt perc). A **Web** és a **Telegram** kihagyja a kötegelést. A **Kritikus** mindig azonnal megy, és figyelmen kívül hagyja a csendes órákat.

A csendes órák `HH:MM` formátumúak, és átnyúlhatnak éjfélen.

A webhook POST JSON (`event`, `severity`, `title`, `body`, `data`, `createdAt`, `notificationId`). Opcionális megosztott titok: `X-EYAS-Signature: sha256=…` (HMAC-SHA256). Extra HTTP fejlécek a végponton tárolhatók (API); az űrlapon URL, titok és **Engedélyezve** van. Az oldal szerint: csak https URL-ek; loopback és metaadat hostok (`169.254.169.254`, `.internal`) tiltva.

A sikertelen küldés újrapróbálkozási sorba kerül (három kísérlet, exponenciális backoff 30 másodperctől). Utána **Sikertelen (holt levél)**. Az **Újrapróbálkozási sor** akkor látszik, ha az újrapróbálkozás engedélyezett.

A fejléc harangja listázza az értesítéseket és az olvasottnak jelölést. Ez az oldal csak a beállítások.

## Mezők és vezérlők

<h2 id="preferences">Aktív beállítások</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Aktív beállítások** | Meglévő sorok. Üres: *Még nincs beállítás. Adj hozzá egyet alább.* |
| Esemény-minta jelvény | Illesztett glob, pl. `agent.*` |
| Csatorna jelvény | **Web** / **E-mail** / **Telegram** / **Webhook** |
| ≥ súlyosság | A sor minimális súlyossága |
| **kivonat** | Ha a **Kézbesítési mód** **Kötegelt** |
| csendes `ettől`–`eddig` | Csendes órák ezen a soron |
| Kuka | A minta × csatorna sor törlése |

<h2 id="add-preference">Beállítás hozzáadása</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Esemény-minta** | Helyőrző: `agent.* vagy budget.warning vagy *` |
| **Csatorna** | **Web**, **E-mail**, **Telegram**, **Webhook** |
| **Minimális súlyosság** | **Info**, **Figyelmeztetés**, **Hiba**, **Kritikus** |
| **Kézbesítési mód** | **Azonnali** vagy **Kötegelt** |
| **Csendes ettől** / **Csendes eddig** | Időmezők. Mindkettő kell a csendes órák mentéséhez; üresen nincs csend |
| **Hozzáadás** | Sor mentése (üres mintánál tiltva) |

<h2 id="webhook">Webhook végpont</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **URL** | Cél. Helyőrző `https://hooks.example.com/eyas` |
| **Megosztott titok (opcionális — HMAC-SHA256 aláírásokat tesz lehetővé)** | Jelszómező. Ha már van titok: *(változatlan — hagyd üresen a meglévő megtartásához)* |
| **Engedélyezve** | Ki pipálva a webhook tárolva van, de nem használják |
| **Webhook mentése** | URL / titok / engedélyezve mentése (üres URL-nél tiltva) |
| **Eltávolítás** | Tárolt webhook törlése (csak ha van) |

<h2 id="retry-queue">Újrapróbálkozási sor</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Függőben** | Még ütemezett újrapróbálkozások |
| **Sikertelen (holt levél)** | Kifogyott kísérletek |
| **Frissítés** | Beállítások, webhook és retry statisztika újratöltése |

## Kapcsolódó

- [Beállítások áttekintés](/docs/hu/admin/settings/)
- [Bővítmények](/docs/hu/admin/extensions/)
- [Távoli csomópontok](/docs/hu/admin/nodes/)
- [Kezek](/docs/hu/admin/hands/)
- [Csatornák](/docs/hu/communication/channels/)
- [Telegram](/docs/hu/communication/telegram/)
- [Titkok](/docs/hu/admin/secrets/)
