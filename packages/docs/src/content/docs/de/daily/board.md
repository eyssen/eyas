---
title: Board
description: Gespräche über Stages schieben — Kanban, Liste, Timeline, Graph und Dashboard.
---

**Wozu das da ist.** Das Board ist die Arbeitsfläche für Gespräche. Jede Karte ist ein Thread: du ziehst sie über Stages, filterst nach Projekt und öffnest sie zum Sprechen. Kanban, Liste, Timeline, Graph und Dashboard lesen denselben gefilterten Satz.

## Wann du es brauchst

- Du willst alle offenen Threads eines Projekts als Spalten (oder alle Projekte auf einmal).
- Arbeit in die nächste Stage, eine Karte pinnen, oder überfällige / feststeckende / genehmigungswartende Dinge sehen.
- Eine sortierbare Liste, eine Timeline der Fälligkeiten oder den Graph eines Orchestrierungslaufs.
- Heutiger Durchsatz, Kosten und Live-Läufe, ohne das Board zu verlassen.
- Ein neues Gespräch in einem bestimmten Projekt und Stage.

## Typischer Ablauf

1. Öffne **Board** in der Sidebar (**Haupt**) — Route `/board`.
2. Wähle ein Projekt (oder **All projects**). Wechsle **Kanban** / **List** / **Timeline** / **Graph** / **Dashboard**.
3. Ziehe eine Karte in eine neue Stage, oder klicke sie, um das Gespräch zu öffnen.
4. Die Karte sollte in der neuen Spalte stehen (und das Gesprächsfeld **Stage** dazu passen). Filter bleiben beim Ansichtswechsel.

## Funktionen

## Projektfilter

All projects · Projektwähler · *No projects yet*.

## Neu

**New** + **Conversation title…**.

## Views

Kanban · List · Timeline · Graph · Dashboard.

**Group by:** Stage · Priority · Assignee (+ Unassigned).

## Karte

Title, Pinned, Working/Waiting/Approval/Error, Subtasks N/M, Context %, Overdue, $cost, Aging (h/d/stuck).

## Spalte

Fold · Drop here · WIP n/limit.

## Filter

Stage, Priority, Tags, Active/Done/All, Name…, Content…. Priority: Urgent–Low.

**Tags sind ein Board-Filter, kein Projektbaum.** Kategorienamen wie `module` und `area` sind Beispiele, die du auf dieser Instanz anlegst; die Werte hängen am Gespräch. Projekt wählen, dann Tag — so schneidest du innerhalb des Projekts, ohne Unterprojekt. Gesprächs-Tags stehen als eine `tags: …`-Zeile im Prompt-Suffix (nicht im Cache-Prefix).

## Liste

Spalten P, ID, Title, Project, Updated. Pin, Archive, Undo Delete.

## Timeline

Fenster 1h / 24h / 7d / 30d · Now · Agent runs · Due · Updated.

## Board-Dashboard

Open tasks, Done today, In progress, Running, Waiting approval, Cost today, Throughput, Activity, Priority mix, Tasks per stage, Live/Disconnected.

## Graph

Orchestration / Stage flow · Run-Selektor.

## Verwandt

[Gespräche](/docs/de/daily/conversations/) · [Projekte](/docs/de/daily/projects/)
