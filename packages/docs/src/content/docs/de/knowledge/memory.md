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

**Sie füllen sich selbst.** Nachdem die Antwort ausgeliefert ist, liest ein
kleiner Modellaufruf den Austausch und fragt, ob darin etwas steckt, das in
einem Monat noch stimmt und noch nützlich ist. Höchstens zwei Notizen pro Zug,
meist zu Recht keine. Das läuft nie im kritischen Pfad deiner Antwort: eine
gescheiterte Erfassung kostet eine Notiz, nie eine Antwort.

Davor steht eine einzige Längenprüfung — eine Nachricht unter `minUserChars`
(Standard: 40 Zeichen) löst keinen Aufruf aus — plus höchstens
`maxPerConversation` (20) Aufrufe je Unterhaltung. Keine Stichwortliste, in
keiner Sprache. Abschalten mit `memory.capture.enabled: false` in
`config/default.yaml`; von Hand geschriebene Notizen und `save_memory` bleiben
unverändert.

Ein wiederholter Fakt bestärkt die vorhandene Notiz, statt eine zweite anzulegen:
die neue Formulierung kommt als datierter Punkt unter `## History` dazu und
überschreibt nichts. Bereinigt wird vor dem Schreiben, nicht beim Lesen.

**Projektgedächtnis.** Was in den Unterhaltungen eines Projekts gelernt wurde,
liegt unter `projects/<projekt-id>/`, steht in diesem Projekt vor den
allgemeinen `reference`-Notizen und taucht sonst nirgends auf — Notizen fremder
Projekte erreichen den Prompt nie. Das Sammelprojekt **General**, in dem jede
Unterhaltung startet, zählt dabei nicht als Projekt: dort Gelerntes bleibt ein
Fakt über dich oder über die Arbeitsweise und begleitet dich überall hin.

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
