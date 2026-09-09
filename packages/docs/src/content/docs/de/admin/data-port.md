---
title: Datenimport & -export
description: Import-Assistent für Speicher, Skills und Workspace-Regeln — scannen, wählen, freigeben.
---

**Wozu das da ist.** Data-Port ist der **Import-Assistent**. Er scannt einen Serverpfad oder ein Upload-Zip/Markdown aus einem anderen Assistenten (Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot, Obsidian, ein Chat-Export, ein früherer EYAS-Export oder ein einfacher Markdown-Ordner) und schlägt vor, wohin es gehört. Speicher kann angewandt werden; Workspace-Regeln und Identity sind **nur Vorschlag** bis zur Merge-Freigabe. Kein Full-DB-Dump — dafür [Sicherung](/docs/de/admin/backup/). Export ist **Demnächst**.

**Ort:** Einstellungen → **Datenportabilität**. Überschrift: *Speicher, Skills und Regeln aus früheren KI-Systemen importieren. Export folgt später.*

## Wann du es brauchst

- Dauerhafte Notizen aus `~/.claude` oder einem Obsidian-`ai-memory` in EYAS (die einzige Erinnerung, die spätere Runden lesen).
- Custom Skills aus Claude/Cursor → Kategorie **own**.
- Workspace-Regeln/Identity als Merge-Vorschläge, nie Auto-Overwrite.
- Ein Zip eines früheren Exports scannen, ohne Dateien von Hand auf den Server zu kopieren.

## Typischer Ablauf

1. **Einstellungen** → **Datenportabilität** → **Daten importieren…**
2. **Quellsystem**: **Automatisch erkennen**, Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf / Codeium, GitHub Copilot, Obsidian, Chat-Export, EYAS-Export, Markdown-Ordner. Die Ids der API sind `claude-code`, `grok-cli`, `cursor`, `codex`, `gemini-cli`, `windsurf`, `copilot`, `obsidian`, `chat-export`, `eyas-export` und `generic-md`.
3. **Serverpfad** (absolut auf dieser Maschine) **oder** **Datei wählen…** (Zip oder eine einzelne Markdown/JSON-Datei). Optionale **Anweisungen** steuern das Ranking.
4. **Scannen**. Ordnerbaum und Gruppen prüfen (Speicher, Gedächtnis-Index, Sitzungen, Skills, Regeln, Identity, Agenten-Personas, Wissen, Quellcode, Nicht importierbar) und wählen, was bleibt. Für einen vollständig deterministischen Import **Metadaten mit dem Modell anreichern** aus lassen.
5. **N Elemente importieren**. Speicher/Skills werden angewandt; Regeln/Identity warten als **Workspace-Änderungsvorschläge** — **Merge freigeben** oder **Ablehnen**.

## Funktionen

| Fähigkeit | Bedeutung |
|-----------|-----------|
| Import | Pfad auf dem Server und/oder Upload (Zip) |
| Ziele | Speicher (kind + Ebene), episodische Sitzungen, Skills samt gebündelten Dateien, Agenten-Personas, Workspace-Regeln, Projekttyp-Prompt |
| Merge | **Nur Vorschlag** für Regeln/Identity — erst nach ausdrücklicher Freigabe |
| Anreicherung | **Standardmäßig aus** — ein Opt-in-Schalter, nur Metadaten, nie der Text |
| Sprache | Importierter Speicher behält die Quellsprache |
| Skill-Kategorie | Importiert → **own** |
| Rücknahme | Einen ganzen Job zurücknehmen — braucht die Berechtigung **`delete`** auf Data Port |
| Export | **Demnächst** — ein `eyas-export-v1`-Bündel (Vault, Skills, Workspaces, `episodic.jsonl`). Ein Bündel kann Notizen mit Zugangsdaten enthalten, deshalb bekommt die Route vor dem Start denselben Nur-Owner-Aufrufertest, der den Speicher-Recall schützt; `create` auf Data Port allein wird nicht genügen |

## Was wohin landet

Der perfekte Ordner ist nicht nötig. **Alles unterhalb des Pfades wird kartiert.** Es gibt keine Keep-Liste und keine Obergrenze: Der Scan läuft durch jedes Verzeichnis unter der Wurzel, wie groß es auch ist. Ein Baum, zehnmal größer als ein übliches Home-Verzeichnis, wird vollständig gelistet und importiert — der Preis ist Zeit und Plattenplatz, nie eine Auslassung. Nur Verzeichnis*klassen*, die niemals Erinnerung enthalten können, werden nicht betreten: Abhängigkeitsordner (`node_modules`), Versionsverwaltung (`.git`, `.hg`, `.svn`), `.cache`, `__pycache__`, `.venv` / `venv`, Build-Ausgaben (`dist`, `build`, `out`, `.next`, `.turbo`, `target`), sofern ein Build-Manifest daneben liegt, Browser-Profilwurzeln (Chrome, Chromium, Firefox, Antigravity — an ihren Markerdateien erkannt, wo immer sie liegen), Cloud-Speicher-Wurzeln (`Library/CloudStorage` und `Library/Mobile Documents`, an dem von macOS vorgegebenen Ort erkannt, dazu ältere Sync-Ordner wie Dropbox an ihren eigenen Markerdateien — ein Ordner, der bloß OneDrive oder Dropbox *heißt*, ist ein gewöhnlicher Ordner und wird betreten), der Papierkorb (`.Trash`, `.Trashes`, `$RECYCLE.BIN`, `.local/share/Trash`) und `Library/Caches`. Jede davon bleibt **eine sichtbare Zeile** mit ihrer Dateizahl und der Begründung *Ordner nicht durchsucht: `<Klasse>`*, es verschwindet also nichts stillschweigend. Ein per Symlink erreichtes Verzeichnis wird einmal betreten — der reale Pfad entscheidet —, eine Schleife wird gemeldet statt erneut betreten. `.DS_Store` erscheint als Anwendungszustand.

| Quelle | EYAS-Schicht |
|--------|--------------|
| Notiz mit `type: user` / `feedback` / `project` / `reference` (Claude Code, Obsidian, Grok) | Vault-Notiz mit genau diesem **kind**; `feedback` unter `procedural/`, der Rest unter `semantic/`; die Datei behält ihren **Quelldateinamen**, damit `[[Wikilinks]]` weiter auflösen |
| `MEMORY.md`-Index | Eine Vault-Notiz mit dem Tag `index`; eine einzeilige Kurzzeile wird zur Zusammenfassung der Notiz, auf die sie zeigt, sofern diese Notiz keine eigene `description` deklariert |
| Sitzungszusammenfassungen, Sitzungsnotizen (`type: claude-session` / `grok-session`) und Transkripte — Claude Code `*.jsonl` inklusive Sub-Agenten-Transkripten, Cursor-Agententranskripte, Codex-Rollouts, ChatGPT-/Claude.ai-Exporte | Episodischer Speicher, eine Zeile je Sitzung — eine sehr lange Sitzung als geordnete Teile, nie abgeschnitten —, die Züge wörtlich. **Alles ist vorausgewählt**; wer es nicht will, hakt die Gruppe *Sitzungen* ab. Neben einer Sitzung abgelegte Werkzeugausgabe wird gelistet, aber nicht angehakt |
| Alte Speicherordner (`memory.local-backup-*`, `memory.old`, `*.bak`) | Vault-Notiz mit dem Tag `legacy`; ein bereits vergebener Name bekommt ein `-2`-Geschwister, statt wegzufallen |
| Deine eigenen Dokumente, irgendwo unter der Wurzel | Vault-Notiz; das kind kommt aus `type:`, wenn die Notiz eines deklariert, sonst `reference` |
| Produktdokumentation Dritter | Vault-Notiz mit dem Tag `third-party`, ausgewählt — wer sie nicht will, hakt die Gruppe ab |
| Regeldateien innerhalb von Repositories (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md`) | Vorschlag, wo immer im Baum sie liegen |
| Quellcodedateien | Gelistet und importierbar, aber **nicht** angehakt — sie sind weder Erinnerung noch Anweisung |
| Daten- und Konfigurationstext (`.yaml`, `.toml`, `.csv`, `.log`, die `settings.json` eines Assistenten …) | Gelistet und importierbar, aber **nicht** angehakt |
| `SKILL.md` mit `references/` und `scripts/` | Ein **own**-Skill: das ganze Paket wörtlich, die Dateien zusätzlich nach `data/skills/imported/<name>-<hash>/` kopiert. Der Skill-Text nennt dieses Verzeichnis mit **absolutem Pfad auf der Platte**, damit ein gebündeltes Skript direkt von dort laufen kann |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor-`.mdc`, Windsurf- und Copilot-Regeln | Vorschlag für die `AGENTS.md` des **primären Assistenten** — oder, wenn du *Projekttyp-Prompt* wählst, für den Projekttyp `general` — bei Freigabe angehängt, nie überschrieben |
| `.claude/agents/*.md`-Personas | Agenten-Definitionen (Werkzeugnamen auf EYAS-Werkzeuge abgebildet) |

**Nichts wird abgeschnitten oder stillschweigend übergangen.** Dateien werden beim Import ganz gelesen, und es gibt keine Größengrenze: Eine Textdatei über 4 MiB (50 MiB bei einem Chat-Export) wird vollständig importiert und trägt nur eine Größenmarkierung in ihrer Zeile. Texte werden **Byte für Byte** geschrieben, führende und abschließende Leerzeilen eingeschlossen; der eine abschließende Zeilenumbruch des Vault-Schreibers und ein verworfenes UTF-8-BOM sind die einzigen Änderungen. Jedes übernommene Element hält fest, welcher Adapter es tatsächlich gelesen hat (`source.adapter` sowie der Tag `source:<adapter>` — eine Grok-Zusammenfassung, die unter einem automatisch erkannten Claude-Code-Job gefunden wurde, ist mit `grok-cli` getaggt), jeden Pfad, unter dem der Inhalt gefunden wurde, und den sha256 seines Inhalts im Ledger — für Vault-Notizen, episodische Zeilen, Skills, gebündelte Skill-Dateien, Agenten und Vorschläge gleichermaßen. Ursprüngliches Frontmatter, Pfad, Hash und Änderungszeit reisen unter `source:` mit der Notiz. Jede Datei, die der Scan nicht importiert, ist eine sichtbare Zeile mit Begründung. Ein erneuter Import meldet für schon vorhandene Notizen **Unverändert** und überschreibt nie — eine andere Notiz gleichen Namens bekommt ein `-2`-Suffix und den Tag `conflict-with:`. Eine nicht freigegebene Regeldatei erneut zu importieren erzeugt keinen zweiten Vorschlag dafür.

**Ein deklariertes Projekt oder ein deklarierter Projekttyp, den es hier noch nicht gibt, geht nicht verloren.** Deklariert das Frontmatter einer importierten Notiz ein `project` (oder `projectType`), legt der Importer sie nur dann unter `projects/<id>/` (oder `project-types/<id>/`) ab, wenn dieses Projekt oder dieser Projekttyp in dieser EYAS-Instanz schon existiert; sonst landet sie ohne Scope und mit dem Tag `declared-project:<id>` (oder `declared-project-type:<id>`). Legst du das Projekt danach an und importierst erneut, landet sie unter der deklarierten ID — oder du verschiebst die Notiz selbst.

**Jeder Assistent.** Adapter erkennen die Quellen: Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot (nur dokumentiertes Layout), Obsidian, ChatGPT-/Claude.ai-/generische JSON-Exporte, eyas-export und einfaches Markdown (`generic-md`). Über mehrere Pfade erreichte Dateien (ein Vault, der nach `~/.grok/memory` verlinkt ist) werden zu einer Notiz.

**Modell-Anreicherung ist standardmäßig aus.** Der Review-Schritt trägt den Schalter **Metadaten mit dem Modell anreichern**. Bleibt er leer — der Normalfall —, ist der ganze Import deterministisch und kostet keinen einzigen Modellaufruf. Gesetzt, mit konfiguriertem Modell, bekommen Notizen *ohne* deklarierten Typ ein vorgeschlagenes kind, eine Zusammenfassung und Tags. Eine Obergrenze für Einträge gibt es nicht; der Preis ist Zeit. Der Text wird nie umgeschrieben, auf Geheiß des Modells fällt nichts weg, und ein mit `contains-secrets` getaggtes Element wird nie verschickt. Das Ergebnisfeld zeigt, wie viele Notizen angereichert wurden.

**Zurückrollen.** Jeder Job lässt sich im Ergebnisfeld oder über die Liste *Frühere Importe* zurücknehmen: Notizen, episodische Zeilen, Skills (samt kopierter Dateien), Agenten und freigegebene Regelabschnitte werden entfernt; offene Vorschläge werden abgelehnt. Die Rücknahme ist destruktiv und braucht deshalb die Berechtigung **`delete` auf Data Port** — mit den ausgelieferten Vorgaben nur Owner und Admin; alle anderen sehen den Knopf mit einem Berechtigungsfehler scheitern. Eine Vault-Notiz, die du **seit dem Import bearbeitet** hast, bleibt liegen und wird unter *übersprungen* gemeldet statt gelöscht.

Lese-Werkzeuge bleiben auf den Speicherpfaden des Hosts offen, damit dieser Importer die Notizen hereinkopieren kann; Schreiben/Shell nach `~/.claude` / `~/.grok` / `ai-memory` ist verboten. Siehe [Speicher](/docs/de/knowledge/memory/).

## Geheimnisse

Eine Datei, welche die Geheimnis-Heuristik markiert, wird **wörtlich importiert wie jede andere Datei** und mit `contains-secrets` getaggt. Nichts fällt jemals weg, weil es ein Geheimnis enthält — Sicherheit ist hier eine *Recall*-Maßnahme, keine Import-Maßnahme. Der Tag reist als Notiz-Tag, als Skill-Fähigkeit, als episodischer Tag und als `[contains-secrets]` im Titel eines Vorschlags, und der Assistent markiert die Zeile, damit du sie vor dem Import siehst.

Die Heuristik sucht nach einem Private-Key-Block, einem Provider-Token, einem `KEY=value`-Literal oder einem `.env`-artigen Dateinamen. Code, der ein Geheimnis *nachschlägt* — `keychain_lookup(...)`, `os.environ[...]`, `getenv(...)` —, und Doku-Platzhalter wie `<your-key>`, `xxx` oder `.env.example` werden nicht markiert.

**Was der Tag bewirkt.** Eine Notiz, eine episodische Zeile oder ein Skill mit `contains-secrets` bleibt aus allem heraus, was das Modell von sich aus erreicht: dem Dauerindex des Speichers, verwandter Arbeit, `search_memory`, dem Reflexions-Job, dem nächtlichen Konsolidierer, dem Skill-Matcher und dem zusammengesetzten System-Prompt. Sie wird nie dem optionalen Anreicherungsmodell übergeben und nie eingebettet. Auf der Speicher-Seite siehst du sie weiterhin vollständig. Um sie dem Modell zu öffnen, setze `memory.recall.includeSecrets: true` in `config/local.yaml` und starte neu — siehe [Konfiguration](/docs/de/deploy/configuration/).

**Das ist ein Tor gegen automatische Aufnahme, kein Dateisystem-Sandkasten.** Der Tag verhindert, dass ein markiertes Element von selbst in einen Prompt gezogen wird. Er verhindert nicht, dass ein Agent mit Dateilese-Werkzeugen die ursprüngliche Datei auf der Platte liest, und er verschlüsselt nichts. Wenn ein Zugangsdatum auf dieser Maschine überhaupt nichts zu suchen hat, rotiere es: Aufgabe des Importers ist, es aus einem ungefragten Prompt herauszuhalten, nicht, es unerreichbar zu machen.

**Zwei Arten sind nicht abgeschirmt, weil dort der Inhalt *der* Prompt ist.** Eine importierte Agenten-Persona und eine freigegebene Workspace-Regeldatei werden **wörtlich in den Prompts des Assistenten verwendet**, ein Zugangsdatum darin erreicht das Modell also in jeder Runde und die Recall-Filterung greift dort nicht — sie abzuschirmen würde genau den Agenten abschalten, den du importiert hast. Sie werden trotzdem mit `contains-secrets` getaggt, damit du sie findest, und der Import-Assistent sagt dasselbe an diesen Zeilen: prüfe sie vor dem Import.

**Dateien in Zugangsdaten-Form** — `.env`, `credentials.json`, Schlüsseldateien — werden gelistet und sind importierbar, aber **nicht angehakt**. Eine Notiz, Regel, ein Skill oder ein Transkript, das lediglich einen Schlüssel *enthält*, behält sein eigenes kind, bleibt angehakt und trägt den Tag.

## Größenordnung

Jeder Kandidat ist eine Zeile in der Datenbank, deshalb hält weder der Assistent noch der Server je die ganze Liste.

**Der Scan läuft im Hintergrund.** Er antwortet sofort, und der Ordnerbaum füllt sich, während er läuft — mit besuchten Ordnern, gesehenen Dateien und gelisteten Zeilen. Ein ganzes Home-Verzeichnis braucht Minuten. Du kannst ihn stoppen, und was er bis dahin kartiert hat, bleibt prüfbar.

**Der Review-Schritt ist ein Ordnerbaum, eine virtualisierte Liste und eine Vorschau.** Jeder Ordner ist kartiert, auch die nicht betretenen Klassen — sie zeigen ihre Dateizahl und die Klasse, die den Walker draußen gehalten hat. **Alles Importierbare wählen**, **Keine** und **Zurück zum Vorschlag** wirken auf den ganzen Scan. Darunter wird per Geste ausgewählt statt Zeile für Zeile: Jeder Ordner und jede Art trägt ein Dreizustands-Kästchen — ein Klick nimmt also in jedem Ordner den Haken von jedem Transkript. Die Zahl neben jedem Kästchen ist die Antwort des Servers für die Auswahl auf dem Bildschirm, was du liest, ist also das, was der Import ablegt. Die Vorschau zeigt die ersten 64 KiB einer Datei; importiert wird sie trotzdem ganz.

**Der Import strömt.** Elemente laufen in Stapeln von 100, jeder Stapel wird committet, der Fortschritt alle 100 Elemente gemeldet und der Suchindex einmal am Ende neu gebaut. Du kannst nach dem laufenden Stapel stoppen — was schon abgelegt ist, bleibt und kann zurückgenommen werden. Startet der Server mitten im Import neu, setzt der Job beim letzten committeten Stapel fort statt von vorn. Scan-Zeit und Import-Zeit werden beide gezeigt.

**Eine große Datei setzt die Speichergrenze, nicht der ganze Baum.** Ein Container — ein Transkript, ein Chat-Export, eine Codex-Datenbank — kostet beim Import ein Mehrfaches seiner eigenen Dateigröße an flüchtigem Speicher, weil die Datei als ein Puffer gehalten wird, während jede Einheit darin gerendert wird. Wie viel, hängt davon ab, was die Datei ist: etwa das Dreifache bei einem Transkript mit einer Zeile je Zug, und das Siebenfache oder mehr bei einem Chat-Export, der als Ganzes in einen Objektgraphen geparst wird. Die Import-Phase kostet mehr als der Scan — ein 19-MB-Transkript maß 100 MiB beim Scannen und 235 MiB beim Importieren. Ein 90-MB-Chat-Export erreicht fast 900 MiB resident; dafür hat der 1Gi-Default des Helm-Charts Platz, der 512Mi-Legacy-Starter nicht.

**Der Speicher je Zeile bleibt flach, wie viele Zeilen es auch sind.** Nach einem Scan bleibt nichts liegen: Ein zweiter Scan desselben Baums mit 26 000 Zeilen fügt dem Heap überhaupt nichts hinzu. Der residente Speicher kann danach trotzdem hoch aussehen, weil der Allokator Seiten behält, die er sich schon vom System geholt hat — das ist der Allokator, nicht der Scan. Die Grenze setzt deine einzelne größte Datei, nicht der Umfang des Baums.

**Ein erneuter Lauf fügt nur Neues hinzu.** Alles schon Vorhandene meldet **Unverändert**, und ein späterer Import nimmt nie einen früheren zurück.

Zwei Fakten der Laufzeit, damit dich nichts überrascht:

- Eine gebündelte Skill-Datei über 200 000 Zeichen wird bis zu dieser Stelle in den Skill-Text eingebettet, mit einer Markierung, die die vollständige Kopie nennt. Die Kopie im Asset-Verzeichnis des Skills ist bytegenau und vollständig.
- Eine einzelne Textdatei, die größer ist als ein Textwert, den die Engine halten kann (etwa 512 MiB), wird gelistet, gehasht und ist wählbar wie jede andere, wird aber mit der Begründung *Größer als ein Textwert, den die Engine halten kann* gemeldet, statt abgelegt zu werden. Die Zeile sagt, warum.

**Ein Vorbehalt zur Identität.** Sitzungen und Skills haben keine Pfadidentität — sie werden am Digest ihres Inhalts erkannt. Eine reine Whitespace-Änderung an einer Quelldatei nach einem Import erzeugt deshalb eine *zweite* episodische Zeile (und einen zweiten Skill, wenn das Paket Dateien bündelt), statt die erste zu aktualisieren. Vault-Notizen, die eine Pfadidentität haben, werden an Ort und Stelle neu gestempelt.

## Felder und Bedienelemente

<h2 id="wizard">Import-Assistent</h2>

Schritte: **source → scanning → review → running → done**.

| Bedienelement | Bedeutung |
|---------------|-----------|
| **Quellsystem** | Profil aus der Liste oben |
| **Serverpfad** | Absoluter Pfad — ein Ordner oder ein ganzes Home-Verzeichnis. Wählst du ein **Quellsystem** statt Automatisch erkennen, werden dessen **Typische Orte** aufgelistet, direkt aus dem Adapter |
| **Archiv oder Datei hochladen** | ZIP eines früheren Exports oder eine einzelne Markdown/JSON-Datei. Die 50-MiB-Grenze gilt nur für den Upload; ein Pfad-Scan hat keine |
| **Anweisungen** | Optional — wonach gesucht werden soll. Steuert nur das Ranking; deswegen fällt nichts weg |
| **Scannen** | Den Baum im Hintergrund kartieren — besuchte Ordner, gesehene Dateien, gelistete Zeilen und **Scan stoppen** |
| Vom Scan gefundene Ordner | Jeder vom Scan kartierte Ordner, mit Schaltern je Ordner, Teilbaum-Zählungen und **Gründe, die die Zeilen in diesem Ordner tragen** — importierbar oder nicht, samt der Klasse eines nicht betretenen Ordners |
| Typfilter | **Alle / Speicher / Gedächtnis-Index / Sitzungen / Skills / Regeln / Identity / Agenten-Personas / Wissen / Quellcode / Nicht importierbar** |
| **Alles Importierbare wählen / Keine / Zurück zum Vorschlag** | Massenauswahl über den ganzen Scan, nicht nur über die Seite |
| Ordner- und Art-Kästchen | Dreizustand — ein Klick wählt oder leert alles Importierbare unter einem Ordner bzw. jede Zeile einer Art in jedem Ordner |
| **Vorschau** | Die ersten 64 KiB der Datei — importiert wird sie trotzdem ganz |
| **Metadaten mit dem Modell anreichern** | Standardmäßig aus — Opt-in, nur Metadaten, nie der Text, nie ein markiertes Element |
| **N Elemente importieren** | Hintergrund-Job starten |
| **Diesen Import stoppen** | Stoppt nach dem laufenden Stapel; was abgelegt ist, bleibt |
| Statistik | **Gewählt / Übernommen / Unverändert / Vorschläge / Übersprungen / Fehler** |
| **Übersprungen, nach Grund** | Zählung je Begründungscode (siehe unten) |
| **Gescannt in / Importiert in** | Wie lange jede Phase gedauert hat |
| **Merge freigeben / Ablehnen** | Workspace-Vorschläge — nie Auto-Merge |
| **Diesen Import zurücknehmen** | Den ganzen Job zurücknehmen — braucht `delete` auf Data Port |
| **Frühere Importe** | Die letzten fünf Jobs, jeder mit eigenem Rücknahme-Knopf |

Leerer Scan: *An diesem Ort wurde nichts Importierbares gefunden.*

## Begründungscodes

Jede Zeile der Review-Liste trägt eine Begründung, und jedes Ergebnis, das keine saubere Übernahme ist, wird unter **Übersprungen, nach Grund** gezählt. Beides kommt aus einem festen Vokabular — nie Freitext —, damit der Assistent das Label unten zeigt, während API und Logs den Code führen.

| Code | Bedeutung |
|------|---------------|
| `directory-skipped` | Nie betretene Ordnerklasse — eine gezählte Zeile mit Dateizahl und Klasse |
| `binary` | Binärdatei |
| `outside-root` | Außerhalb des gewählten Ordners |
| `duplicate-content` | Identischer Inhalt |
| `unreadable` | Nicht lesbar |
| `empty` | Leere Datei |
| `derived-index` | Erzeugter Index |
| `transcript` | Gesprächsprotokoll (ganz importiert) |
| `session-summary` | Sitzungszusammenfassung |
| `session-artifact` | Neben einer Sitzung abgelegte Werkzeugausgabe |
| `persona` | Agenten-Persona |
| `slash-command` | Slash-Befehl |
| `cursor-rule` | Cursor-Regeldatei |
| `memory-note` | Gedächtnisnotiz |
| `memory-index` | Gedächtnis-Index |
| `skill-package` | Skill-Paket |
| `skill` | Skill-Datei |
| `orphan-asset` | Beigelegte Datei eines nicht importierten Skills |
| `rules-file` | Regeldatei |
| `config` | Konfigurationsdatei |
| `source-code` | Quellcodedatei — importierbar, nicht angehakt |
| `data-file` | Daten- oder Konfigurationstext — importierbar, nicht angehakt |
| `symlink-upload` | Symlink im Upload |
| `needs-bun` | Benötigt die Bun-Laufzeit |
| `not-downloaded` | In der Cloud gespeichert, nicht heruntergeladen — aus dem gelistet, was das Dateisystem weiß, nie geholt |
| `invalid-json` | Ungültiges JSON |
| `unknown-json` | Unbekanntes JSON |
| `unrecognised` | Nicht erkannt |
| `app-state` | Anwendungszustand |
| `identity` | Identitätsdatei |
| `not-durable` | Text Dritter oder Textbaustein — nur Label |
| `tools-policy` | Werkzeugrichtlinie |
| `not-importable` | Nichts Importierbares darin |
| `missing-unit` | Sein Teil der Datei fehlte |
| `unsupported-target` | Ziel nicht unterstützt |
| `service-unavailable` | Der Dienst war nicht verfügbar |
| `not-a-persona` | Keine Agenten-Persona |
| `no-agent` | Kein Agent zum Empfangen |
| `exceeds-string-limit` | Größer als ein Textwert, den die Engine halten kann — gelistet, noch nicht abgelegt |
| `unchanged` | Bereits importiert, unverändert |
| `error` | Mit einem Fehler gescheitert |

`not-durable` und `transcript` sind nur Labels: keines wählt etwas ab. Die Art **Unbekannt** entsteht nicht mehr — sie lebt nur auf Scans weiter, die vor dieser Version gemacht wurden.

## Verwandt

- [Speicher](/docs/de/knowledge/memory/)
- [Skills](/docs/de/automation/skills/)
- [Sicherung](/docs/de/admin/backup/)
- [Agenten — Workspace](/docs/de/agents/identity-workspace/)
