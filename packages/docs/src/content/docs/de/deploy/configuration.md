---
title: Konfiguration
description: YAML-Defaults, lokale Overlays, Env-Rangfolge — nach gewähltem Install-Pfad.
---

**Wozu das da ist.** Listen-Adresse, Module, Autonomie, Memory-Capture und Verify-Commands ohne Rebuild. `local.yaml` und `EYAS_*` — nicht `config/default.yaml` wenn vermeidbar.

## Wann du es brauchst

- Host/Port, Log-Level, Modul aus.
- **Modellaufruf-Capture** aus (`memory.capture.enabled: false`) — Default an. Das stoppt das Roh-Capture **nicht**: `memory.l0.enabled` ist ein eigener Schalter, ebenfalls default an.
- **Roh-Capture** aus (`memory.l0.enabled: false`), wenn du keine wörtliche Zweitkopie jeder Nachricht auf der Platte willst.
- Extra Skill-/Persona-Ordner (`skills.importRoots` / `agent.importRoots`) ohne Host-Claude-Config.
- `agent.verifyCommands`, damit ein Coding-Lauf nicht „fertig“ ist bevor Tests laufen.
- Mehrere Odoo-Checkouts via `EYAS_ODOO_SOURCES_JSON`.

## Typischer Ablauf

1. `local.yaml` anlegen.
2. Nur nötige Keys. `eyas config validate`.
3. `eyas restart` oder `eyas config reload`.
4. Einstellungen + `eyas doctor`.

Rangfolge: CLI-Flags → `EYAS_*` → local YAML → default YAML.

```yaml
memory:
  capture:
    enabled: true
    minUserChars: 40
    maxPerConversation: 20
```

```yaml
skills:
  importRoots: []
agent:
  importRoots: []
```

Shipped Default ist die leere Liste. Pfade in `local.yaml`. Importierte Skills gewinnen gegen bundled Kopien. Isolation bleibt an. Siehe [Fähigkeiten](/docs/de/automation/skills/).

`agent.verifyCommands` ohne Shell. `EYAS_AUTO_FAILOVER` füllt leere Routing-Fallbacks. `EYAS_BROWSER_USER_DATA_DIR` ist das EYAS-eigene Headless-Profil (nie das tägliche Chrome-Profil). `EYAS_AGENT_BROWSER_BIN` zeigt auf die optionale agent-browser-CLI (sonst PATH; gesetzter fehlender Pfad = fail-closed). Siehe [Speicher](/docs/de/knowledge/memory/), [FAQ](/docs/de/reference/faq/).

## Roh-Capture (0.8.23-beta)

```yaml
memory:
  engine: legacy           # 'legacy' oder 'v2'; der Abruf ist in beiden Fällen derselbe
  l0:
    enabled: true          # false = gar keine Rohkopien
    captureToolResults: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

Das ist **nicht** derselbe Schalter wie `memory.capture` oben. Capture schreibt Vault-Notizen und kostet einen kleinen Modellaufruf; das Roh-Capture legt eine **wörtliche Zweitkopie jeder gespeicherten Nachricht** ab — komprimiert und inhaltsadressiert — **ohne Modellaufruf und ohne API-Kosten**. Default an.

| Key | Default | Bedeutung |
|-----|---------|-----------|
| `memory.l0.enabled` | **`true`** | Hauptschalter fürs Roh-Capture. `false` zeichnet nichts auf und puffert nichts. |
| `memory.l0.extractInLegacy` | **`true`** | Führt den deterministischen Durchlauf (Fakten, Zusammenfassung, Entitäten, Themen, Wichtigkeit) nach jedem Flush aus, solange `engine` noch `legacy` ist. `false` behält den Rohtext und leitet nichts daraus ab. |
| `memory.engine` | **`legacy`** | `legacy` oder `v2`. Heute steuert das nur die Extraktion — `v2` lässt den deterministischen Durchlauf auch dann laufen, wenn `extractInLegacy` auf `false` steht. Es ändert **nicht**, woran sich ein Gespräch erinnert. |
| `memory.l0.chunkTokens` | **`8000`** | Größen-Trigger für den Flush: Der Puffer eines Gesprächs wird geschrieben, sobald seine geschätzte Token-Zahl diesen Wert erreicht. |
| `memory.l0.idleFlushMinutes` | **`30`** | Zeit-Trigger für den Flush: Ein minütlicher Durchlauf schreibt jeden Puffer raus, der so lange untätig war. Auch das Schließen des Gesprächs und das Stoppen von EYAS lösen einen Flush aus, ein sauberer Neustart verliert also nichts. |
| `memory.l0.captureToolResults` | **`false`** | Auch Tool-Ausgaben aufzeichnen. **Lies den nächsten Absatz, bevor du das einschaltest.** |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Byte-Deckel für ein einzelnes aufgezeichnetes Tool-Ergebnis, an einer UTF-8-Grenze abgeschnitten und sichtbar als gekürzt markiert. Nur Tool-Ergebnisse; Nachrichten sind nicht gedeckelt. |

**`captureToolResults` ist aus gutem Grund aus.** Ein aufgezeichnetes Tool-Ergebnis ist die gesamte Ausgabe, wörtlich und ungeschwärzt, plus 2.048 abgeschnittene Zeichen der Aufruf-Argumente: `run_command`-stdout, `read_file`-Inhalte und ein gültiger Einmalcode aus `browser_totp` landen alle als Klartext in der Rohschicht. Nichts schwärzt sie, nichts verschlüsselt sie im Ruhezustand — Kompression ist keine Vertraulichkeit. Bei eingeschaltetem Flag protokolliert jeder Start genau diese Warnung. Schalte es nur dort ein, wo das für diese Maschine vertretbar ist.

**Diese Zeilen werden bisher nirgends gelesen.** 0.8.23-beta ist reiner Schreibpfad: kein Abruf, keine Seite in der UI, kein API-Endpunkt, kein `eyas memory`-Befehl. Prompts entstehen weiterhin genau wie vorher aus Vault und früheren Gesprächen; `memory.engine: v2` zu setzen ändert heute also nichts Sichtbares.

**Das Roh-Capture wächst, und nichts räumt es auf.** In dieser Version gibt es keine Aufbewahrungseinstellung und keinen Cleanup-Job; eine aufgezeichnete Nachricht kostet inklusive Indizes rund 5 KB auf der Platte. Wenn du das noch nicht zahlen willst: `memory.l0.enabled: false`. Siehe [Speicher](/docs/de/knowledge/memory/).

## Speicherindex und Recall

| Key | Default | Bedeutung |
|-----|---------|-----------|
| `memory.index.budgetChars` | **`2400`** | Zeichen des Dauerindex des Speichers pro Zug (≈ 600 Tokens). Auf etwa 8000 anheben, wenn deine `user`- und `feedback`-Notizen nicht mehr hineinpassen. Braucht einen Neustart. |
| `memory.recall.includeSecrets` | **`false`** | Ob Notizen, episodische Zeilen und Skills mit dem Tag `contains-secrets` (Dateien, in denen der Importer Zugangsdaten fand und die wörtlich gespeichert wurden) dem Modell im Speicherindex, in verwandter Arbeit und in `search_memory` gezeigt werden. Aus sind sie gespeichert und auf der Speicher-Seite sichtbar, erreichen aber nie einen Prompt. Braucht einen Neustart. |

## Datenbank-Dauerhaftigkeit

Seit 0.8.23-beta führt jede EYAS-Datenbankverbindung `PRAGMA synchronous = NORMAL` aus statt SQLites Default `FULL`. Zusammen mit WAL, das EYAS schon immer nutzt, heißt das:

- Ein **Prozess**-Absturz — EYAS gekillt, ein unbehandelter Fehler — verliert nichts, was schon committet ist.
- Ein **OS**-Absturz oder Stromausfall genau im Moment eines Commits kann die letzte Transaktion verlieren.

Das ist der übliche WAL-Kompromiss, und er gilt für **alle** Module, nicht nur den Speicher. Wenn auf deiner Instanz Arbeit liegt, die du nicht noch einmal eingeben kannst, ist [Sicherung](/docs/de/admin/backup/) die Antwort auf Dauerhaftigkeit, nicht der Commit-Modus.

## Verwandt

- [CLI](/docs/de/deploy/cli/)
- [Anbieter](/docs/de/ai/providers/)
- [Routing & Budget](/docs/de/ai/routing-budget/)
- [Speicher](/docs/de/knowledge/memory/)
