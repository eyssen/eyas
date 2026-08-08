---
title: Gespräche
description: Chat-Arbeitsfläche — alle Felder und die Context-Leiste.
---

**Einstieg:** Sidebar **New Conversation** oder Board/Recent.

## Status

Idle · Working… · Waiting · Waiting approval · Archived.

## Header

| Steuerung | Bedeutung |
|-----------|-----------|
| **Provider… / Model…** | Thread-Override |
| **Auto-routing** | Router wählt |

## Priority

Low · Normal · High · Urgent.

## Gesprächsfelder

| Feld | Bedeutung |
|------|-----------|
| **Project / Stage** | Projektbindung |
| **Agent** | Nach 1. Nachricht **gesperrt** |
| **Effort** | Off / Low / Medium / High / Max |
| **Orchestration** | **Solo** = keine Sub-Agenten · **Auto** · **Deep** = aggressiver Fan-out |

## Stream

Thinking / Composing · **Stop** · Background working · Tool Input/Output/Error · Progress Turn N/Max, Tokens, Cancel · Complexity Simple/Managed/Autonomous/Wizard · Voice INTERNAL/EXTERNAL/AUTO (+ Force).

## Composer

Nachricht (`Shift+Enter` = Zeile) · Attach · **Prompt Enhancer**.

### Prompt Enhancer

Iterativer Coach, der den Prompt an die **Modellfamilie** des Threads anpasst (Claude, OpenAI, Gemini, Grok, Kimi, …).

| Steuerung | Bedeutung |
|-----------|-----------|
| Draft / Ziel | Prompt-Entwurf oder Zielbeschreibung |
| **Optimized for …** | Ziel-Modellfamilie |
| Task-Typ-Chips | **General · Coding · Research · Analysis · Writing · Agentic · Files / vision** |
| **Quality N/10** | Score; **Gaps** = fehlende Checklist-Punkte |
| **Propose two alternatives** | Concise / Thorough / Recommended |
| **Suggested final prompt** · **carry N files** · **Apply** | Einfügen in den Composer |

Für **dauerhafte** Projekt-/Agent-Systemprompts: [Prompt Coach](/docs/de/ai/prompts/).

## Context rail (Chatter)

| Bereich | Inhalt |
|---------|--------|
| Notes/History | Add note, Filter All/Notes/Changes |
| Business fields | Stage, Project, Priority, Status, Due date |
| Activities | Type, Summary, Deadline, Schedule, Mark done |
| Files / Runtime / Next | Anhänge, Meta, nächste Schritte |

## Team

Sub-conversations · Team Dashboard (Finding/Decision/Blocker/…) · Team proposal Approve/Skip/Create specialists · Run tree.

## Verwandt

[Agenten](/docs/de/agents/overview/) · [Board](/docs/de/daily/board/) · [Stimme](/docs/de/agents/voice/)
