---
title: Teams und Delegation
description: Kollegen, mit denen du sprichst, Spezialisten, die sie starten, und wann noch ein Teamvorschlag erscheint.
---

**Wozu.** Du sprichst mit **Kollegen** (Primary- und Team-Agenten). Sie haben strenge Rollen. Sie geben Arbeit an einen anderen Kollegen oder starten **Spezialisten** aus einem gemeinsamen Pool — automatisch, oft parallel. Eine Teamvorschlag-Karte erscheint nur, wenn ein Spezialist fehlt, du ein Team verlangt hast, oder die Arbeit episch ist.

Das ist Zusammenarbeit, nicht God Mode.

## Wann

- Du willst mit dem Personal Assistant oder System Engineer als Personen sprechen.
- Ein Job braucht mehrere Spezialisten gleichzeitig (`run_specialist` in einem Turn).
- Git-Worktrees, damit parallele Editoren nicht kollidieren.
- Du willst einen sichtbaren Plan **Approve**n, wenn der Spezialist noch nicht existiert.

## Ablauf

1. Öffne einen **Kollegen** in der Sidebar.
2. Beauftrage sie. `handoff_to_colleague` oder `run_specialist`.
3. Spezialisten-Läufe erscheinen als Untergespräche. Team-Memory ohne Karte (implizite Session).
4. Bei mehreren Spezialisten: **Team-Dashboard**.
5. **Team proposal** bei `/team` oder epischer Arbeit — **Approve** oder **Skip**.

## Begriffe

| Begriff | Bedeutung |
|---------|-----------|
| **Kollege** | Primary- oder Team-Agent mit Home-Thread. |
| **Spezialist** | Schmaler Arbeiter. Gemeinsamer Pool. |
| **`run_specialist`** | Inline-Spawn. Grün. Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | Home-Thread des anderen Kollegen. Grün. |
| **`assign_task`** | Asynchrone Board-Karte. Grün, wenn das Ziel aktiv ist. |
| **`propose_team`** | Karte für fehlende Rollen / episch / explizite Bitte. Gelb. |

## Siehe auch

- [Gespräche](/docs/de/daily/conversations/)
- [Läufe](/docs/de/agents/runs/)
- [Agenten-Übersicht](/docs/de/agents/overview/)
