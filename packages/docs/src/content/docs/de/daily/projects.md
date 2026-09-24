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
2. Lege bei Bedarf einen **Project Type** an (Prompt, optionale **Arbeitsverzeichnisse**), dann **New Project** (Name, Typ, Default-Agent, optionale **Arbeitsverzeichnisse**, optional Codequellen, optional **Wiki auto-update**).
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
| **Arbeitsverzeichnisse** | Nein | Name + absoluter Pfad. Erster Pfad = **Primär**. Neue Gespräche erben die Liste. Leere Liste kopiert den **Typ**. Ist nichts gesetzt, arbeitet jedes Gespräch in seinem eigenen EYAS-Workspace ([Ordner](/docs/de/daily/conversations/#working-folders)). |
| **Standard-Codequellen** | Nein | Multi-Select der [Search Sources](/docs/de/daily/search/). Wird bei **neuen Gesprächen** und beim Setzen des **Projekt**-Felds als Conversation-Pin übernommen |
| **Wiki auto-update** | Nein | Default aus. **Geschlossene Tickets** / **Team-Entscheidungen** getrennt. Ticket-Körper: nur Titel / letzte Runde / ganzes Gespräch. **General** bekommt keine Seiten. |
| **Wiki** | — | Projekt-Wiki |
| Badge **N Quellen** | — | Anzahl der Default-Quellen |

Setup: Sources registrieren → Reindex → im Projekt anhaken → im Gespräch unter **Quellen** prüfen/anpassen.

## Project Type

Name · Default Priority (Low–Urgent) · Icon (+ Clear) · Prompt · **Prompt coach** · **Arbeitsverzeichnisse** (Defaults für neue Projekte dieses Typs) · Color.

**Welche Ordner gespeichert werden können.** Projekt, Projekttyp und Gesprächs-Ordner teilen sich eine Prüfung. Speichern lehnt einen Ordner ab und nennt ihn, mit dem Grund in deiner Sprache: das Dateisystem-Root, dein Home-Ordner oder jeder Ordner darüber; ein Ordner im eigenen Speicher eines anderen KI-Werkzeugs (`~/.claude`, `~/.grok`, `~/.codex`, `~/.cursor`, …) oder in EYAS' CLI-Anmelde-Homes; ein Ordner in einem Obsidian-Vault, einem `ai-memory`-Ordner oder einem Eintrag aus `security.foreignMemoryPaths`; ein Ordner im eigenen Datenordner von EYAS (außer einem einzelnen Gesprächs-Workspace, Studio-Projekten und Browser-Downloads); sensible Orte (`.ssh`, `.env`, `master.key`, der Datenbank-Ordner); sowie ein relativer Pfad, ein fehlender Ordner oder eine Datei. Ein Ordner wird auch abgelehnt, wenn er einen solchen Ort **enthält**, und die Meldung nennt, was darin gefunden wurde: das eigene Home, den Datenordner, die Datenbank oder den Workspaces-Ordner von EYAS (der EYAS-Checkout mit `data/`), den Speicher eines anderen KI-Werkzeugs oder einen CLI-Anmeldeordner von EYAS, einen Notiz-Vault, einen `ai-memory`-Ordner oder einen Eintrag aus `security.foreignMemoryPaths` (`~/Documents` mit einem Vault darin). Eine CLI liest und sucht in ihrem Arbeitsordner, ohne zu fragen, ein solcher Ordner lässt sich also nicht sicher übergeben; wähle einen engeren, etwa den Projektordner in `~/Documents` oder einen separaten Klon des Repositorys. Die vollständige Liste: [Gespräche — Ordner](/docs/de/daily/conversations/#working-folders).

Jedes Speichern prüft die ganze Liste; entferne also einen jetzt abgelehnten Ordner, bevor du andere Änderungen speicherst. Früher gespeicherte Ordner, die jetzt abgelehnt werden, werden nicht umgeschrieben, aber jeder Lauf lässt sie aus — EYAS' eigene Datei-Tools, das Security-Gate und den Arbeitsordner der CLI —, und die Runde im Chat zeigt einen Hinweis, der den Ordner nennt. Werden alle gespeicherten Ordner abgelehnt, haben EYAS' eigene Datei-Tools keinen Ordner, und eine CLI arbeitet im eigenen EYAS-Workspace des Gesprächs. Das **Project Types**-Formular zeigt jetzt einen Speicherfehler im Formular (vorher scheiterte das Speichern still). Die API beantwortet einen abgelehnten Ordner bei `POST`/`PATCH /api/v1/projects` und `/api/v1/project-types` mit `400 {error, code, path, found}` (`found` ist der geschützte Ort im Ordner, bei den Codes `containsEyasData`, `containsProviderHome` und `containsVault`); ein `workingDirectories`-Wert, der keine Liste nicht-leerer Pfade (oder `null`) ist, ergibt `400` ohne Code, und `null` oder `[]` leert die Liste weiterhin.

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
