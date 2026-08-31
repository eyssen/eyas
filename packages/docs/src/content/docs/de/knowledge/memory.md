---
title: Speicher
description: Was EYAS behält — automatische Vault-Notizen, fünf Stufen, und welchen Store du wann nutzt.
---

**Wozu das da ist.** Speicher ist EYAS' eigener Langzeitspeicher. Ein dauerhafter Fakt aus einem Gespräch wird ohne Nachfrage zur Vault-Notiz, und dieselbe Notiz liest jedes spätere Gespräch zurück. Hier prüfst du Working-Blöcke, episodische Fakten, Vault-Dateien und die Review-Queue — du kuratierst kein Wiki.

## Wann du es brauchst

- Der Assistent soll sich merken, wer du bist, wie du arbeitest, oder welche Constraints ein Projekt hat.
- Ein Fakt stand im Chat, und du willst sehen, ob er in der Vault gelandet ist (oder warum Capture übersprungen wurde).
- Review, Tags, Graph oder Konsolidierung — oder **Today's note**.
- Du wählst zwischen Speicher, Wissens-Wiki, Dokumenten und handgeschriebenen Vault-Dateien (siehe unten).
- Capture für diese Instanz aus (`memory.capture.enabled: false`).

## Typischer Ablauf

1. Öffne **Speicher** in der Sidebar (**Inhalt**) — Route `/memory`. (Auch unter **Einstellungen → KI & Modell**.)
2. **Overview** (Zähler, Salience, jüngste Episoden), dann **Vault Files** für dauerhafte Notizen.
3. Führe ein Gespräch länger als ~40 Zeichen, das einen bleibenden Fakt nennt. Nach der Antwort hierher — eine neue Vault-Notiz (`user`, `feedback`, `domain`, `project` oder `reference`).
4. Wenn nichts erscheint: zu kurz, Capture aus, oder God-Mode-Runde (die capturen nicht). Schreib die Notiz sonst von Hand in die Vault.

## Welchen Store

| Store | Job |
|-------|-----|
| **Speicher** (diese Seite) | Automatische + agentengeschriebene Fakten. EYAS injiziert einen Einzeilen-Index in spätere Prompts. |
| **Wissen** Wiki | Kuratierte Seiten, **die du** editierst. Capture schreibt hier nicht. |
| **Dokumente** | Hochgeladene Dateien zur Retrieval — keine Identitätsnotizen. |
| **Vault-Dateien** (handgeschrieben) | Dieselbe Vault wie Capture (`data/vault/…`). Nicht `~/.claude` / `~/.grok`. |
| **Projekt-Wiki** | Ticket- und Entscheidungsseiten eines Projekts, nicht globaler Speicher. |

Host-Claude- / Grok-Speicher auf der Maschine ist **nicht** die Quelle. Isolierte CLI-Aufrufe und `loadClaudeMd` default-aus verhindern, dass ein zweiter Speicher die Vault überholt.

## Funktionen

**Route:** `/memory`. Aktionen: Today's note · Consolidate Now · Refresh. Tabs: Overview · Working · Episodic · Vault · Archive · Graph · Tags · Review.

Working: 24h-TTL. Episodic: salience, invalidated, Provenance. Vault: Markdown + Frontmatter. Archive: niedrige Salience.

## Dauerhafte Notizen

Eine dauerhafte Notiz ist ein bleibender Fakt, kein Ereignisprotokoll: wer du
bist, wie gearbeitet werden soll, welche Randbedingungen ein Projekt hat. Jede
ist eine Markdown-Datei im Vault, und der Agent bekommt pro Zug einen
**einzeiligen Index** davon — nur die Zusammenfassungen; die ganze Notiz liest
er bei Bedarf mit `search_memory`.

Zwei Frontmatter-Felder steuern das: `kind` (`user`, `feedback`, `domain`,
`project`, `reference` — zugleich die Rangfolge) und `summary` (die Indexzeile). `user`
und `feedback` stehen vorn. `domain` ist der Projekttyp (geteilt mit Geschwisterprojekten),
`project` dieser eine Mandant. Ohne `kind` gilt eine Notiz in `procedural/` als
`feedback`, sonst als `reference` — nie als `user`. Ohne `summary` wird die
erste echte Zeile verwendet, eine handgeschriebene Datei funktioniert also ohne
EYAS-spezifisches Frontmatter.

Ablage: `data/vault/semantic|procedural|projects|project-types/`.

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

Agenten erinnern mit `search_memory`. Default-**`scope` ist `current`**: dieses Projekt, sein Typ, globale user/feedback/reference-Notizen. `scope: all` für den ganzen Vault. Die Memory-Seite (`/memory`) sucht ungefiltert.

### Capture ist standardmäßig an

Capture läuft auf **jeder** Unterhaltung, global, außer `memory.capture.enabled: false` in `config/default.yaml`. Ein kleiner Modellaufruf hängt **nach** der zugestellten Antwort — nie im kritischen Pfad. Ein fehlgeschlagenes Capture ist eine fehlende Notiz, nie ein fehlgeschlagenes Gespräch.

| Gate | Default | Bedeutung |
|------|---------|-----------|
| `memory.capture.enabled` | **an** | Hauptschalter |
| `minUserChars` | 40 | Unicode-Codepunkte; kürzer überspringt den Aufruf |
| `maxPerConversation` | 20 | Modell-Spend-Deckel (erfolgreich, unparsable, error zählen; too-short nicht) |

Keine Stichwortliste. `{"notes":[]}` ist die häufige und richtige Extractor-Antwort (0–2 Notizen).

### Isolierte CLI — nur EYAS-Speicher

Die Extraktion läuft in einem **isolierten** Modellkontext: keine Host-Filesystem-Settings, kein CLI-nativer Speicher, keine gebridgten Tools, eine Runde. Gespräche auf Claude Code CLI defaulten **`loadClaudeMd` aus** — kein `~/.claude`, keine CLAUDE.md, keine Host-Skills, kein Projekt-`.mcp.json`. Isolierte und opt-out-Aufrufe setzen außerdem `CLAUDE_CODE_DISABLE_AUTO_MEMORY` und `strictMcpConfig`.

Grok / Kimi (ACP) haben keinen Isolationsschalter; ihre Provider-Panels sagen das. Agenten sollen nur `search_memory` / `save_memory` nutzen; das Schreib-Gate sperrt `~/.claude`, `~/.grok` und `ai-memory`.

Ohne Isolation las der Extractor einmal den Host-Speicher des Owners, meldete den Fakt „schon gespeichert“, und die EYAS-Vault blieb leer. Das schließt diesen Bug.

### Capture-Lauf-Ledger

Jedes Ergebnis, das das Gate erreicht, schreibt eine `memory_capture_runs`-Zeile: Skips mit Grund, Extraktionen mit Kinds, plus Spalte `provider` (`provider/model`, oder null). Zwei Absichten: Capture aus schreibt nichts; ein Hintergrundlauf ohne Assistant-Text erreicht das Gate nicht. **God Mode**-Runden kehren vor dem Post-Turn-Block mit eigenem Stream zurück — keine Notiz, keine Zeile.

---

## Shared Memory Blocks

Zusätzlich zum UI-Speicher: Agenten-Tools für **scoped Blocks** (Letta-Stil):

| Scope | Geteilt unter |
|-------|----------------|
| company / agent / team / run | Instanz / Agent / Team / einzelner Run |

Tools: `memory_block_read` · `memory_block_write`.

## Verwandt

- [Wissensbasis](/docs/de/knowledge/knowledge-base/)
- [Dokumente](/docs/de/knowledge/documents/)
- [Projekt-Wiki](/docs/de/knowledge/client-wiki/)
- [Anbieter](/docs/de/ai/providers/) (CLI-Isolation / `loadClaudeMd`)
- [Tools](/docs/de/automation/tools/)
