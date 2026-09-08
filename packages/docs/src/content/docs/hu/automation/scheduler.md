---
title: Ütemező
description: Ismétlődő jobok, agent-rutinok, naptár és Gantt, és a nem futtatható jobok.
---

**Mire való.** Az ütemező az óra: rendszer-handlerek (mentés, karbantartás) és agent-rutinok (prompt cronon). Létrehozol jobokat, látod a last/nextet, és elkapod, ami soha nem fog tüzelni. Nem a Tábla — a Tábla munkaelemeket követ; ez időzítőket.

**Útvonal:** `/scheduler`. Alcím: *Ismétlődő jobok, agent-rutinok és futtatási előzmény.* Menü: **Ütemező**.

## Mikor használd

- Agent promptot akarsz minden reggel beszélgetés nélkül.
- Mentés cronon, last/next kell.
- Egy job ül, és a **No handler / Never fires / Not scheduled** badge kell, nem csendes kihagyás.
- Cluster leadership, overdue, dead-letter több példányon.

## Tipikus folyamat

1. Nyisd az **Ütemező**t (`/scheduler`).
2. **Lista / Gantt / Naptár**. Zoom **Nap / Hét / Hónap**.
3. **Új feladat** — név, típus (**Rendszer handler** vagy **Agent rutin**), trigger (**Cron / Intervallum / Esemény**), **Létrehozás**.
4. Health sáv. **cannot-run** badge: a job a beállítás szerint nem fut; hover az okra.
5. **Futtatás most** azonnal (Event job egyetlen módja). **Szünet / Folytatás**, **Átütemezés**.

## Funkciók

Három nézet, ugyanazok a jobok. **Infrastruktúra-feladatok mutatása** beleszámítja a belső infra jobokat, de soha nem rejti el a nem futtathatót.

Érvénytelen cron vagy 1 mp alatti interval **Létrehozás**-nál elutasítva: *Ez az ütemezés érvénytelen, így a feladat soha nem futna le. Ellenőrizd a cron kifejezést vagy az intervallumot.* **Esemény** elfogadott, de magától nem tüzel — **Soha nem indul** badge.

## Mezők és vezérlők

<h2 id="views">Nézetek</h2>

| Nézet | Jelentés |
|-------|----------|
| **Lista** | Job tábla |
| **Gantt** | Idővonal sávok |
| **Naptár** | Naptár elrendezés |
| Zoom **Nap / Hét / Hónap** | Gantt/naptár lépték |

<h2 id="create-job">Feladat létrehozása</h2>

| Mező | Jelentés |
|------|----------|
| **Feladat neve** | Megjelenő név |
| **Handler** | Rendszer handler id (pl. `backup.run`) |
| **Trigger típus** | **Cron** · **Intervallum** · **Esemény** |
| **Ütemezés (cron)** | Cron kifejezés |
| **Intervallum (ms)** | Periódus |
| **Esemény neve** | Busz esemény (pl. `conversation.completed`) |
| **Agent ID** | Agent-rutinokhoz |
| **Prompt** | agent_run szövege |
| **Létrehozás** | Mentés |

<h2 id="job-kinds">Típusok</h2>

| Típus | Jelentés |
|-------|----------|
| **Rendszer handler** | Beépített karbantartás |
| **Agent rutin** | Agent prompttal, ütemezve |

<h2 id="row-actions">Sor műveletek</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Szüneteltetve / Fut** | Engedélyezett állapot |
| **Cannot-run badge** | **Nincs handler**, **Soha nem indul**, **Nincs ütemezve** — nincs handler (modul ki), Event magától nem tüzel, vagy a cron/interval nem élesíthető. Hover az okra. |
| **Utolsó / Következő** | Utolsó és következő futás |
| **N futás / N hiba** | Számlálók |
| **Futtatás most** | Azonnal; csak akkor tiltott, ha nincs handler, vagy disabled/dead-letter. Event job egyetlen módja |
| **Szünet / Folytatás** | Kapcsoló |
| **Átütemezés** + **Alkalmaz** | Érvénytelen cron / 1 mp alatti interval elutasítva |
| **Törlés** | Job + előzmény (megerősítés) |
| **Hozzárendelt agent** | Rutinokhoz |
| Keresés | Lista szűrés |
| **Infrastruktúra feladatok** | Belső infra |
| **Mutasd csak a nem futtatható feladatokat** | Health-sáv szűrő |

## Legutóbbi futtatások

Kezdés, időtartam, ki indította (`system` / agent / user id). Üres: *Még nincs futtatás.*

<h2 id="health">Health sáv</h2>

| Metrika | Jelentés |
|---------|----------|
| **Leader / Follower** | Cluster vezetés |
| **N aktív** | Aktív jobok |
| **N fut** | Most végrehajtás alatt |
| **N hiba (24ó)** | Napi hibák |
| **N dead-letter** | Kifogyott retry |
| **N lejárt** | Kihagyott ütem |
| **N nem futtatható** | Beállítás szerint nem fut |

Jelmagyarázat: múlt · fut · következő · jövő · futások · esedékes

## Kapcsolódó

- [CLI / config](/docs/hu/deploy/configuration/)
- [Agentek](/docs/hu/agents/overview/)
- [Mentés](/docs/hu/admin/backup/)
- [Kezdőlap](/docs/hu/daily/home/)
