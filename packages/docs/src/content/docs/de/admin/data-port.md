---
title: Datenimport & -export
description: Import-Assistent für Speicher, Skills und Workspace-Regeln — scannen, wählen, freigeben.
---

**Wozu das da ist.** Data-Port ist der **Import-Assistent**. Er scannt einen Serverpfad oder ein Upload-Zip/Markdown aus einem anderen Assistenten und schlägt vor, wohin es gehört. Speicher kann angewandt werden; Workspace-Regeln und Identity sind **nur Vorschlag** bis zur Merge-Freigabe. Kein Full-DB-Dump — dafür [Sicherung](/docs/de/admin/backup/). Export ist **Demnächst**.

**Ort:** Einstellungen → **Datenportabilität**.

## Wann du es brauchst

- Dauerhafte Notizen aus `~/.claude` oder einem Obsidian-`ai-memory` in EYAS (die einzige Erinnerung, die spätere Runden lesen).
- Custom Skills aus Claude/Cursor → Kategorie **own**.
- Workspace-Regeln/Identity als Merge-Vorschläge, nie Auto-Overwrite.

## Typischer Ablauf

1. **Einstellungen** → **Daten importieren…**
2. **Quellsystem** (Auto, Claude Code, Cursor, Obsidian, generic-md, chat-export, eyas-export).
3. **Serverpfad** oder **Datei wählen…**. Optionale **Anweisungen**.
4. **Scannen**. Gruppen wählen.
5. **N Einträge importieren**. Regeln/Identity: **Merge freigeben** / **Ablehnen**.

Schritte: source → review → running → done. Stats: Applied / Proposals / Skipped / Errors.

Der perfekte Ordner ist nicht nötig. Ein **Home-Scan** bleibt in Assistenten-Ordnern und **Documents** (Obsidian `ai-memory` wird erreicht). `GitHub` und andere Quellbäume werden **nicht** betreten. Dort **übersprungen**: Index-`MEMORY.md`, Chat-Session-Dumps (`claude-sessions`), Produktdokus, `robots.txt`/LICENSE, `AGENTS.md` in App-Repos — auch bei „alles auswählen“. Notizen unter `ai-memory` / `.grok/memory` / `.claude/skills` werden kopiert, `kind: reference` wenn undeclared. Die Quellpfade werden danach nicht erneut gelesen.

## Verwandt

- [Speicher](/docs/de/knowledge/memory/)
- [Skills](/docs/de/automation/skills/)
- [Sicherung](/docs/de/admin/backup/)
- [Agenten — Workspace](/docs/de/agents/identity-workspace/)
