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
| **Prompt coach** | — | KI-Coach für den Projekt-Brief — [Prompt-System](/docs/de/ai/prompts/) |
| **Standard-Codequellen** | Nein | Multi-Select der [Search Sources](/docs/de/daily/search/). Wird bei **neuen Gesprächen** und beim Setzen des **Projekt**-Felds als Conversation-Pin übernommen |
| Badge **N Quellen** | — | Anzahl der Default-Quellen |

Setup: Sources registrieren → Reindex → im Projekt anhaken → im Gespräch unter **Quellen** prüfen/anpassen.

## Project Type

Name · Default Priority (Low–Urgent) · Icon (+ Clear) · Prompt · **Prompt coach** · Color.

## Stages (global, drag reorder)

| Feld | Bedeutung |
|------|-----------|
| **Name** | Spaltentitel am Board |
| **Closed** | Endstufe (fertig) |
| **Folded** | Standardmäßig eingeklappt |
| **Bot** | AI überwacht die Stage |
| **Auto-assign** | Agent bei Eintritt (+ autonom); `None` = aus |

## Verwandt

[Board](/docs/de/daily/board/) · [Gespräche](/docs/de/daily/conversations/) · [Suche](/docs/de/daily/search/)
