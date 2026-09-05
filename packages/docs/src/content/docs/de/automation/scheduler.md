---
title: Planer
description: Wiederkehrende Jobs, Agenten-Routinen, Kalender und Gantt, nicht ausführbare Jobs.
---

**Wozu das da ist.** Der Planer ist die Uhr: System-Handler (Backup, Wartung) und Agenten-Routinen (Prompt auf Cron). Du legst Jobs an, siehst Last/Next und fängst die, die nie feuern. Nicht das Board.

**Route:** `/scheduler`. Sidebar: **Planer**.

## Wann du es brauchst

- Ein Agent soll morgens einen Prompt fahren, ohne Gespräch.
- Backup auf Cron, Last/Next sichtbar.
- Ein Job hängt — Badge **Kein Handler / Feuert nie / Nicht geplant**, kein stilles Auslassen.
- Cluster-Leadership, overdue, Dead-Letter.

## Typischer Ablauf

1. **Planer** (`/scheduler`).
2. **Liste / Gantt / Kalender**. Zoom **Tag / Woche / Monat**.
3. **Job erstellen** — Name, Art (**System-Handler** / **Agenten-Routine**), Trigger (**Cron / Intervall / Ereignis**).
4. Health-Leiste. **Cannot-run**-Badge: Hover für die Ursache.
5. **Jetzt ausführen** (einziger Weg für Ereignis-Jobs). **Pause / Fortsetzen**, **Umplanen**.

## Funktionen

Drei Sichten, dieselben Jobs. **Infrastruktur-Jobs anzeigen** blendet kaputte System-Jobs **nicht** aus.

Ungültiges Cron oder Intervall unter einer Sekunde wird bei **Erstellen** abgelehnt. **Ereignis** wird angenommen, feuert aber nicht von allein — Badge **Feuert nie**.

## Felder und Steuerelemente

Ansichten: **Liste / Gantt / Kalender**. Felder: Jobname, Handler, Trigger, Cron, Intervall (ms), Ereignisname, Agent-ID, Prompt. Zeilenaktionen: Pause/Laufend, Cannot-run-Badge, Last/Next, Zähler, Jetzt ausführen, Pause/Fortsetzen, Umplanen+Anwenden, Löschen. Health: Leader/Follower, aktiv, laufend, Fehler 24h, Dead-Letter, überfällig, kann nicht laufen. Filter **Nur Jobs zeigen, die nicht laufen können**.

## Verwandt

- [CLI / Config](/docs/de/deploy/configuration/)
- [Agenten](/docs/de/agents/overview/)
- [Sicherung](/docs/de/admin/backup/)
- [Start](/docs/de/daily/home/)
