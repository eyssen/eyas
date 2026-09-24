---
title: Konfiguration
description: YAML-Defaults, lokale Overlays, Env-Rangfolge — nach gewähltem Install-Pfad.
---

**Wozu das da ist.** Mit der Konfiguration änderst du Listen-Adresse, Module, Autonomie, Speicher-Capture und die Verify-Befehle von Agenten, ohne neu zu bauen. Bearbeite `local.yaml` und `EYAS_*`-Umgebungsvariablen — `config/default.yaml` nur, wenn es sich nicht vermeiden lässt (Upgrades überschreiben die ausgelieferten Defaults). Dieses Kapitel setzt voraus, dass du dich schon für [nativ](/docs/de/deploy/native/), [Docker](/docs/de/deploy/docker/) oder [Kubernetes](/docs/de/deploy/kubernetes/) entschieden hast.

## Wann du es brauchst {#when-to-use-it}

- Host/Port, Log-Level, Modul aus.
- **Modellaufruf-Capture** aus (`memory.capture.enabled: false`) — Default an. Das stoppt das Roh-Capture **nicht**: `memory.l0.enabled` ist ein eigener Schalter, ebenfalls default an.
- **Roh-Capture** aus (`memory.l0.enabled: false`), wenn du keine wörtliche Zweitkopie jeder Nachricht auf der Platte willst.
- Extra Skill-/Persona-Ordner (`skills.importRoots` / `agent.importRoots`) aus gewöhnlichen Ordnern — die eigenen Ordner anderer Assistenten werden übersprungen.
- `agent.verifyCommands`, damit ein Coding-Lauf nicht „fertig“ ist bevor Tests laufen.
- Mehrere Odoo-Checkouts via `EYAS_ODOO_SOURCES_JSON`.
- Dem Modell die richtige Ortszeit sagen (`i18n.timezone`).
- Das Datenverzeichnis (`EYAS_DATA_DIR`) oder die Gesprächs-Workspaces (`EYAS_WORKSPACES_DIR`) verschieben oder das Binary von Claude Code, Grok oder Kimi festlegen (`EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`).
- Weitere Speicher-Stores vor Modellen schützen (`security.foreignMemoryPaths`) oder die Kernel-Datei-Sandbox für die eigenen Tools der CLIs verlangen (`security.cliSandbox: required`).
- CLI-Runden mehr oder weniger Zeit geben, bevor sie wegen Stille gestoppt werden (`model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`).

## Typischer Ablauf {#typical-workflow}

1. Kopiere oder lege `local.yaml` neben die ausgelieferten Defaults (oder setze `EYAS_HOME`, damit sie bei dieser Instanz liegt).
2. Ändere nur die Keys, die du brauchst. Prüfen: `eyas config validate`.
3. Neu starten (`eyas restart`). EYAS liest `default.yaml` und `local.yaml` einmal beim Start; `eyas config reload` lädt diese beiden Dateien **nicht** neu. Dateien unter `config/personality/`, die das angeben (etwa `privacy.yaml`), werden ohne Neustart übernommen.
4. In den **Einstellungen** und mit `eyas doctor` bestätigen.

## Funktionen {#features}

| Datei | Rolle |
|-------|-------|
| `config/default.yaml` | Ausgelieferte Defaults |
| `local.yaml` | Überlagerung (Merge) |
| `.env` | Optionale Geheimnisse (nie committen) |

Rangfolge: CLI-Flags → `EYAS_*`-Umgebung → lokales YAML → Default-YAML.

Beispiel-Keys in default.yaml: `server.host/port`, `database.path`, `log.level`, `i18n.timezone`, `modules.disabled`, `autonomy.identitySelfUpdate`, `security.foreignMemoryPaths`, `security.cliSandbox`, `model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`, `memory.capture.enabled`, `memory.l0.enabled`.

### Zeitzone der Modelluhr {#time-zone-of-the-models-clock}

```yaml
i18n:
  timezone: "America/New_York"   # IANA-Name; nicht gesetzt = Zone des Servers
```

Jede Runde sagt dem Modell das aktuelle Datum und die Uhrzeit. `i18n.timezone` legt die Zone dafür fest: ein IANA-Name wie `America/New_York`, `Europe/Berlin` oder `UTC`. Nicht gesetzt (der Default) heißt: die Zone des Servers — die Umgebungsvariable `TZ`, sonst die Einstellung des Betriebssystems. Docker-Container laufen meist in UTC, sofern `TZ` nicht gesetzt ist.

Datum und Uhrzeit stammen immer aus derselben Zone, und die Zeitzeile nennt die Zone samt UTC-Versatz, etwa `Current time: 23:30 (America/New_York, UTC-04:00)`. Frühere Versionen gaben die Uhrzeit in einer festen mitteleuropäischen Zone an, das Datum aber in UTC — kurz vor Mitternacht konnten die beiden auseinanderlaufen, und jede Installation außerhalb dieser Zone bekam eine falsche Ortszeit.

Ein ungültiger Wert stoppt den Start mit einem Konfigurationsfehler: *i18n.timezone: Unknown time zone — use an IANA name such as Europe/Berlin or UTC*. Setz den Wert in `local.yaml`; er wirkt nach einem Neustart.

### Datenverzeichnis und Vault {#data-directory-and-vault}

Das Datenverzeichnis enthält Datenbank, Speicher-Vault, Agentendateien, Backups und den übrigen Zustand der Instanz. Default ist `<EYAS-Home>/data`, sonst der Ordner, den `EYAS_DATA_DIR` nennt.

Der Speicher-Vault liegt immer in `<Datenverzeichnis>/vault` und hat keine eigene Pfadeinstellung: Um ihn zu verschieben, verschiebst du das Datenverzeichnis mit `EYAS_DATA_DIR`. (Der alte Key `memory.vault.path` in `config/personality/memory.yaml` hat nie etwas bewirkt und ist entfernt.)

Installationen ohne `EYAS_DATA_DIR` — auch das ausgelieferte Docker-Image und das Helm-Chart, die den Default `/app/data` mounten — behalten den Vault genau dort, wo er war. Frühere Versionen ließen den Vault in `<EYAS-Home>/data/vault`, selbst wenn `EYAS_DATA_DIR` woandershin zeigte. Auf einer Installation mit `EYAS_DATA_DIR` kopiert der erste Start nach dem Upgrade den alten Vault einmal — aber nur, solange der Vault im Datenverzeichnis keine `.md`-Notiz enthält und das alte `<EYAS-Home>/data/vault` Notizen enthält:

- Er **kopiert, verschiebt nie**: Der alte Ordner bleibt unangetastet, Dateiinhalte und Änderungszeiten bleiben erhalten, und nichts, was schon im neuen Vault liegt, wird überschrieben. Eine Log-Warnung meldet die Kopie und dass der alte Ordner gelöscht werden kann, sobald du die Kopie geprüft hast.
- Schlägt die Kopie fehl (etwa weil das Datenverzeichnis nicht beschreibbar ist), bleibt der neue Vault leer, ein Fehler mit Abhilfe wird geloggt, und beim nächsten Start wird die Kopie erneut versucht.
- Enthalten beide Ordner schon Notizen, wird nichts kopiert oder zusammengeführt. EYAS nutzt nur `<Datenverzeichnis>/vault` und loggt bei jedem Start eine Warnung, bis der alte Ordner entfernt ist; kopiere jede Notiz, die du noch brauchst, von Hand in den Vault.

`eyas doctor` zeigt den Vault-Pfad in seiner Zeile **Vault** und warnt vor einem alten Vault neben einem verschobenen Datenverzeichnis — siehe [CLI](/docs/de/deploy/cli/#what-doctor-checks). Die eingebaute [Sicherung](/docs/de/admin/backup/) archiviert `<EYAS-Home>/data`; zeigt `EYAS_DATA_DIR` woandershin, nimm diesen Ordner in deine eigenen Backups auf.

### Gesprächs-Workspaces {#conversation-workspaces}

Ein Gespräch ohne eigene Ordner arbeitet in seinem eigenen **EYAS-Workspace** (siehe [Gespräche — Ordner](/docs/de/daily/conversations/#working-folders)). Workspaces liegen nie in einem Git-Checkout, denn ein CLI-Modell (Claude Code, Grok, Kimi), das in einem Git-Repository startet, behandelt dieses Repository als sein Projekt: Es lädt dessen Anweisungsdateien, Git-Status, Berechtigungsregeln und projektbezogenen Speicher. Der Workspace-Ort ist, in dieser Reihenfolge:

1. `EYAS_WORKSPACES_DIR`, falls gesetzt. Nimm einen absoluten Pfad.
2. Sonst `<Datenverzeichnis>/workspaces`, wenn das Datenverzeichnis nicht in einem Git-Checkout liegt (Docker- und Kubernetes-Images, paketierte Installationen — dort unverändert).
3. Sonst (eine Source-Installation, die aus einem Git-Clone läuft) ein Ordner pro Instanz im Anwendungsdaten-Verzeichnis deines Benutzers:
   - macOS: `~/Library/Application Support/eyas/<Instanz>/workspaces`
   - Linux: `$XDG_DATA_HOME/eyas/<Instanz>/workspaces`, Default `~/.local/share/eyas/<Instanz>/workspaces`
   - Windows: `%LOCALAPPDATA%\eyas\<Instanz>\workspaces`

`<Instanz>` ist der Name des EYAS-Home-Ordners plus ein kurzer Hash des Datenverzeichnisses; zwei Instanzen auf einer Maschine (etwa eine Dev- und eine Live-Instanz) teilen sich also nie Workspaces.

**Upgrade (automatisch, einmalig).** Hat sich der Ort geändert — ein Datenverzeichnis in einem Git-Checkout oder ein `EYAS_WORKSPACES_DIR`, das woandershin zeigt —, verschiebt der erste Start die automatisch angelegten Workspaces aus `<Datenverzeichnis>/workspaces` an den neuen Ort und stellt die Gespräche, die sie nutzten, darauf um. Ordner, die du selbst gewählt hast, werden nie verschoben oder geändert. Existiert am neuen Ort schon ein Ordner gleichen Namens, bleibt der alte, wo er ist, dieses Gespräch nutzt ihn weiter, und eine Warnung wird geloggt. Ein weiterer Neustart ändert nichts.

Liegt der Workspace-Ort außerhalb des Datenverzeichnisses, enthält die Datensicherung ihn nicht; Ausgabedateien von Agenten bleiben trotzdem erhalten, weil sie als Gesprächsanhänge in die Dokumente kopiert werden. Siehe [Sicherung](/docs/de/admin/backup/).

### Speicher außerhalb von EYAS {#memory-outside-eyas}

```yaml
security:
  foreignMemoryPaths: []   # weitere absolute Pfade, die Modelle weder lesen noch schreiben dürfen
  cliSandbox: auto         # auto | required
```

EYAS liest und schreibt Speicher nur über seine eigenen Stores. `security.foreignMemoryPaths` wird durchgesetzt: Es wird beim Start gelesen, und das Security-Gate verweigert dort jedem Modell Lesen und Schreiben. `security.cliSandbox` entscheidet, was passiert, wenn die Kernel-Datei-Sandbox für die eigenen Tools der CLIs nicht verfügbar ist.

| Key | Default | Bedeutung |
|-----|---------|-----------|
| `security.foreignMemoryPaths` | **`[]`** | Weitere Stores, die Modelle weder lesen noch schreiben dürfen, zusätzlich zur eingebauten Liste unten. Absolute Pfade; ein führendes `~` wird aufgelöst; ein leerer String wird abgelehnt. Ein eingetragener Ordner ist samt allem darunter geschützt. Einträge, die keine absoluten Pfade sind, werden mit einer Warnung im Log ignoriert. Beim Start gelesen — braucht einen Neustart. Dieselbe Liste sperrt auch MCP-Server, die dorthin zeigen, Gesprächs-Ordner darin und Import-Wurzeln darin, und sie ist Teil der Sperrliste der Kernel-Sandbox. **Sicherheitsereignisse → Speicher außerhalb von EYAS** listet deine Einträge und markiert fehlende und ignorierte. |
| `security.cliSandbox` | **`auto`** | Die Kernel-Datei-Sandbox (macOS Seatbelt, Linux bubblewrap) für die Shell von Claude Code und die eigenen Tools von Grok CLI. `auto`: genutzt, wo verfügbar; wo nicht, führt die CLI ihre Tools trotzdem aus, und der Chat zeigt pro Gespräch einmal einen Hinweis; ein Claude-Code-Befehl, der außerhalb der Sandbox laufen will, wartet immer auf die Freigabe eines Menschen. `required`: Eine CLI-Runde mit Tools wird abgelehnt, bevor die CLI startet, wenn keine Sandbox verfügbar ist (Kimi Code CLI hat keine, ihre Runden mit Tools werden also immer abgelehnt), und Claude Code kann nie einen Befehl außerhalb der Sandbox ausführen. Ein `off` gibt es nicht; jeder andere Wert ist ein Konfigurationsfehler, und EYAS startet nicht. Hintergrundaufrufe ohne Tools werden nie mangels Sandbox abgelehnt. Siehe [Anbieter — Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox). |

Was die Richtlinie ohne jede Einstellung schützt:

- den Home-Ordner-Zustand anderer Assistenten: `~/.claude` und `~/.claude.json` (Claude Code), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium` (Windsurf), `~/.agents` und `~/.config/agents` (geteilte Skills), `~/.copilot`;
- die Config-, Daten- und Zustandsordner von OpenCode (XDG-Orte und ihre Rückfälle `~/.config`, `~/.local/share` und `~/.local/state`);
- Obsidians eigene App-Einstellungen und jeden Obsidian-Vault, erkannt an seinem `.obsidian`-Ordner oder an Obsidians Vault-Liste (ein Vault, der angelegt wird, während EYAS läuft, wird binnen etwa 30 Sekunden erfasst);
- jeden Ordner namens `ai-memory` und jeden `memory`- oder `memories`-Ordner unter einem Tool-Punktordner (`.claude`, `.grok`, `.codex`, `.gemini`, `.kimi`, `.cursor`, `.codeium`, `.windsurf`), auch innerhalb eines Projekts;
- dieselben Punktordner in den Home-Ordnern anderer Benutzer.

Gewöhnliche Projektdateien bleiben nutzbar: `.claude/settings.json` und `.claude/agents` eines Projekts, `CLAUDE.md`, `docs/MEMORY.md`.

Auch EYAS' eigener Datenordner ist privat. Modelle dürfen nur die Gesprächs-Workspaces nutzen — jedes Gespräch nur seinen eigenen, auch wenn `EYAS_WORKSPACES_DIR` sie aus dem Datenordner hinausverlegt —, dazu Studio-Projekte (`data/studio`) und Browser-Downloads (`data/browser/downloads`). Vault, Datenbank, Schlüssel, Browser-Profil und die EYAS-eigenen CLI-Anmeldeordner (`data/cli-homes`) gehören nur EYAS; die Datenbankdatei ist auch dann geschützt, wenn `database.path` außerhalb des Datenordners liegt. Symlinks umgehen das nicht: Ein Pfad wird so beurteilt, wie er geschrieben ist, und dort, wohin er wirklich führt.

**Was durchgesetzt wird.** Jeder Pfad in jedem Tool-Aufruf, den das Security-Gate sieht, wird gegen diese Richtlinie geprüft — EYAS-Tools auf API-Anbietern, EYAS-Tools, die Grok und Kimi über die Tool-Bridge aufrufen, jeder Tool-Aufruf, für den Claude Code um Erlaubnis fragt, Claude Codes eigene Werkzeuge (über eine Prüfung vor jedem von ihnen) und jede Berechtigungs- und Dateianfrage von Grok/Kimi. Ein geschützter Pfad wird sofort verweigert, beim Lesen wie beim Schreiben: kein KI-Judge, keine Freigabeanfrage, keine Berechtigung kann ihn öffnen, und die Ablehnung zählt nicht zur Sperre nach 3 Ablehnungen. Sie gilt auch bei ausgeschaltetem Security-Gate. Jede Ablehnung ist eine Zeile unter **Sicherheitsereignisse**. Siehe [Sicherheit & Datenschutz — Speicher außerhalb von EYAS](/docs/de/admin/security-privacy/#memory-outside-eyas).

Dieselbe Richtlinie verweigert auch, einen solchen Ordner als Gesprächs-Ordner oder Arbeitsverzeichnis eines Projekts zu speichern (siehe [Gespräche — Ordner](/docs/de/daily/conversations/#working-folders)), sperrt MCP-Server, die darauf zeigen (siehe [MCP](/docs/de/ai/mcp/#memory-store-servers-are-blocked)), und überspringt Import-Wurzeln darin (unten). EYAS' eigene Datei-Tools lehnen einen Symlink im Arbeitsordner ab, der nach außen zeigt — auch wenn sein Ziel noch nicht existiert.

**Die Kernel-Schicht.** Shell-Ziele, die der Befehlstext nicht zeigt, und CLI-Lesezugriffe, die EYAS nie fragen, deckt die Kernel-Datei-Sandbox ab, wo sie läuft (Shell von Claude Code, eigene Tools von Grok CLI). Unter Linux braucht sie bubblewrap (`bwrap`) — für Claude Code zusätzlich `socat` — und unprivilegierte User-Namespaces; das EYAS-Image enthält sie nicht (bubblewrap steht unter LGPL; die Installation ist Sache des Betreibers). `eyas doctor` zeigt den Status in seiner Zeile **CLI sandbox**. Kimi Code CLI hat keine Kernel-Sandbox; ihre eigenen Tools read, grep und glob sind also weiterhin nur dort abgedeckt, wo EYAS sie sieht.

### CLI-Anbieter: Homes und Umgebung {#cli-providers-homes-and-environment}

EYAS startet die KI-Kommandozeilenwerkzeuge mit einer kurzen Umgebung nach Allowlist, nie mit der vollen Umgebung des Servers:

| CLI | Home | Was sie bekommt |
|-----|------|-----------------|
| Claude Code | Das `HOME` des Hosts (geteilt wird nur die Anmeldung) | `PATH`, Locale und Zeitzone, Proxys und CA-Bundles, `HOME`, die Anmeldevariablen für Anthropic / Claude OAuth / Bedrock / Vertex, plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` und `DISABLE_AUTOUPDATER=1` |
| Grok CLI | `<Datenverzeichnis>/cli-homes/grok-cli` | `PATH`, Locale und Zeitzone, `TMPDIR`, `TERM`, `USER`, `LOGNAME`, `SHELL`, Proxy- und CA-Bundle-Variablen sowie EYAS' Isolationsschalter |
| Kimi Code CLI | `<Datenverzeichnis>/cli-homes/kimi-cli` | Wie Grok |
| OpenCode | `<Datenverzeichnis>/cli-homes/opencode` | Siehe [OpenCode](/docs/de/automation/opencode/) |

Nicht weitergegeben: API-Schlüssel anderer Anbieter, EYAS-Geheimnisse, ein `XAI_API_KEY`, `CLAUDE_CONFIG_DIR` und jede andere `CLAUDE_CODE_*`-, `GROK_*`-, `KIMI_*`- oder `XDG_*`-Einstellung des Servers. Die EYAS-eigenen Homes unter `data/cli-homes` enthalten die Grok- und Kimi-Anmeldungen für EYAS und sind vor jedem Modell geschützt. Claude Code und Grok aktualisieren sich nicht selbst, solange EYAS sie ausführt; aktualisiere die CLIs selbst. Für all das gibt es keine Einstellungen. Siehe [Anbieter](/docs/de/ai/providers/#claude-code-isolation).

### Zeitlimits für CLI-Runden {#cli-turn-timeouts}

```yaml
model:
  cli:
    idleTimeoutMs: 600000     # 10 min Stille, während kein Tool läuft
    toolTimeoutMs: 1200000    # 20 min Stille, während ein Tool läuft
```

Runden von Claude Code, Grok CLI und Kimi Code CLI werden nicht nach einer festen Zeit gestoppt. Eine CLI-Runde wird nur gestoppt, wenn die CLI still wird: `idleTimeoutMs` ohne Nachricht, während kein Tool läuft, oder `toolTimeoutMs` ohne Nachricht, während ein Tool läuft. Jede Nachricht der CLI — gestreamter Text, ein Tool, das startet oder endet, eine Berechtigungsanfrage — startet die Uhr neu, und für die Länge der ganzen Runde gibt es keine Grenze; **Stopp** beendet eine Runde weiterhin jederzeit, und die Bereinigung hängender Läufe gilt weiter. Eine wegen Stille gestoppte Runde meldet ein Timeout, das als wiederholbar gilt: Das Gateway darf sie einmal wiederholen oder auf einen anderen Anbieter ausweichen, aber nur, solange noch nichts gestreamt wurde, und ein Hintergrundlauf kann vom Auto-Retry-Planer wiederholt werden.

Beide Werte sind in Millisekunden und müssen positive ganze Zahlen sein; null, negative, gebrochene oder Text-Werte werden beim Laden der Konfiguration abgelehnt. Sie werden zu Beginn jeder CLI-Runde aus der laufenden Konfiguration gelesen; ein geänderter Wert gilt also nach einem Neustart von EYAS. Halte `toolTimeoutMs` über 15 Minuten, damit mit `run_specialist` gestartete Spezialisten nicht abgeschnitten werden.

### Dauerhaftes Speicher-Capture {#durable-memory-capture}

```yaml
memory:
  capture:
    enabled: true          # false = keine Vault-Notizen nach der Runde
    minUserChars: 40
    maxPerConversation: 20
    maxInputChars: 4000
```

| Key | Default | Bedeutung |
|-----|---------|-----------|
| `memory.capture.enabled` | **`true`** | Nach einem qualifizierenden Lauf entscheidet ein kleiner Modellaufruf auf EYAS' Hintergrundmodell, ob darin ein bleibender Fakt steckt, und schreibt bis zu zwei Vault-Notizen — nie im kritischen Pfad der Antwort. Das geschieht auf jedem Weg, auf dem EYAS ein Modell ausführt: Chat-Runden, Hintergrund-Kartenläufe, Spezialisten- und delegierte Läufe (Pipeline-Stufen eingeschlossen), A2A-Aufgaben, Teammitglieder und Kanal-Antworten. `false` stoppt es auf allen; die Rohaufzeichnung unten ist ein eigener Schalter. |
| `memory.capture.minUserChars` | **`40`** | Eine kürzere Nachricht (in Zeichen) löst nie einen Modellaufruf aus. Bei einer Kanalnachricht oder einer A2A-Aufgabe zählen nur die eigenen Worte des Absenders, ein kurzes „ok“ über einen Kanal löst also keinen Aufruf aus. |
| `memory.capture.maxPerConversation` | **`20`** | Obergrenze für Capture-Modellaufrufe je Gespräch. Ein Spezialist oder Teammitglied läuft in einem eigenen Untergespräch und hat damit seine eigene Obergrenze; ein Kanal-Gespräch teilt sich eine Obergrenze über alle seine Nachrichten. |
| `memory.capture.maxInputChars` | **`4000`** | Deine Nachricht und die Antwort werden je auf so viele Zeichen gekürzt, bevor das Capture-Modell sie sieht. |

Der Aufruf läuft auf einem API-Anbieter oder einer CLI, die isoliert laufen kann, nie auf einer, die das nicht kann; ohne geeignetes Modell hält Capture ein Überspringen fest und ruft nichts auf. Ein Lauf, der nichts geantwortet hat, schreibt keine Capture-Zeile. **Kosten:** Jeder Spezialist, jedes Teammitglied und jede Kanal-Antwort, deren Anweisung mindestens `minUserChars` lang ist, kann jetzt einen zusätzlichen Modellaufruf im Hintergrund kosten. Wer die Nachricht geschrieben hat, entscheidet, wie sie gelesen wird: Eine delegierte Aufgabe, ein Team-Briefing oder das Ziel einer Karte ist eine Aufgabenanweisung, die ein Agent geschrieben haben kann, und eine Kanalnachricht oder eine A2A-Aufgabe sind die Worte eines Dritten — die nie eine Notiz darüber anlegen, wer du bist oder wie gearbeitet werden soll, und deren Notizen mit Peer-Vertrauen gespeichert werden. Das Ledger `memory_capture_runs` bekommt eine Spalte `entry_path` (`interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team`, `channel`; leer bei Zeilen, die vor dieser Version geschrieben wurden), die automatisch angelegt wird. Neue Einstellungen gibt es nicht. Siehe [Speicher — Capture ist standardmäßig an](/docs/de/knowledge/memory/#capture-is-on-by-default) und [FAQ](/docs/de/reference/faq/).

### Roh-Capture {#raw-capture}

```yaml
memory:
  engine: legacy           # steuert nur die deterministische Extraktion; der Abruf ist in beiden Fällen derselbe
  l0:
    enabled: true          # false = gar keine Rohkopien
    captureToolResults: false
    captureThinking: false
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
| `memory.engine` | **`legacy`** | `legacy` oder `v2`. Es entscheidet nur, ob die deterministische Fakten-Extraktion läuft: `v2` extrahiert immer; `legacy` extrahiert, solange `memory.l0.extractInLegacy` an ist (der Default). Der Abruf ist immer der geschichtete Abruf, egal welcher Wert gesetzt ist. |
| `memory.l0.chunkTokens` | **`8000`** | Größen-Trigger für den Flush: Der Puffer eines Gesprächs wird geschrieben, sobald seine geschätzte Token-Zahl diesen Wert erreicht. |
| `memory.l0.idleFlushMinutes` | **`30`** | Zeit-Trigger für den Flush: Ein minütlicher Durchlauf schreibt jeden Puffer raus, der so lange untätig war. Auch das Schließen des Gesprächs und das Stoppen von EYAS lösen einen Flush aus, ein sauberer Neustart verliert also nichts. |
| `memory.l0.captureToolResults` | **`false`** | Auch die Ausgabe jedes Tools aufzeichnen, das ein Agentenlauf aufruft, egal welches Modell: EYAS' eigene Tools, EYAS-Tools, die eine CLI über die Bridge aufruft, die eingebauten Tools von Claude Code, Grok und Kimi, die Tools, die OpenCode in einer `opencode_run`-Aufgabe ausführt, und die Ausgabe des OpenCode-Terminal-Panels. Nur Aufrufe, die gelaufen sind, werden aufgezeichnet (fehlgeschlagene als Fehler markiert); abgelehnte, übersprungene und auf Freigabe wartende Aufrufe, leere Ergebnisse und Wiederholungen nicht, ebenso wenig Tool-Aufrufe außerhalb eines Agentenlaufs. **Lies den nächsten Absatz, bevor du das einschaltest.** |
| `memory.l0.captureThinking` | **`false`** | Das Reasoning („Thinking“) jedes Modells, das es meldet, behalten — ein Eintrag pro Modellaufruf. Nur zur Prüfung: wird nie zu Fakten, nie abgerufen. Wörtlich und ungeschwärzt gespeichert; solange es an ist, gibt jeder Start eine Warnung aus. |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Byte-Deckel für den Datensatz dessen, was ein aufgezeichneter Tool-Aufruf zurückgegeben hat — Tool-Name, Ausgabe, Fehler-Flag, Ergebnis und wer ihn ausgeführt hat —, an einer UTF-8-Grenze abgeschnitten und sichtbar als gekürzt markiert. Die Argumente des Aufrufs zählen nicht mit: Sie liegen neben dem Datensatz, gekürzt auf ihre ersten 2.048 Zeichen. Nur Tool-Ergebnisse; Nachrichten sind nicht gedeckelt. |

`captureToolResults` und `captureThinking` werden zu Beginn jedes Laufs aus der laufenden Konfiguration gelesen; wie beim Rest von `local.yaml` gilt eine Änderung nach einem Neustart von EYAS.

**`captureToolResults` ist aus gutem Grund aus.** Ein aufgezeichnetes Tool-Ergebnis ist die gesamte Ausgabe, wörtlich und ungeschwärzt, plus die ersten 2.048 Zeichen der Aufruf-Argumente: `run_command`-stdout, `read_file`-Inhalte und ein gültiger Einmalcode aus `browser_totp` landen alle als Klartext in der Rohschicht. Nichts schwärzt sie, nichts verschlüsselt sie im Ruhezustand — Kompression ist keine Vertraulichkeit. Bei eingeschaltetem Flag protokolliert jeder Start eine Warnung dazu. Schalte es nur dort ein, wo das für diese Maschine vertretbar ist. Ein aufgezeichneter Aufruf wird nie abgerufen oder in einen Prompt zitiert — weder in den Speicher, der einer Runde beigefügt wird, noch über `memory_search`, `memory_expand`, die Suche auf der Speicher-Seite oder die Zusammenfassung eines Gesprächs. Nur seine Ausgabe prägt die Themen und Namen, die EYAS aus dem Gespräch gewinnt; die Argumente liegen als Herkunftsangabe neben dem Datensatz und werden nie indexiert oder ausgewertet (siehe [Speicher — Tool-Ergebnisse werden nicht aufgezeichnet](/docs/de/knowledge/memory/#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).

**Keine Seite zeigt diese Zeilen.** Für die Rohaufzeichnung gibt es keine Seite in der UI, keinen API-Endpunkt und keinen `eyas memory`-Befehl. Der Assistent erreicht sie nur über den Abruf — die daraus abgeleiteten Zusammenfassungen und Fakten sowie Rohzeilen, die mit `memory_expand` geöffnet werden. Die Karte **Abruf-Engine** unter **Speicher → Übersicht** zeigt, ob Rohaufzeichnung, Werkzeugausgaben- und Denkprozess-Aufzeichnung tatsächlich an sind.

**Das Roh-Capture wächst, und nichts räumt es auf.** In dieser Version gibt es keine Aufbewahrungseinstellung und keinen Cleanup-Job; eine aufgezeichnete Nachricht kostet inklusive Indizes rund 5 KB auf der Platte. Wenn du das noch nicht zahlen willst: `memory.l0.enabled: false`. Siehe [Speicher](/docs/de/knowledge/memory/).

### Speicherindex und Recall {#memory-index-and-recall}

| Key | Default | Bedeutung |
|-----|---------|-----------|
| `memory.index.budgetChars` | **`2400`** | Zeichen des gesamten Abrufblocks pro Zug (≈ 600 Tokens), Rahmen eingeschlossen: Dauernotizen, für die Nachricht abgerufene Notizen und Volltext-Treffer zusammen. Die Größe ist für ein Modell mit 100k-Token-Kontextfenster gedacht und skaliert mit dem Fenster des antwortenden Modells (bis zum 2,5-Fachen ab 250k Tokens, weniger unter etwa 29k Tokens) — auch bei einer OpenCode-Aufgabe (`opencode_run`), bemessen für das Fenster, das OpenCode für das gewählte Modell listet, oder genau dieser Wert, wenn dieses Fenster unbekannt ist. Dauernotizen lassen dem Abgerufenen bis zur Hälfte des Blocks. Notizen, die nicht hineinpassen, fasst eine Schlusszeile zusammen (*… N more notes not shown*); sie bleiben über die Speichersuche erreichbar. Anheben, wenn deine `user`- und `feedback`-Notizen nicht mehr hineinpassen. Braucht einen Neustart. |
| `memory.recall.includeSecrets` | **`false`** | Ob Notizen, episodische Zeilen und Skills mit dem Tag `contains-secrets` (Dateien, in denen der Importer Zugangsdaten fand und die wörtlich gespeichert wurden) — und die daraus abgeleiteten Rohzeilen, Fakten und Zusammenfassungen — das Modell über den Abruf, `memory_search` und `memory_expand` erreichen und Suchvektoren bekommen. Aus sind sie gespeichert und auf der Speicher-Seite sichtbar, erreichen aber nie einen Prompt. Braucht einen Neustart. |

Der Abruf — was er enthält, wie seine Suchanfrage gebaut wird und wie er jedes Modell erreicht — ist unter [Speicher — Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model) beschrieben. Die Karte **Abruf-Engine** unter **Speicher → Übersicht** zeigt das Budget und den Schalter `includeSecrets`, mit denen EYAS läuft (siehe [Speicher — Abruf-Engine](/docs/de/knowledge/memory/#recall-engine)).

**Entfernt: `memory.relatedWork.*`.** Der eigene Block *Related prior work* (`enabled`, `minQueryChars`, `maxHits`, `budgetChars`, `maxSnippetChars`) ist weg; frühere Arbeit kommt jetzt im Abrufblock an, bemessen von `memory.index.budgetChars`. Eine bestehende `local.yaml`, die diese Keys noch setzt, lädt weiterhin; sie werden ignoriert.

**Upgrade-Hinweis.** Frühere Versionen lieferten `memory.index.budgetChars: 8000` in `config/default.yaml` aus; der ausgelieferte Wert ist jetzt `2400`, passend zum eingebauten Default. Um die alte Größe zu behalten, trag das in `config/local.yaml` ein und starte neu:

```yaml
memory:
  index:
    budgetChars: 8000
```

### Datenbank-Dauerhaftigkeit {#database-durability}

Seit 0.8.23-beta führt jede EYAS-Datenbankverbindung `PRAGMA synchronous = NORMAL` aus statt SQLites Default `FULL`. Zusammen mit WAL, das EYAS schon immer nutzt, heißt das:

- Ein **Prozess**-Absturz — EYAS gekillt, ein unbehandelter Fehler — verliert nichts, was schon committet ist.
- Ein **OS**-Absturz oder Stromausfall genau im Moment eines Commits kann die letzte Transaktion verlieren.

Das ist der übliche WAL-Kompromiss, und er gilt für **alle** Module, nicht nur den Speicher. Wenn auf deiner Instanz Arbeit liegt, die du nicht noch einmal eingeben kannst, ist [Sicherung](/docs/de/admin/backup/) die Antwort auf Dauerhaftigkeit, nicht der Commit-Modus.

### Zusätzliche Skill- und Persona-Wurzeln {#extra-skill-and-persona-roots}

```yaml
skills:
  importRoots: []          # zusätzliche Markdown-Skill-Ordner; leer = keine
agent:
  importRoots: []          # zusätzliche Persona-Markdown-Ordner; leer = keine
```

Shipped Default ist die leere Liste. Pfade in `local.yaml`, nie im Produktcode. Diese Wurzeln werden bei **jedem Start** gelesen, sind also eine Live-Quelle — nur für gewöhnliche Ordner (etwa einen Team-Ordner wie `/opt/team-skills`). Importierte Skills gewinnen gegen gebündelte Kopien derselben Id. Siehe [Skills](/docs/de/automation/skills/#import-roots).

**Wurzeln, die EYAS überspringt.** Eine Wurzel, die in den eigenen Ordnern eines anderen Assistenten oder einer Notiz-App liegt oder sie enthält, wird nicht gescannt:

- die Home-Ordner anderer Werkzeuge: `~/.claude` (also auch `~/.claude/skills`, `~/.claude/agents` und `~/.claude/plugins/…`), `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot` sowie die geteilten Skill-Ordner `~/.agents` und `~/.config/agents`;
- die Config-, Daten- und Zustandsordner von OpenCode;
- Obsidians App-Einstellungen und jeder Obsidian-Vault;
- Ordner aus `security.foreignMemoryPaths`;
- EYAS' eigene CLI-Homes (`data/cli-homes`).

Auch eine Wurzel wie dein ganzer Home-Ordner wird übersprungen, weil sie diese Ordner enthält. Für jede übersprungene Wurzel loggt der Server beim Start eine Warnung, etwa *skills.importRoots: /Users/me/.claude/skills is inside Claude Code (~/.claude) — not scanned; import these files once with Settings → System → Data portability → Import data*, und `eyas doctor` zeigt eine **Import roots**-Warnung mit Einstellung und Ordner.

**Was tun.** Bereits aus einem solchen Ordner importierte Skills und Agenten bleiben in EYAS; sie werden nur nicht mehr daraus aktualisiert. Um diesen Inhalt hereinzuholen oder aufzufrischen, führe einmal einen [Datenimport](/docs/de/admin/data-port/) des Ordners aus — er wird mit festgehaltener Herkunft in EYAS kopiert — und entferne dann den Eintrag aus `local.yaml`.

**In EYAS bearbeitete Personas werden nie** von ihrer `agent.importRoots`-Datei **überschrieben.** Eine Datei legt ihren Agenten beim ersten Start an und aktualisiert ihn später nur, solange Name, Rolle, Beschreibung, System-Prompt und Tools des Agenten genau so sind, wie der letzte Import sie hinterlassen hat; siehe [Agenten — Konfigurieren](/docs/de/agents/configure/#imported-personas).

## Agent-Verify und Umgebungsvariablen {#agent-verify-and-environment-variables}

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  # Deterministische Prüfungen nach einem Hintergrundlauf (leer = aus)
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /absolute/path/to/repo   # Default: process.cwd()
```

| Key | Bedeutung |
|-----|-----------|
| `agent.verifyCommands` | Liste von `{ name, command, args?, timeoutMs? }` — **keine Shell**; ein Fehlschlag öffnet den Agenten erneut mit der Fehlerzusammenfassung |
| `agent.verifyCwd` | Arbeitsverzeichnis für diese Befehle |
| `EYAS_ODOO_SOURCE_PATHS` | Durch Doppelpunkt oder Semikolon getrennte lokale Odoo-Checkout-Wurzeln für die leichtgewichtigen `odoo_search_*`-Tools und den optionalen Quellen-Bootstrap |
| `EYAS_ODOO_SOURCES_JSON` | Bevorzugter Mehrversions-Bootstrap: JSON-Array aus `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` — legt beim Start untätige **Suchquellen** an, wenn diese Pfade noch nicht registriert sind |
| `EYAS_AUTO_FAILOVER` | Füllt leere Fallbacks der Routing-Stufen mit einem zweiten aktiven Anbieter (Opt-in) |
| `EYAS_BROWSER_USER_DATA_DIR` | EYAS-eigenes Chromium-Profil für headless `browser_*` (Default `data/browser/profile`). Tägliche Chrome-/Edge-Profile werden abgelehnt |
| `EYAS_AGENT_BROWSER_BIN` | Optionaler Pfad zur Vercel-agent-browser-CLI. Leer = PATH. Gesetzt, aber fehlend = fail-closed (kein PATH-Rückfall). Profil: `data/browser/agent-browser/profile` |
| `EYAS_DATA_DIR` | Datenverzeichnis (Datenbank, Vault, Agentendateien, …). Default `<EYAS-Home>/data`. Siehe [Datenverzeichnis und Vault](#data-directory-and-vault) |
| `EYAS_WORKSPACES_DIR` | Absoluter Pfad für Gesprächs-Workspaces. Default: siehe [Gesprächs-Workspaces](#conversation-workspaces) |
| `EYAS_CLAUDE_CODE_BIN` | Absoluter Pfad zum `claude`-Binary, das EYAS ausführt. Leer = `claude` im PATH, dann die SDK-gebündelte Kopie (doctor warnt). Gesetzt, aber ungültig = fail-closed (kein Rückfall). Siehe [Anbieter — Claude-Code-Laufzeit](/docs/de/ai/providers/#claude-code-runtime) |
| `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` | Absoluter Pfad zum `grok`- / `kimi`-Binary, das EYAS ausführt. Leer = das Binary im PATH. Gesetzt, aber ungültig = fail-closed: Der Anbieter wird nicht registriert. Siehe [Anbieter — Grok CLI und Kimi Code CLI](/docs/de/ai/providers/#grok-cli-and-kimi-code-cli) |
| `LM_STUDIO_URL` | LM-Studio-Server (Default `http://localhost:1234`; ein abschließender Schrägstrich ist in Ordnung) |
| `EYAS_OPENCODE_PLUGIN_TOKEN` | Entfallen: EYAS liest und setzt es nicht. Jeder OpenCode-Prozess, den EYAS startet (der Hintergrundserver und jedes OpenCode-Terminal), bekommt seinen eigenen Schlüssel auf Dateideskriptor 3, nie in einer Umgebung, und jeder Speicheraufruf trägt einen einmaligen Nachweis pro Session; der Schlüssel wird beim Beenden oder Neustart dieses Prozesses widerrufen. OpenCodes Umgebung trägt nur `EYAS_OPENCODE_KEY_FD=3`, das EYAS selbst setzt. Siehe [OpenCode](/docs/de/automation/opencode/#eyas-memory-inside-opencode) |

### Mehrversions-Odoo-Beispiel {#multi-version-odoo-example}

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

Öffne dann **Suchquellen**, führe für jede Quelle **Neu indexieren** aus und setze bei jedem [Projekt](/docs/de/daily/projects/) die **Standard-Codequellen**. Gespräche heften Quellen im Tab **Quellen** an — siehe [Suche](/docs/de/daily/search/#multi-version-pin).

Tool-Policy-Hooks laufen bei jedem Tool-Aufruf (PreToolUse / PostToolUse) über den ToolExecutor — siehe [Tools](/docs/de/automation/tools/).

## Verwandt {#related}

- [CLI](/docs/de/deploy/cli/)
- [Anbieter](/docs/de/ai/providers/)
- [Routing & Budget](/docs/de/ai/routing-budget/)
- [Speicher](/docs/de/knowledge/memory/)
