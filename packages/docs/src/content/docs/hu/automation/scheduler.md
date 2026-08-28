---
title: Ütemező
description: Jobok, triggerek, nézetek, health — minden mező.
---

**Útvonal:** `/scheduler`.

## Nézetek

List · Gantt · Calendar; zoom Day/Week/Month.

## Új job

| Mező | Jelentés |
|------|----------|
| **Job name** | Név |
| **Handler** | Rendszer handler (pl. `backup.run`) |
| **Trigger** | Cron / Interval / Event |
| **cron / interval ms / event name** | Ütemezés paraméter |
| **Agent ID + Prompt** | Agent routine-hoz |

Érvénytelen cron kifejezés vagy egy másodpercnél rövidebb intervallum a **Létrehozás** gombra kattintva elutasításra kerül, az ok az űrlapon jelenik meg: *„Ez az ütemezés érvénytelen, így a feladat soha nem futna le. Ellenőrizd a cron kifejezést vagy az intervallumot.”* Korábban egy ilyen job létrejött, de csendben soha nem futott le. Az **Event** trigger továbbra is elfogadott, de az így létrehozott job magától nem tud elindulni — **Soha nem indul** jelzést kap.

## Műveletek

Run Now, Pause/Resume, Reschedule, Delete, Show infrastructure jobs. A **Run Now** csak akkor letiltott, ha a jobnak nincs regisztrált handlere, vagy letiltva/dead-letter állapotban van — az ok a tooltipben látható; a **Soha nem indul** vagy **Nincs ütemezve** jelzésű job kézzel így is elindítható, Event trigger esetén ez az egyetlen módja annak, hogy egyáltalán lefusson. A **Reschedule** → **Apply** elutasítja az érvénytelen cron kifejezést vagy az egy másodpercnél rövidebb intervallumot, az ok a mező alatt jelenik meg. Jelzés a job sorában (**Nincs handler** / **Soha nem indul** / **Nincs ütemezve**) mutatja, ha egy job nem tud lefutni: nincs regisztrált handler (a modulja valószínűleg ki van kapcsolva), magától el nem induló trigger típus (Event), vagy sikertelen beütemezés (érvénytelen cron vagy egy másodpercnél rövidebb intervallum) — az okért vidd fölé az egeret. A **Show infrastructure jobs** kapcsoló soha nem rejt el futásképtelen jobot — egy hibás rendszer-job akkor is látszik, ha a szűrő ki van kapcsolva.

## Health

Leader/Follower, active, running, failed 24h, dead-letter, overdue, **N nem tud futni** (futásképtelen jobok).

A job részleteinél a **Korábbi futások** lista minden futásnál mutatja az indulás idejét, a hosszát és azt is, hogy ki indította (`system`, ha időzítő indította, egy agent, vagy egy felhasználói azonosító).

Fajták: **System handler** vs **Agent routine**.
