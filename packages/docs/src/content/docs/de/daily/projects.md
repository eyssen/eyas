---
title: Projekte
description: Gespräche in Typen, Projekte und gemeinsame Stages gruppieren — mit Default-Agent und Codequellen.
---

**Wozu das da ist.** Projekte gruppieren Gespräche. Ein **Projekttyp** ist die Vorlage; ein **Projekt** die Instanz (Default-Agent, Prompt, Codequellen); **Stages** sind die gemeinsamen Kanban-Spalten. Board-Karten und Chat-Felder **Project** / **Stage** sind genau diese Struktur.

## Wann du es brauchst

- Ein neuer Arbeitsbereich mit eigenem Default-Agent, Arbeitsordnern und optionalen Codebäumen.
- Ein wiederverwendbarer Typ (Priorität, Icon, Prompt, Arbeitsverzeichnisse), damit neue Projekte gleich starten.
- Neue Gespräche in diesem Projekt sollen indexierte Quellen und Ordner automatisch erben.
- Geschlossene Tickets oder Team-Entscheidungen sollen auf das Projekt-Wiki (opt-in).
- Eine Stage soll beim Eintritt automatisch einen Agenten zuweisen.

## Typischer Ablauf

1. Öffne **Einstellungen → Projekte** (Sidebar **Einstellungen**, Gruppe **Module**) — Route `/projects`.
2. Lege bei Bedarf einen **Project Type** an (Prompt, optionale **Arbeitsverzeichnisse**), dann **New Project** (Name, Typ, Default-Agent, **Arbeitsverzeichnisse**, optional Codequellen, optional **Wiki auto-update**).
3. Unter **Stages** Spalten hinzufügen oder sortieren (**Closed**, **Folded**, **Bot**, **Auto-assign**).
4. Öffne **Board**, wähle das Projekt — Stages als Spalten, neues Gespräch erbt Codequellen und Arbeitsordner. **Wiki** auf der Projektkarte öffnet `/projects/:projectId/wiki`.

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
| **Prompt** | Nein | Extra-Systemprompt. Leer erbt den Typ. `+` erweitert. Alles andere ersetzt. Das Formular ist, was das Modell sieht; Speichern schreibt `AGENTS.md`. |
| **Prompt coach** | — | KI-Coach für den Projekt-Brief — [Prompt-System](/docs/de/ai/prompts/) |
| **Arbeitsverzeichnisse** | Ja (für Datei-Tools) | Name + absoluter Pfad. Erster Pfad = **Primär**. Neue Gespräche erben die Liste. Leere Liste kopiert den **Typ**. Ohne Pfad lehnen Datei-Tools ab. |
| **Standard-Codequellen** | Nein | Multi-Select der [Search Sources](/docs/de/daily/search/). Wird bei **neuen Gesprächen** und beim Setzen des **Projekt**-Felds als Conversation-Pin übernommen |
| **Wiki auto-update** | Nein | Default aus. **Geschlossene Tickets** / **Team-Entscheidungen** getrennt. Ticket-Körper: nur Titel / letzte Runde / ganzes Gespräch. **General** bekommt keine Seiten. |
| **Wiki** | — | Projekt-Wiki |
| Badge **N Quellen** | — | Anzahl der Default-Quellen |

Setup: Sources registrieren → Reindex → im Projekt anhaken → im Gespräch unter **Quellen** prüfen/anpassen.

## Project Type

Name · Default Priority (Low–Urgent) · Icon (+ Clear) · Prompt · **Prompt coach** · **Arbeitsverzeichnisse** (Defaults für neue Projekte dieses Typs) · Color.

## Stages (global, drag reorder)

| Feld | Bedeutung |
|------|-----------|
| **Name** | Spaltentitel am Board |
| **Closed** | Endstufe (fertig) |
| **Folded** | Standardmäßig eingeklappt |
| **Bot** | AI überwacht die Stage |
| **Auto-assign** | Agent bei Eintritt (+ autonom); `None` = aus |

## Verwandt

[Board](/docs/de/daily/board/) · [Gespräche](/docs/de/daily/conversations/) · [Suche](/docs/de/daily/search/) · [Projekt-Wiki](/docs/de/knowledge/client-wiki/) · [Prompt-System](/docs/de/ai/prompts/)
