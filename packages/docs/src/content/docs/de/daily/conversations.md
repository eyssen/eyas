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

Tabs rechts: **Verlauf · Quellen · Als Nächstes · Dateien**

| Bereich | Inhalt |
|---------|--------|
| **Verlauf** | Notizen, Filter All/Notes/Changes |
| **Quellen** | Multi-Checkbox der Search Sources (Odoo-Versionen etc.). Projekt-Defaults werden bei neuer Conversation / Projektwechsel übernommen. Details: [Suche](/docs/de/daily/search/) |
| **Als Nächstes** | Activities |
| **Dateien** | Anhänge |
| **Runtime** | Ausführungs-Meta (separat von Verlauf) |

**Projekt-Feld:** Wechsel setzt die Standard-Codequellen des neuen Projekts (sofern kein expliziter `searchContext` mitgeschickt wird).

## Team

Sub-conversations · Team Dashboard · Team proposal · Run tree.

## Verwandt

[Suche — Multi-Version-Pin](/docs/de/daily/search/) · [Projekte](/docs/de/daily/projects/) · [Agenten](/docs/de/agents/overview/) · [Board](/docs/de/daily/board/)
