---
title: CLI-Referenz
description: eyas serve/start/stop/doctor/config/module — denselben Install-Pfad bedienen, egal welchen du gewählt hast.
---

**Wozu das da ist.** Mit dem Binary `eyas` startest, stoppst und diagnostizierst du eine native oder Container-Installation und schaltest Module. Es ist kein zweites Produkt — derselbe Prozess, dasselbe `EYAS_HOME`. Sobald `bin/` im `PATH` liegt (nativer Installer) oder du im Image bist (`docker compose exec`), gelten diese Befehle.

## Wann du es brauchst

- Im Vordergrund starten (`serve`), um die Logs zu sehen, oder im Hintergrund (`start` + Pidfile).
- `doctor` vor einem Bugreport: fehlende CLI, welches Claude-Code-Binary läuft und ob es angemeldet ist, ob jede installierte KI-CLI eine Version ist, die EYAS' Isolationsprüfung bereits nachgewiesen hat, ob ihr EYAS-Home intakt ist, ob die Kernel-Datei-Sandbox der CLIs verfügbar ist, wo der Vault liegt, welchen Speicher-Embedder der Abruf nutzt, übersprungene Import-Wurzeln, belegter Port, docs/web dist.
- Ein Modul schalten, ohne YAML von Hand zu bearbeiten.
- Auf GitHub nach einer neueren Version suchen (`eyas update`-Familie, derselbe Dienst wie Einstellungen → Updates).

## Typischer Ablauf

1. Installation [nativ](/docs/de/deploy/native/) oder mit [Docker](/docs/de/deploy/docker/).
2. `eyas doctor` — behebe, was er meldet.
3. `eyas serve` (Vordergrund) oder `eyas start` (Hintergrund). Zur Bestätigung `eyas status`.
4. Nach dem Bearbeiten von YAML `eyas config validate`, dann `eyas restart`: `default.yaml` und `local.yaml` werden einmal beim Start gelesen.
5. Nach Bedarf `eyas stop` / `eyas restart`.

## Funktionen

| Befehl | Beschreibung |
|--------|--------------|
| `eyas serve` | HTTP-Server im Vordergrund |
| `eyas start` | Im Hintergrund (Pidfile + Log) |
| `eyas stop` | Hintergrundprozess stoppen |
| `eyas restart` | Neu starten |
| `eyas status` | Health + PID |
| `eyas doctor` | Diagnose |
| `eyas version` | Version |
| `eyas config validate` | YAML prüfen |
| `eyas config reload` | Lädt `default.yaml` / `local.yaml` **nicht** neu — stattdessen neu starten |
| `eyas module list` | Module auflisten |
| `eyas module enable/disable <id>` | Modul schalten |
| `eyas update check` | Auf GitHub (`eyssen/eyas`) nach einer neueren Version suchen; zum Anwenden muss das Backup bereit sein |
| `eyas migrate …` | Einmalige v1→v2-Migration von Prompts/Workspace (`run` / `rollback` / `drop-cols`) — kein Tagesbetrieb |

<h3 id="what-doctor-checks">Was <code>doctor</code> prüft</h3>

Jede Zeile ist *ok* (✓), eine *Warnung* (⚠) oder ein *Fehler* (✗). doctor endet mit der Zahl der Probleme oder Warnungen und beendet sich mit Status 1, wenn eine Zeile fehlgeschlagen ist; reine Warnungen ändern den Exit-Status nicht. Er liest nur: Er repariert, kopiert und erstellt nichts und startet die installierten CLIs nur, um ihre Version zu lesen (`--version`) und bei Claude Code, ob es angemeldet ist (`claude auth status`).

Eine Auswahl seiner Zeilen:

| Zeile | Bedeutung |
|-------|-----------|
| **Claude Code runtime** | Welches Claude-Code-Binary EYAS ausführt: die Quelle (`EYAS_CLAUDE_CODE_BIN` / `claude on PATH` / `SDK-bundled`), Pfad und Version, ob die Version von der abweicht, für die EYAS' SDK-Client gebaut wurde (*version skew*), und **signed in** ja/nein. Ein ungültiges `EYAS_CLAUDE_CODE_BIN` ist ein Fehler. Der SDK-gebündelte letzte Ausweg, eine Versionsabweichung und eine nicht angemeldete Laufzeit sind Warnungen. Ein `claude` im PATH, das der Override verdeckt, erscheint als Information (*not used by EYAS*). Siehe [Anbieter — Claude-Code-Laufzeit](/docs/de/ai/providers/#claude-code-runtime). |
| **CLI isolation (Claude Code)**, **CLI isolation (Grok CLI)**, **CLI isolation (Kimi Code CLI)** | Eine Zeile pro CLI-Anbieter. Sie zeigt das Binary, das EYAS ausführt — wie es gefunden wurde (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, `claude on PATH` / `grok on PATH` / `kimi on PATH` oder `SDK-bundled`), Pfad und Version — und ob EYAS' Isolationsprüfung vor dem Release diese Version nachgewiesen hat: ok *isolation proven on this version (&lt;Datum&gt;)*. Eine Warnung gibt es, wenn die Version von der zuletzt nachgewiesenen abweicht, wenn das Binary keine Version meldet und wenn die CLI noch auf keinem Host nachgewiesen wurde (derzeit Kimi Code CLI); die Warnung ergänzt, dass EYAS trotzdem jede Sitzung beim Start prüft. Eine nicht installierte CLI zeigt *not installed* (ok). Ein ungültiges `EYAS_*_BIN` ist ein Fehler, mit Abhilfe. Bei Grok CLI und Kimi Code CLI prüft die Zeile außerdem ihr EYAS-Home, `<Datenverzeichnis>/cli-homes/<Anbieter>` — siehe die nächste Tabelle. Die zuletzt nachgewiesenen Versionen und wie: [Sicherheit & Datenschutz — Wie die Isolation nachgewiesen wird](/docs/de/admin/security-privacy/#how-isolation-is-proven). |
| **CLI sandbox** | Der Modus `security.cliSandbox` und für jede installierte CLI (Claude Code, Grok CLI, Kimi Code CLI), ob ihre eigenen Werkzeuge in der Kernel-Datei-Sandbox laufen: *active*, *unavailable* mit Grund und Abhilfe (bubblewrap installieren; socat installieren — Claude Code braucht es neben bubblewrap; unprivilegierte User-Namespaces erlauben, auch im Container) oder *none* für Kimi, das keine Kernel-Sandbox hat. Eine fehlende Sandbox ist eine Warnung, kein Fehler: Mit `auto` läuft die CLI ohne sie, mit `required` werden ihre Züge mit Werkzeugen abgelehnt. Siehe [Anbieter — Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox). |
| **Vault** | Der Pfad des Speicher-Vaults, `<Datenverzeichnis>/vault` (ok). Warnt, wenn Notizen in einem alten `<EYAS-Home>/data/vault` beim nächsten Start kopiert werden, und — mit Abhilfe —, wenn dieser alte Ordner nicht mehr genutzt wird, weil der Vault im Datenverzeichnis schon Notizen enthält. doctor selbst kopiert nie etwas. Siehe [Konfiguration — Datenverzeichnis und Vault](/docs/de/deploy/configuration/#data-directory-and-vault). |
| **SQLite** | Ein Selbsttest auf einer flüchtigen In-Memory-Datenbank — deine Datendatei wird nie geöffnet. Meldet die SQLite-Version, ob **FTS5** vorhanden ist (ohne FTS5 ein Fehler: Speicher-, Gesprächs- und Vault-Suche brauchen es) und ob die Erweiterung `sqlite-vec` lädt — geprüft, indem tatsächlich eine Zeile eingefügt und eine Nearest-Neighbour-Abfrage ausgeführt wird, statt nur die Version abzufragen. Eine fehlende Erweiterung ist eine Warnung samt Abhilfe für deine Plattform, kein Fehler. |
| **Import roots** | Ob `skills.importRoots` / `agent.importRoots` nutzbar sind: ok, wenn nichts konfiguriert ist oder jede Wurzel ein gewöhnlicher Ordner ist; eine Warnung mit Einstellung und Ordner, wenn eine Wurzel in den eigenen Ordnern eines anderen Assistenten oder einer Notiz-App liegt oder sie enthält (`~/.claude`, `~/.grok`, ein Obsidian-Vault, …) und deshalb nicht gescannt wird. Siehe [Konfiguration — Zusätzliche Skill- und Persona-Wurzeln](/docs/de/deploy/configuration/#extra-skill-and-persona-roots). |
| **Memory embedder** | Welchen Embedder der Speicherabruf nutzt. Ok: *multilingual-e5-small, local (weights in &lt;Ordner&gt;)*, wenn `@huggingface/transformers` installiert ist und die Gewichte in `data/models` liegen. Warnung: der gehashte Stamm-Embedder (`stem5-fnv-384`), weil `@huggingface/transformers` nicht installiert ist — Abhilfe: `bun add @huggingface/transformers` (oder `bun install`) im EYAS-Ordner ausführen, dann neu starten. Warnung: Das Paket ist installiert, aber die Gewichte sind noch nicht heruntergeladen — der nächste Start lädt sie (etwa 130 MB) von Hugging Face nach `data/models`, bis dahin nutzt der Abruf den Fallback. Siehe [Speicher — Die Vektorsuche läuft immer lokal](/docs/de/knowledge/memory/#vector-search-always-runs-locally). |
| **zstd** | Welche Kompressions-Implementierung die Rohaufzeichnung nutzt: die native von Bun, die von Node (22.15 oder neuer) oder der mitgelieferte WASM-Fallback. Der Fallback ist eine Warnung — er funktioniert und ist etwa doppelt so langsam. Gar keine Implementierung ist ein Fehler; EYAS zeichnet dann nichts auf, statt einen Puffer zu füllen, den es nie schreiben kann. |

Die Prüfung des EYAS-Homes in den Zeilen **CLI isolation (Grok CLI)** und **CLI isolation (Kimi Code CLI)**:

| Was doctor in `<Datenverzeichnis>/cli-homes/<Anbieter>` findet | Ergebnis |
|----------------------------------------------------------------|----------|
| Noch nicht angelegt | ok — der erste Lauf legt es an |
| Ein symbolischer Link oder kein Ordner | Fehler — EYAS weigert sich, die CLI von dort zu starten. Abhilfe: entfernen; der nächste Lauf legt es neu an |
| Ein Ordner, den andere Benutzer lesen können | Warnung — er enthält die Anmeldung der CLI. Abhilfe: `chmod 700 <Ordner>` |
| Eine Datei, die EYAS dort verwaltet, fehlt oder wurde geändert, seit EYAS sie geschrieben hat (Grok: `config.toml`, `requirements.toml`, `trusted_folders.toml`; Kimi: `mcp.json` und EYAS' Einstellungen in `config.toml`) | Warnung — EYAS schreibt diese Dateien vor dem nächsten Lauf neu; eine Änderung zwischen zwei Läufen heißt also, dass etwas anderes diesen Ordner bearbeitet |
| Alles so, wie EYAS es geschrieben hat | ok — *EYAS home and managed files intact* |

<h3 id="environment">Umgebung</h3>

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_DATA_DIR`, `EYAS_WORKSPACES_DIR`, `EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`. Was die Pfad- und Laufzeitvariablen bewirken: [Konfiguration](/docs/de/deploy/configuration/).

Der Default-Port ist **3100**. Mit `EYAS_SKIP_DOCS_BUILD=1` liefert `/docs` 404 — siehe [FAQ](/docs/de/reference/faq/).

## Verwandt

- [Konfiguration](/docs/de/deploy/configuration/)
- [Native](/docs/de/deploy/native/)
- [Anbieter](/docs/de/ai/providers/)
- [Sicherheit & Datenschutz](/docs/de/admin/security-privacy/)
- [FAQ](/docs/de/reference/faq/)
- [Einstellungen — Updates](/docs/de/admin/settings/)
