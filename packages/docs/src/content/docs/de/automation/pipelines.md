---
title: Pipelines
description: Ticket-to-Code-Läufe — Ingest, klären, designen, implementieren, Review, PR, Deploy.
---

**Wozu das da ist.** Eine Pipeline ist ein orchestrierter Mehrschritt-Job. Die Oberfläche heute ist **Ticket-to-Code**: Board-Ticket (oder manuelle Id) durch Ingest → PM Clarify → Architect Design → Implement → Review → PR → Deploy, mit menschlichem Gate. Kein generischer Workflow-Editor.

**Route:** `/pipelines`. Sidebar: **Pipelines**.

## Wann du es brauchst

- Ein Board-Ticket soll Code werden, gestuft, nicht als einzelner Chat.
- Review- oder Deploy-Gate vor der nächsten Stufe.
- Lauf fehlgeschlagen/abgebrochen — **Fortsetzen**.
- Historie Ticket → Stufe → Ende.

## Typischer Ablauf

1. **Pipelines** (`/pipelines`).
2. **Lauf starten**: Quelle **board** / **manual**, **Ticket-Id**, **Start**.
3. Laufseite (`/pipelines/<runId>`). Stufen nacheinander.
4. **Wartet auf Freigabe** → **Freigeben**. **Abbrechen** / **Fortsetzen**.
5. **Aktualisieren** (kein Polling). Fertig bei **Abgeschlossen**.

## Funktionen / Felder

Quellen: internes EYAS-**Board** und **manuell**. Status: Running, Waiting for approval, Completed, Failed, Cancelled. Stufen: Ingest, PM Clarify, Architect Design, Dev Implement, Review, Open PR, Deploy. Stufenstatus: Pending, Running, Succeeded, Failed, Skipped, Awaiting approval.

## Verwandt

- [Agent-Läufe](/docs/de/agents/runs/)
- [Projekte](/docs/de/daily/projects/)
- [Board](/docs/de/daily/board/)
- [Skills](/docs/de/automation/skills/)
