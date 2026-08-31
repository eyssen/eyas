---
title: Identität & Workspace
description: IDENTITY, AGENTS, TOOLS und MEMORY bearbeiten — und einen Snapshot wiederherstellen.
---

**Wozu das da ist.** Workspace-Dateien sind die langlebige Prosa des Agenten: wer er ist, wie er zum Team steht, wie er Tools nutzen soll, woran er sich erinnert. Tiefer als das Configuration-Formular. Wenn Autonomie Self-Update verbietet, kommen Identitätsänderungen über [Forge](/docs/de/agents/forge/), nicht als stilles Überschreiben.

## Wann du es brauchst

- **Who I am**, **My mission**, Eskalation und Ablehnungsregeln schreiben oder wiederherstellen.
- Anleitung zum Team (`AGENTS`) oder zur Tool-Politik (`TOOLS`).
- Ein schlechter Edit — **History → Restore**.
- Ein Forge-Soul-Vorschlag gegen die aktuelle IDENTITY.

## Typischer Ablauf

1. Öffne **Agenten** → den Agenten → Tab **Workspace** — Route `/agents/:id`.
2. Wähle eine Datei (**Who I am**, **Team description**, **Tools**, **Memory**). **Editor** oder **Preview**.
3. IDENTITY-Chips springen zu fehlenden Überschriften (oder legen sie an). **Save**.
4. **History**, wenn ein Snapshot braucht. Nach Restore muss die Datei auf der Platte dem Snapshot gleichen.

## Funktionen

**Route:** Workspace-Tab. Dateien unter `data/agents/<id>/`.

| Datei | Inhalt |
|-------|--------|
| Who I am | IDENTITY |
| Team description | AGENTS |
| Tools | TOOLS |
| Memory | MEMORY |

Editor/Preview/Save. IDENTITY-Sektionen: Who I am, Mission, Proactive duties, Escalate, Refuse. History mit View/Restore.

Form-Config ≠ Workspace-Prosa ≠ [Forge](/docs/de/agents/forge/)-Vorschläge.
