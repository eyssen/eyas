---
title: Felhasználók és jogosultságok
description: Emberi felhasználók, agent-identitások, szerepek, archiválás és visszaállítás.
---

**Mire való.** Ez az emberek-és-agentek címtár: bejelentkező emberek, és nem-login **agent** identitások, agent-definícióhoz kötve. A CASL minden védett API-n ellenőriz. Nem itt állítod az agent modelljét vagy tooljait — az a [Konfiguráció](/docs/hu/agents/configure/). Az **Új agent** itt identitást hoz létre és az agent-szerkesztőre ugrik.

**Útvonal:** `/users`. Alcím: *Felhasználók és AI-agentek.* Menü: **Felhasználók**.

## Mikor használd

- Második embernek be kell jelentkeznie (operator / viewer).
- Új agent-identitás az Agentek nélkül.
- Valaki távozott — **Archiválás** (lágy, később vissza). A root owner és az agent userek innen nem archiválhatók.
- **Aktív** vs **Archivált**.

## Tipikus folyamat

1. **Felhasználók** (`/users`).
2. **Aktív / Archivált**.
3. **Új agent** — „New Agent” nevű agent user, majd `/agents/<id>`.
4. Ember: setup vagy provisioning; szerepek CASL-lel.
5. Ember **Archiválása** (megerősítés). Vissza az **Archivált** nézetből.

## Funkciók

| Fogalom | Jelentés |
|---------|----------|
| **Root owner** | Első admin a setupból (`is_root_owner`) — innen nem archiválható |
| Szerep | `owner` / `admin` / egyebek |
| Státusz | **active** / **archived** |
| Agent userek | Nem-login identitások (`is_agent`) — **AI konfiguráció →** |
| Archiválás | Lágy törlés (`DELETE /users/:id`); restore `POST /users/:id/restore` |

## Mezők és vezérlők

| Oszlop | Jelentés |
|--------|----------|
| **Felhasználónév** | Login id |
| **Megjelenített név** | Név |
| **Szerep** | Jogosultság |
| **Típus** | **Ember** vagy **Agent** |
| **Létrehozva** | Dátum |
| **AI konfiguráció →** | Csak agent — agent megnyitása |
| Archiválás / visszaállítás | Emberek, kivéve root owner |

Üres: *Nincs felhasználó* / *Nincs archivált felhasználó*.

## Kapcsolódó

- [Setup — root owner](/docs/hu/setup-wizard/)
- [API-kulcsok](/docs/hu/admin/secrets/)
- [Agentek](/docs/hu/agents/overview/)
- [Biztonság és adatvédelem](/docs/hu/admin/security-privacy/)
