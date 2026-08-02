---
title: Projekte
description: Projekttypen, Projekte, Stages — Formularfelder.
---

**Route:** `/projects`. Abschnitte: **Projects · Project Types · Stages**.

## Project

| Feld | Pflicht | Bedeutung |
|------|---------|-----------|
| **Name** | Ja | Anzeigename |
| **Type** | Ja | Projekttyp |
| **Description** | Nein | Kurzbeschreibung |
| **Color** | Nein | Farbe |
| **Default Agent** | Ja | Agent für neue Gespräche |
| **Prompt** | Nein | Extra-Systemprompt |

## Project Type

Name · Default Priority (Low–Urgent) · Icon (+ Clear) · Prompt · Color.

## Stages (global, drag reorder)

| Feld | Bedeutung |
|------|-----------|
| **Name** | Spaltentitel am Board |
| **Closed** | Endstufe (fertig) |
| **Folded** | Standardmäßig eingeklappt |
| **Bot** | AI überwacht die Stage |
| **Auto-assign** | Agent bei Eintritt (+ autonom); `None` = aus |

## Verwandt

[Board](/docs/de/daily/board/) · [Gespräche](/docs/de/daily/conversations/)
