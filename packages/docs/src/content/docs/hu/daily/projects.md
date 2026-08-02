---
title: Projektek
description: Projekt típusok, projektek, stage-ek — minden űrlapmező.
---

**Útvonal:** `/projects`.  
Alcím: *Projekt típusok, projektek és stage workflow-k.*

A projektek a **beszélgetéseket stage-ekbe** szervezik, opcionális default ágenssel és prompttal.

## Szekciók

| Szekció | Cél |
|---------|-----|
| **Projects** | Projekt példányok |
| **Project Types** | Sablonok új projektekhez |
| **Stages** | Globális workflow stage-ek |

## Project mezők

| Mező | Kötelező | Jelentés |
|------|----------|----------|
| **Name** | Igen | Megjelenített név |
| **Type** | Igen | Projekt típus |
| **Description** | Nem | Rövid leírás |
| **Color** | Nem | Szín |
| **Default Agent** | Igen | Új beszélgetések ágense |
| **Prompt** | Nem | Extra system prompt a projekt beszélgetéseihez |

## Project Type mezők

Name, Default Priority (Low→Urgent), Icon (+ Clear), Prompt, Color.

## Stage mezők

| Mező | Jelentés |
|------|----------|
| **Name** | Oszlop cím a Boardon |
| **Closed** | Végső (kész) stage |
| **Folded** | Alapból összecsukott oszlop |
| **Bot** | AI figyeli a stage-et |
| **Auto-assign** | Belépő kártyák ágense (+ autonóm futtatás); `None` = ki |

Húzással rendezhető a sorrend.

## Kapcsolódó

- [Tábla](/docs/hu/daily/board/)
- [Beszélgetések](/docs/hu/daily/conversations/)
