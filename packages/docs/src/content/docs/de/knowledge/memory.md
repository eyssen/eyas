---
title: Speicher
description: Fünf-stufiger Hybrid-Speicher und shared Memory Blocks.
---

**Route:** `/memory`. Aktionen: Today's note · Consolidate Now · Refresh. Tabs: Overview · Working · Episodic · Vault · Archive · Graph · Tags · Review.

Working: 24h-TTL. Episodic: salience, invalidated, Provenance. Vault: Markdown + Frontmatter. Archive: niedrige Salience.

## Dauerhafte Notizen

Eine dauerhafte Notiz ist ein bleibender Fakt, kein Ereignisprotokoll: wer du
bist, wie gearbeitet werden soll, welche Randbedingungen ein Projekt hat. Jede
ist eine Markdown-Datei im Vault, und der Agent bekommt pro Zug einen
**einzeiligen Index** davon — nur die Zusammenfassungen; die ganze Notiz liest
er bei Bedarf mit `search_memory`.

Zwei Frontmatter-Felder steuern das: `kind` (`user`, `feedback`, `project`,
`reference` — zugleich die Rangfolge) und `summary` (die Indexzeile). `user`
und `feedback` stehen vorn. Ohne `kind` gilt eine Notiz in `procedural/` als
`feedback`, sonst als `reference` — nie als `user`. Ohne `summary` wird die
erste echte Zeile verwendet, eine handgeschriebene Datei funktioniert also ohne
EYAS-spezifisches Frontmatter.

Ablage: `data/vault/semantic|procedural|projects/`.

**Automatisch geschrieben wird davon noch nichts** — der Vault enthält genau
das, was bewusst hineingelegt wurde.

---

## Shared Memory Blocks

Zusätzlich zum UI-Speicher: Agenten-Tools für **scoped Blocks** (Letta-Stil):

| Scope | Geteilt unter |
|-------|----------------|
| company / agent / team / run | Instanz / Agent / Team / einzelner Run |

Tools: `memory_block_read` · `memory_block_write`.

## Verwandt

- [Wissensbasis](/docs/de/knowledge/knowledge-base/)
- [Tools](/docs/de/automation/tools/)
