---
title: Teams & Delegation
description: Multi-Agent-Arbeit planen — Phasen, Handoffs und der Vorschlag, den du im Chat genehmigst.
---

**Wozu das da ist.** Teams sind, wie ein Primary delegiert. Hier konfigurierst du Phasen; im Gespräch kann der Agent einen Plan vorschlagen, den du **Approve** oder **Skip**. Sub-Gespräche und das Team Dashboard zeigen, wer was tut. Das ist Zusammenarbeit, nicht God Mode (mehrere Modelle, dieselbe Aufgabe).

## Wann du es brauchst

- Die Arbeit braucht Spezialisten parallel oder nacheinander, nicht einen Agenten allein.
- Git-Worktrees, damit parallele Editoren nicht kollidieren.
- Fehlende Spezialisten-Templates von der Vorschlagskarte (**Create now**).
- Gemeinsamer Team-Speicher: Findings, Decisions, Blockers.

## Typischer Ablauf

1. Öffne **Agenten** und prüfe, dass Primary plus Spezialisten existieren (Setup **Team agents**, oder hier anlegen).
2. Starte ein Gespräch, setze **Orchestration** auf **Auto** oder **Deep**, sende ein komplexes Ziel.
3. Bei **Team proposal**: Phasen prüfen (parallel / sequential), dann **Approve** (oder **Create now**).
4. **Team / Sub-conversations → Open Team Dashboard**. Du solltest Member-Chats, Phase und Team-Memory sehen.

## Funktionen

Primary delegiert an Team/Specialists. **Team Builder**: Phasen parallel/sequentiell, Token-Schätzung. Im Chat: Sub-conversations, Team Dashboard, Team proposal (Approve/Skip/Create specialists). Setup-Schritt Team-Agenten.

**Worktrees** bei complex/epic unter `.eyas-worktrees/`. Optional **`agent.verifyCommands`** (Lint/Test vor dem Critic) — [Konfiguration](/docs/de/deploy/configuration/).
