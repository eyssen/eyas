---
title: Projekte
description: Gespräche in Typen, Projekte und gemeinsame Stages gruppieren — mit Default-Agent und Codequellen.
---

**Wozu das da ist.** Projekte gruppieren Gespräche. Ein **Projekttyp** ist die Vorlage; ein **Projekt** die Instanz (Default-Agent, Prompt, Codequellen); **Stages** sind die gemeinsamen Kanban-Spalten. Board-Karten und Chat-Felder **Project** / **Stage** sind genau diese Struktur.

## Wann du es brauchst

- Ein neuer Arbeitsbereich mit eigenem Default-Agent und (bei Odoo) Default-Codebäumen.
- Ein wiederverwendbarer Typ (Priorität, Icon, Prompt), damit neue Projekte gleich starten.
- Eine Stage hinzufügen, falten oder schließen, die jedes Board zeigt.
- Neue Gespräche in diesem Projekt sollen indexierte Quellen automatisch erben.
- Eine Stage soll beim Eintritt automatisch einen Agenten zuweisen.

## Typischer Ablauf

1. Öffne **Einstellungen → Projekte** (Sidebar **Einstellungen**, Gruppe **Module**) — Route `/projects`.
2. Lege bei Bedarf einen **Project Type** an, dann **New Project** (Name, Typ, Default-Agent, optional **Default code sources**).
3. Unter **Stages** Spalten hinzufügen oder sortieren (**Closed**, **Folded**, **Bot**, **Auto-assign**).
4. Öffne **Board**, wähle das Projekt — du solltest diese Stages als Spalten sehen, und ein neues Gespräch dieselben Codequellen pinnen.

## Funktionen

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
