---
title: Folyamatok
description: Ticket-to-code futások — ingest, tisztázás, tervezés, implementáció, review, PR, deploy.
---

**Mire való.** A pipeline többlépcsős, vezérelt job. A termékfelület ma a **ticket-to-code**: Tábla-ticket (vagy manuális id) → ingest → PM tisztázás → architektúra → implementáció → review → PR → deploy, emberi kapuval, ha egy szakasz vár. Nem általános workflow-szerkesztő — indítasz egy futást, nézed a szakaszokat, jóváhagyod vagy törlöd.

**Útvonal:** `/pipelines`. Alcím: *Ticket-to-code pipeline futások — ingest, tisztázás, tervezés, implementáció, review, PR, deploy.* Menü: **Folyamatok**.

## Mikor használd

- A Tábla-ticket kódváltozás lesz, és szakaszolt futást akarsz, nem egyetlen chatet.
- Review vagy deploy kapu kell a következő szakasz előtt.
- A futás elhasalt vagy törölted, és **Folytatás** kell.
- Ticket → szakasz → befejezés történet kell beszélgetés nélkül.

## Tipikus folyamat

1. Nyisd a **Folyamatok**at (`/pipelines`).
2. **Futás indítása:** forrás **tábla** vagy **manuális**, **Ticket id**, **Indítás**.
3. Megnyílik a futás (`/pipelines/<runId>`). A szakaszok sorban gyulladnak.
4. **Jóváhagyásra vár:** **Jóváhagyás**. **Mégse** élő futást állít; **Folytatás** failed/cancelled után.
5. **Frissítés** tölti újra (nincs polling). Kész, ha a badge **Befejezve**.

## Funkciók

Ticket-forrás: belső EYAS **tábla** és **manuális** — nincs harmadik beépített ticket-rendszer.

| Fogalom | Jelentés |
|---------|----------|
| Pipeline definíció | Nevesített sablon (ticket-to-code) |
| Futás | Egy végrehajtás |
| Ticket forrás | `board` vagy `manual` |
| Szakasz | A rögzített lánc egy lépése |
| Kapu / jóváhagyás | Emberi checkpoint |
| Artifact | Szakasz kimenete |

## Mezők és vezérlők

<h2 id="start-run">Futás indítása</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Forrás **tábla** / **manuális** | Honnan jön a ticket id |
| **Ticket id** | Betöltendő id |
| **Indítás** | Futás létrehozása |
| **Frissítés** | Lista újratöltése |

Oszlopok: **Státusz**, **Ticket**, **Szakasz**, **Indítva**, **Befejezve**, **Megtekintés**. Üres: *Még nincs pipeline-futás.*

<h2 id="run-status">Futás státusz</h2>

| Státusz | Jelentés |
|---------|----------|
| **Fut** | Szakasz folyamatban |
| **Jóváhagyásra vár** | Emberi kapu |
| **Befejezve** | Minden szakasz kész |
| **Sikertelen** | Szakasz elhasalt — **Folytatás** |
| **Törölve** | Megállítva — **Folytatás** |

<h2 id="stages">Szakaszok</h2>

| Szakasz | Jelentés |
|---------|----------|
| **Ingest** | Ticket betöltése |
| **PM Clarify** | Scope tisztázása |
| **Architect Design** | Változás tervezése |
| **Dev Implement** | Kód |
| **Review** | Átnézés |
| **Open PR** | Pull request |
| **Deploy** | Telepítés |

<h2 id="stage-status">Szakasz státusz</h2>

| Státusz | Jelentés |
|---------|----------|
| **Függőben** | Nem indult |
| **Fut** | Folyamatban |
| **Sikerült** | Kész |
| **Sikertelen** | Hiba |
| **Kihagyva** | Nem futott |
| **Jóváhagyásra vár** | **Jóváhagyás** a folytatáshoz |

## Kapcsolódó

- [Agent-futások](/docs/hu/agents/runs/)
- [Projektek](/docs/hu/daily/projects/)
- [Tábla](/docs/hu/daily/board/)
- [Készségek](/docs/hu/automation/skills/)
