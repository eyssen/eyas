---
title: Sicherheit & Datenschutz
description: Security-Gate, Event-Stream, Audit-Log und die Datenschutzrichtlinie — vor und nach Tools.
---

**Wozu das da ist.** Hinter diesem Kapitel stehen drei Operator-Flächen. Das **Security-Gate** ist die Laufzeitrichtlinie, die einen Tool-Aufruf *bevor* er läuft erlaubt, verweigert oder eskaliert. **Sicherheitsereignisse** (`/security`) ist der Stream dieser Entscheidungen. **Audit** (`/audit`) ist das unveränderliche Aktionsprotokoll (mit optionalem Rollback). **Datenschutz** (`/privacy`) ist der Ort, an dem du die Datenschutzrichtlinie bearbeitest und testest: welche personenbezogenen Daten maskiert werden, wenn Text EYAS in Richtung eines entfernten Modells verlässt, welche neuen Nachrichten abgelehnt werden — und dieselbe Maske, die Durable-Memory-Capture *vor* dem Vault-Write anwendet.

## Wann du es brauchst

- Ein Tool-Aufruf wurde verweigert, und du brauchst Checkpoint, Risiko und Grund.
- Du willst sicherstellen, dass Browser-Tools keine privaten oder Metadata-Hosts treffen (SSRF).
- Du schaltest Autonomie ein und willst sehen, was das Gate eskaliert.
- Du musst prüfen, ob PII in Logs, Vault-Notizen oder ausgehende Prompts gelangt.
- Du willst wissen, was ein entferntes Modell bekommt, wenn ein Prompt eine E-Mail-Adresse, eine IBAN oder eine Steuernummer enthält.
- Einem Modell wurde ein Pfad mit *Memory outside EYAS …* oder *… is read and written only by EYAS* verweigert, und du willst wissen, warum — oder sehen, welche Orte auf diesem Server gesperrt sind.
- Du willst wissen, wie die KI-Kommandozeilenwerkzeuge (Claude Code, Grok, Kimi, OpenCode) vom eigenen Setup der Maschine ferngehalten werden, wie das bewiesen wird und ob ihre Kernel-Datei-Sandbox aktiv ist.
- Eine Nachricht wurde mit *Nachricht nicht gesendet — Datenschutz* abgelehnt, oder du willst ändern, welche Werte maskiert oder abgelehnt werden.
- Ein Modell lief ohne EYAS' Isolation, und sein Speicher soll vor jedem Modell verborgen werden (siehe [Speicher eines Anbieters unter Quarantäne stellen](#quarantine-a-providers-memory)).

## Typischer Ablauf

1. **Sicherheit** (`/security`) öffnen. Oben steht die Karte **Speicher außerhalb von EYAS** (Owner und Admins). Die Ereignisse nach Entscheidung (**Zulassen / Ablehnen / Eskalieren**), Risiko und Checkpoint filtern.
2. **Audit** (`/audit`) öffnen: wer was getan hat, Modul, Ergebnis (**erfolgreich / Fehler / abgelehnt / zurückgerollt**), Kosten. Rollback ist eine Aktion mit Bestätigung, wenn angeboten.
3. **Datenschutz** (`/privacy`) öffnen: die Verkehrszähler lesen, die Richtlinie anpassen (Aktion pro Typ, eigene Muster, lokale Hosts) und **Richtlinie speichern**, dann **PII-Scanner testen** mit Beispieltext — *So erhält es ein entferntes Modell* zeigt, was ein entferntes Modell bekäme.
4. Mit [Autonomie](/docs/de/agents/autonomy/) (Freigaben) und [Geheimnisse](/docs/de/admin/secrets/) kombinieren.
5. Für SSH auf andere Maschinen siehe [Knoten](/docs/de/admin/nodes/) — destruktive Muster brauchen ein ausdrückliches Force-Flag.

## Funktionen

| Bereich | Route / Bedeutung |
|---------|-------------------|
| **Security-Gate** | Laufzeitrichtlinie vor gefährlichen Tools |
| **Sicherheitsereignisse** | `/security`-Event-Stream, mit der Karte **Speicher außerhalb von EYAS** |
| **Audit** | `/audit`, unveränderliches Aktionsprotokoll |
| **Datenschutz** | `/privacy`: Verkehrszähler, Editor der Datenschutzrichtlinie, Scan-Test |

### Browser-SSRF-Schutz {#browser-ssrf-protection}

Browser-Tools blockieren Anfragen an **private / Metadata**-Hosts (Cloud-Metadaten, Loopback, RFC1918 usw.), um das Risiko von Server-Side Request Forgery zu senken. Bevorzuge `browser_snapshot` (nummerierte interaktive Elemente) gegenüber Screenshots, wenn Agenten nur die Struktur brauchen. Indexe sind nach einer Navigation ungültig. Das Headless-Profil gehört EYAS (`data/browser/profile`); das tägliche Chrome-Profil wird abgelehnt (Chrome 136+ blockiert CDP auf dem Default-Profil). `browser_evaluate` läuft in der Seite, nicht in Node. `browser_totp` ist **gelb**: Es liest einen Seed aus Geheimnissen/Schlüsselbund und gibt nur einen kurzlebigen Code zurück (an `browser_fill` weitergeben). Das Action-Cache-JSON speichert Locator, nie Secrets oder Eingabewerte. Die optionalen [Browser-Use](/docs/de/automation/browser-use/)-Sidecars (empfohlen: agent-browser unter `data/browser/agent-browser/profile`; alte Python-CLI) schalten die Chromium-Sandbox nie automatisch ab, rufen nie `chat` / AI Gateway auf und hängen sich nie an das tägliche Chrome-Profil.

### Lesendes Git ohne Klick {#read-only-git-without-a-click}

`git_status` und `git_diff` sind grün. Schickt das Modell stattdessen `run_command` / `Bash`, dessen argv eindeutig `git status` oder `git diff` ist (keine Metazeichen, kein `-C` / `--git-dir` / `--no-index`, kein absoluter Pfad), bildet das Gate den Aufruf auf diese Tools ab und **erlaubt ihn** — ohne Freigabezeile. `git commit`, `git add`, `ls` und jeder Befehl mit Metazeichen bleiben rot oder werden abgelehnt. Siehe [Werkzeuge](/docs/de/automation/tools/).

### Security-Judge {#security-judge}

Gelbe und rote Tool-Aufrufe bekommen vor dem Lauf eine KI-Prüfung. Diese Prüfung ist ein kurzer isolierter Aufruf auf EYAS' Hintergrundmodell — ohne Werkzeuge, ohne Gesprächsverlauf, nie eine CLI-Session, die den eigenen Speicher oder die eigene Konfiguration der CLI lädt. Sie nutzt die **Heartbeat**-Routing-Stufe, dann **Quick**, dann den Installations-Default, dann andere geeignete Anbieter (jeder API-Anbieter, Claude Code, Grok CLI, sobald seine Isolationsprüfung beim Laden des Anbieters (Start, Neuladen, erneutes Aktivieren) oder der Session-Start eines Zugs bestanden hat, und Kimi Code CLI, sobald auf diesem Host eine Session gestartet wurde — dazu zählt auch die Modellerkennung beim Laden, solange es für EYAS angemeldet ist). Ein zweites Modell wird nur nach einem Netzwerk-, Timeout-, Überlastungs- oder Rate-Limit-Fehler versucht.

Ist kein Modell geeignet (etwa eine reine Grok-Installation, deren Isolation noch nicht verifiziert ist), ist das Modellbudget gestoppt oder scheitert jeder Versuch, wird der Aufruf **zu deiner Freigabe eskaliert** (eine Freigabeanfrage in der Warteschlange) — nie erlaubt. Vorher blockierte eine gescheiterte KI-Prüfung den Aufruf sofort. Steht die Autonomie-Kategorie eines Agenten auf Stufe 3 (**Auto**), führt EYAS den Aufruf ohne Nachfrage aus, wie schon bisher, wenn gar kein KI-Anbieter konfiguriert war. Eine Antwort, die die Prüfung nicht lesen kann, verweigert den Aufruf weiterhin. Auf einer Installation, deren einziges Modell Claude Code ist, startet jede KI-Prüfung einen kurzen isolierten Claude-Code-Prozess.

### Speicher außerhalb von EYAS {#memory-outside-eyas}

Das Security-Gate verweigert Speicher außerhalb von EYAS — **beim Lesen wie beim Schreiben** — für jedes Modell und jeden Tool-Aufruf, den es prüft. Verweigert werden:

- Speicher und Zustand anderer Assistenten: Claude Code (`~/.claude`, `~/.claude.json`), Grok, Codex, Gemini, Kimi, Cursor, Windsurf, die Ordner von OpenCode, gemeinsame Agent-Skill-Ordner, Copilot, dieselben Punkt-Ordner in den Home-Ordnern anderer Benutzer, jeder `ai-memory`-Ordner und jeder Speicherordner unter einem Werkzeug-Punkt-Ordner;
- Obsidian-Vaults (erkannt am Ordner `.obsidian` oder an Obsidians Vault-Liste) und Obsidians App-Einstellungen;
- jeder Pfad aus `security.foreignMemoryPaths` (beim Start gelesen; Einträge, die keine absoluten Pfade sind, werden mit einer Warnung im Log ignoriert);
- EYAS' eigener Datenordner — Vault, Datenbank (auch wenn `database.path` woandershin zeigt), Schlüssel, Browser-Profil und die EYAS-eigenen CLI-Anmeldeordner (`data/cli-homes`);
- der Workspace eines anderen Gesprächs, sofern die Arbeitsordner des Aufrufs bekannt sind.

Weiterhin erlaubt: der eigene Workspace und die Ordner des Gesprächs, Studio-Projekte (`data/studio`), Browser-Downloads (`data/browser/downloads`) und gewöhnliche Projektdateien wie `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.claude/agents` und `docs/MEMORY.md`. Eine Datei, deren Text diese Pfade nur *erwähnt*, ist in Ordnung — das Gate beurteilt den Pfad, nicht den Inhalt —, und das Suchmuster von Grep gilt nie als Pfad.

**Wo es gilt:** EYAS-Tools, die EYAS' eigene Agentenschleife ausführt (API-Anbieter); EYAS-Tools, die Grok und Kimi über die Tool-Bridge aufrufen (die Bridge kennt die Ordner des Zugs auf dem Server, und eine Anfrage kann nie ihre eigenen nennen); jeder Tool-Aufruf, für den Claude Code um Erlaubnis fragt; Claude Codes eigene eingebaute Werkzeuge (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch, …), die **vor dem Lauf** eine Prüfung durchlaufen — auch Lesezugriffe, die Claude Code in seinem Arbeitsordner sonst selbst erlauben würde; jede Berechtigungsanfrage von Grok/Kimi (Grok fragt für alle seine nativen Werkzeuge, Lesen eingeschlossen); und jede Datei, die Grok oder Kimi über EYAS lesen oder schreiben. Welche Ordner als die des Gesprächs zählen, entscheidet EYAS — seine Ordner, die die Prüfung noch bestehen, plus der Ordner, in dem die CLI gestartet wurde —, nie der Ort, den die CLI angibt. Headless-OpenCode-Aufgaben werden genauso geprüft, mit den Ordnern der Aufgabe. Grok, Kimi und OpenCode laufen in einem eigenen, EYAS-eigenen Home, auf das `~` und `$HOME` zeigen: Ein damit geschriebener Pfad wird sowohl als dieses Home als auch als dein eigenes beurteilt, sodass `~/../../vault` oder `$HOME/../../sqlite` weder EYAS' Daten noch den Anmeldeordner einer anderen CLI erreicht.

**Ein Ordner wird danach beurteilt, was er enthält.** Eine CLI wie Claude Code liest und sucht in ihrem Arbeitsordner, ohne zu fragen — die Release-Prüfung hat am echten Binary bestätigt, dass solche Lesezugriffe nie beim Freigabeschritt ankommen. Deshalb wird ein Ordner eines Gesprächs, eines Projekts oder eines Projekttyps nicht nur abgelehnt, wenn er in einem der oben genannten Orte liegt, sondern auch, wenn er einen davon **enthält**: EYAS' eigenes Home, seinen Datenordner, seine Datenbank oder seinen Workspaces-Ordner (zum Beispiel den EYAS-Checkout, der `data/` enthält), den Speicher eines anderen KI-Werkzeugs oder einen CLI-Anmeldeordner von EYAS, einen Notiz-Vault, einen `ai-memory`-Ordner oder einen Eintrag aus `security.foreignMemoryPaths` (zum Beispiel `~/Documents` mit einem Vault darin). Früher gespeicherte Ordner, die jetzt abgelehnt werden, bleiben bei jedem Lauf außen vor, mit einem Hinweis im Chat. Siehe [Gespräche — Ordner](/docs/de/daily/conversations/#working-folders). Auf Claude Code lehnt die Prüfung der Speicherrichtlinie auch die Lesezugriffe ab, die Claude Code in seinem Arbeitsordner selbst erlaubt — einen Vault oder EYAS' Daten, erreicht über einen absoluten oder relativen Pfad, einen symbolischen Link, Grep, Glob, LS oder ein Shell-`cat`; das wurde am echten Binary bewiesen.

**Suchen werden danach beurteilt, was sie erreichen können.** Eine Suche mit den eigenen Werkzeugen einer CLI wird nicht nur abgelehnt, wenn ihr Ordner geschützt ist, sondern auch, wenn der durchsuchte Ordner einen geschützten Ort **enthält** und ihre Einschluss-Globs ihn erreichen können: Der CLI lässt sich nicht sagen, diesen Ort auszulassen, also wird der Aufruf abgelehnt, bevor er läuft. Das betrifft Grep, Glob und LS von Claude Code; grep und list_dir von Grok; grep, glob und list von OpenCode; und Shell-Befehle über Claude Codes Bash, Groks Shell und EYAS' `run_command`, die rekursiv suchen — `grep -r`/`-R`, `rg`, `ag`, `ack`, `find`, `fd`, `tree`, `du`, `ls -R`, rekursives `cp`/`rsync`/`scp`/`zip`/`tar`/`ditto`, `locate`/`mdfind`, `git grep --no-index` — oder Glob-Wörter wie `cat ~/.*/projects/*/memory/*.md` verwenden. Die geschützten Orte sind die oben aufgeführten.

- **Abgelehnt**, zum Beispiel: Grep in `~` mit dem Glob `**/memory/*.md`; Glob in `~` nach `**/MEMORY.md`; `grep -r token ~`; Grep in `~/Documents`, wenn darin ein Vault liegt; ein Grep, dessen Pfad der EYAS-Checkout oder ein Ordner darüber ist, etwa `grep -rn x ~/GitHub`, wenn der Checkout darin liegt (der Checkout enthält `data/`).
- **Weiterhin erlaubt:** eine Suche, deren Ordner oder Glob den geschützten Ort nicht erreichen kann — zum Beispiel der Ordner `src` des Checkouts als Pfad oder der Glob `src/**/*.ts` mit dem Checkout als Pfad — und jede Suche in einem gewöhnlichen Projektordner. Eine Datei über ein Here-Document zu schreiben (`cat > a.ts <<'EOF'` … `EOF`) ist keine Suche: Seine Zeilen sind Daten, nie Glob-Wörter oder Befehle. Ausschluss-Globs (`!…`) machen eine Suche nicht enger. Ein Glob ohne Schrägstrich (`*.md`) passt wie bei ripgrep in jeder Tiefe und erreicht damit jeden Unterordner; Glob-Wörter in der Shell sind dort verankert, wo sie stehen.
- **Dieselbe Ablehnung.** Es ist dieselbe harte, deterministische Ablehnung wie jede andere Ablehnung der Speicherrichtlinie: kein KI-Judge, keine Freigabe, nie durch eine Berechtigung geöffnet, nicht auf die Sperre nach 3 Ablehnungen angerechnet und auch bei ausgeschaltetem Gate wirksam. Sie schreibt eine Zeile **Ablehnen** unter Sicherheitsereignisse (Checkpoint `deterministic`) und zählt in der Ablehnungszahl der [Karte Speicher außerhalb von EYAS](#memory-outside-eyas-card).
- **Wie die Orte gefunden werden.** Die Orte, die EYAS beim Namen kennt, werden immer geprüft: die Stores anderer Werkzeuge, registrierte Obsidian-Vaults, `security.foreignMemoryPaths`, EYAS' Datenordner und Datenbank, die CLI-Homes und die Workspaces anderer Gespräche. Vaults, die nur an ihrem `.obsidian`-Ordner erkennbar sind, `ai-memory`-Ordner, Speicherordner unter Werkzeug-Punkt-Ordnern und symbolische Links in geschützte Orte werden durch einen begrenzten Blick in den durchsuchten Ordner gefunden: die ersten 2.000 Ordner, 8 Ebenen tief, nie in `node_modules` oder `.git`/`.hg`/`.svn`. Jenseits dieser Grenze werden nur die beim Namen bekannten Orte geprüft. Das Lesen von Shell-Befehlen bleibt nach bestem Bemühen: Variablen werden nicht verfolgt; `cd`, `eval`, `sh -c`, eine Shell, die ihr Skript aus einem Here-Document liest, reservierte Wörter (`if`, `then`, `do`, `{`, `!`), Umleitungen wie `2>/dev/null` und Klammer-Alternativen wie `~/{.,}` schon. Eine Suche, die `xargs` oder `parallel` ausführt, bekommt ihre Ordner aus einer Eingabe, die die Befehlszeile nicht zeigt, und gilt deshalb als Suche in `/`.
- **EYAS' eigene Werkzeuge `grep` und `glob`** werden für einen solchen Ordner nie abgelehnt: Sie lassen geschützte Ordner aus und jetzt auch geschützte Dateien — eine Datenbank im durchsuchten Ordner oder eine in `security.foreignMemoryPaths` eingetragene Datei, auch wenn sie direkt genannt wird.
- **Kimi Code CLI** (aus dem Quellcode von kimi-cli 1.52.0; nicht auf einem Host geprüft): Kimis eigene Werkzeuge Grep und Glob fragen EYAS nie, EYAS kann also eine Kimi-Suche, die oberhalb eines geschützten Orts beginnt, nicht ablehnen. Kimis Glob bleibt in seinem Arbeitsordner, sein Grep akzeptiert aber jeden Ordner, und Kimi hat keine Kernel-Sandbox. Kimis Shell-Befehle fragen zwar, doch die Anfrage enthält den Befehl nicht in einer Form, die die Pfadprüfung lesen kann; es entscheidet also der KI-Judge oder ein Mensch.

**Wie abgelehnt wird:** sofort und deterministisch. Es gibt keinen KI-Judge, keine Freigabeanfrage, und keine Freigabe oder Berechtigung kann es öffnen. Die Ablehnung zählt nicht zur Sperre nach 3 Ablehnungen, ein Modell, das einen verbotenen Pfad erneut versucht, sperrt also nicht für 10 Minuten andere Werkzeuge. Sie gilt auch bei ausgeschaltetem Security-Gate. Jede Ablehnung ist eine Zeile unter **Sicherheitsereignisse** — Entscheidung **Ablehnen**, Checkpoint `deterministic` und ein Grund. Die Prüfung schlägt geschlossen fehl: Kann sie nicht antworten, wird der Aufruf verweigert. Nur ein einmaliger Hintergrundaufruf ganz ohne Werkzeuge läuft ohne sie.

**Was das Modell erfährt:**

- *Memory outside EYAS (&lt;store&gt;) — use memory_search / memory_expand from EYAS*
- *EYAS data directory (&lt;part&gt;) is read and written only by EYAS*
- *EYAS-owned CLI home (cli-homes) is read and written only by EYAS*
- *Not this conversation's workspace (…) — work in this conversation's folders*
- *Search too broad [memory-path:search-scope:&lt;target&gt;]: the folder searched contains &lt;what&gt;, and this tool cannot leave it out — search a narrower folder that does not contain it* — beim Speicher eines anderen Werkzeugs mit dem Zusatz *; for memory use memory_search / memory_expand from EYAS*. Das Ziel ist `foreign-memory`, `eyas-data`, `provider-home` oder `other-workspace`. Die Tool-Zeile **Abgelehnt** im Chat macht daraus eine übersetzte Zeile, zum Beispiel *Suche zu breit: Der Ordner enthält auch den Speicher eines anderen Werkzeugs, den nur EYAS lesen darf. Das Modell wurde gebeten, in einem engeren Ordner zu suchen.* — oder die eigenen Daten von EYAS, die CLI-Anmeldungen, die EYAS verwahrt, oder den Arbeitsbereich einer anderen Unterhaltung.

Grok CLI gibt den Grund nicht an sein Modell weiter: Lehnt EYAS einen von Groks Tool-Aufrufen ab, beendet Grok diese Antwort, und der Chat zeigt die abgelehnte Tool-Zeile und danach nichts mehr. Frag noch einmal, ohne diesen Schritt — nach einer Ablehnung *Suche zu breit* mit einem engeren Ordner. Claude Code macht weiter und bekommt den Grund, kann eine Suche also selbst in einem engeren Ordner wiederholen. Siehe [Anbieter — Grok CLI und Kimi Code CLI](/docs/de/ai/providers/#grok-cli-and-kimi-code-cli).

**Die Kernel-Schicht.** Shell-Befehle können einen Pfad erreichen, den der Befehlstext nicht zeigt, und manche CLI-Tools fragen EYAS gar nicht. Dafür laufen die Shell von Claude Code und die eigenen Tools von Grok CLI in der Datei-Sandbox des Betriebssystems (macOS Seatbelt, Linux bubblewrap), die dieselben Orte im Kernel sperrt: den Speicher anderer Werkzeuge, EYAS' private Daten und die Workspaces anderer Gespräche. Mit `security.cliSandbox: auto` (dem Default) läuft eine CLI dort, wo keine verfügbar ist, ohne sie, und der Chat sagt das einmal; mit `required` werden solche Runden abgelehnt. In `auto` wartet ein Claude-Code-Befehl, der außerhalb der Sandbox laufen will, immer auf die Freigabe eines Menschen — nie auf den KI-Judge, nie auf die Autonomie-Leiter. Kimi Code CLI hat keine Kernel-Sandbox; ihre eigenen Tools read, grep und glob werden also weiterhin nur dort geprüft, wo EYAS sie sieht. Siehe [Anbieter — Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox). Der [Datenimport](/docs/de/admin/data-port/) ist nicht betroffen, weil er die Stores anderer Werkzeuge selbst liest und nicht über ein Modell-Werkzeug.

**Migration.** Agenten, die früher `~/.claude/CLAUDE.md`, `~/.grok`-Speicher, Vault-Notizen oder Dateien unter `data/` direkt lasen, werden jetzt abgelehnt (Sicherheitsereignisse zeigt es). Hole dieses Wissen einmal mit dem Datenimport in EYAS. Agenten oder Gewohnheiten, die mit den eigenen Werkzeugen einer CLI das ganze Home oder einen übergeordneten Ordner durchsucht haben, werden ebenfalls abgelehnt: Richte sie auf einen Unterordner, oder nutze EYAS' `grep`/`glob`, die geschützte Orte auslassen. Ein Ordner, der einen geschützten Ort enthält — der EYAS-Checkout, ein `~/Documents` mit einem Vault —, wird nicht mehr akzeptiert: Wähle einen engeren Ordner, etwa den Projektordner in `~/Documents` oder einen separaten Klon des Repositorys. Auch MCP-Server, die einen Speicher außerhalb von EYAS führen, sind gesperrt — siehe [MCP](/docs/de/ai/mcp/#memory-store-servers-are-blocked).

### Die Karte Speicher außerhalb von EYAS {#memory-outside-eyas-card}

Die Seite **Sicherheitsereignisse** (`/security`) beginnt mit der Karte **Speicher außerhalb von EYAS**. Nur Owner und Admins sehen sie, weil sie absolute Pfade auf dem Server zeigt; andere Rollen bekommen einen Ladefehler und keine Pfade. Sie zeigt:

- **Zwei Zähler für die letzten 24 Stunden.** *Ablehnungen der Speicherrichtlinie* zählt Tool-Aufrufe, die die Speicherrichtlinie auf irgendeinem Kanal abgelehnt hat — Lesen oder Schreiben im Speicher eines anderen Werkzeugs, in einem Obsidian-Vault, in EYAS' eigenem Datenordner, der Datenbank oder den CLI-Anmeldungen oder im Workspace eines anderen Gesprächs, dazu Suchen, die als zu breit abgelehnt wurden, weil ihr Ordner einen dieser Orte enthält. *Befehle, die die Sandbox verlassen wollten* zählt Shell-Befehle, die außerhalb der Kernel-Sandbox laufen wollten und einem Menschen zur Freigabe vorgelegt wurden.
- **Speicher anderer Werkzeuge auf diesem Server** — die bekannten Stores anderer KI-Werkzeuge und Notiz-Apps, die es hier gibt (etwa `~/.claude`, `~/.grok`, `~/.codex`, die Ordner von OpenCode, Obsidians App-Einstellungen), mit ihren Pfaden, und wie viele weitere bekannte Orte geschützt sind, sobald sie auftauchen. Ein Satz erklärt, was sonst noch geschützt ist, wo auch immer es liegt: jeder Ordner mit einem `.obsidian`-Ordner (ein Obsidian-Vault), Ordner namens `ai-memory` und Speicherordner in `.claude`, `.grok`, `.codex` und ähnlichen Werkzeugordnern.
- **Gefundene Obsidian-Vaults** — Vaults aus Obsidians eigener Vault-Liste plus Vaults, die EYAS beim Prüfen von Tool-Aufrufen an ihrem `.obsidian`-Ordner erkannt hat. Ein nicht gelisteter Vault ist trotzdem durch seinen `.obsidian`-Ordner geschützt.
- **Deine Ergänzungen (security.foreignMemoryPaths)** — die zusätzlichen Pfade aus der Konfiguration. Pfade, die es noch nicht gibt, sind als *noch nicht auf diesem Server* markiert; Einträge, die keine absoluten Pfade sind, als *ignoriert*. Um einen weiteren Ordner oder eine Datei zu schützen, trage den absoluten Pfad in `security.foreignMemoryPaths` der Konfigurationsdatei ein und starte EYAS neu (die Liste wird beim Start gelesen).
- **Eigene Daten von EYAS** — der Datenordner, die Datenbank und die CLI-Anmeldungen (die EYAS-eigenen CLI-Homes). Nur EYAS liest und schreibt sie; Modelle dürfen den Workspace ihres Gesprächs, Studio-Projekte und Browser-Downloads nutzen.
- **Arbeitsbereiche der Unterhaltungen** — die Wurzel der Workspaces. Das Modell eines Gesprächs sieht dort nur seinen eigenen Workspace.
- **Kernel-Datei-Sandbox der CLI-Anbieter** — der Modus `security.cliSandbox` (`auto` oder `required`) und für jeden eingeschalteten CLI-Anbieter (Claude Code, Grok CLI, Kimi Code CLI), ob seine eigenen Tools in der Kernel-Sandbox laufen: *aktiv*, *nicht verfügbar* oder *nicht unterstützt*, mit dem Grund (bubblewrap nicht installiert, socat fehlt — von Claude Code gebraucht —, User-Namespaces deaktiviert, nicht unterstütztes Betriebssystem oder die CLI bietet keine). Mit `required` und ohne Sandbox sagt die Karte, dass Runden mit Tools auf dieser CLI abgelehnt werden. Mit *nicht verfügbar* oder *nicht unterstützt* in `auto` laufen die eigenen Tools der CLI ohne Sandbox, und EYAS prüft weiterhin jeden Tool-Aufruf, den es sieht. Mit `auto` und aktiver Claude-Code-Sandbox wartet ein Claude-Code-Befehl, der außerhalb der Sandbox laufen will, immer auf die Freigabe eines Menschen.

**API.** `GET /api/v1/security/memory-policy` (Lesen von `SecurityEvent`). Es gibt keine neuen Einstellungen oder Umgebungsvariablen.

### KI-Kommandozeilenwerkzeuge laufen isoliert {#ai-command-line-tools-run-isolated}

- **Claude Code** läuft immer isoliert: keine Host-`settings.json`, `CLAUDE.md`, Skills, MCP-Server oder Auto-Memory, keine Transkripte auf dem Host, eine Umgebung nach Allowlist und eine Startprüfung, die einen Lauf stoppt, wenn etwas anderes geladen wurde. Siehe [Anbieter — Claude-Code-Isolation](/docs/de/ai/providers/#claude-code-isolation).
- **Grok CLI und Kimi Code CLI** laufen in EYAS-eigenen Homes (`data/cli-homes/…`, dort liegen ihre EYAS-Anmeldungen), fragen EYAS vor ihren nativen Werkzeugen und laufen erst, nachdem EYAS ihre Isolation geprüft hat — ein Zug, der die Prüfung nicht besteht, stoppt und wird nie an ein anderes Modell übergeben. Siehe [Anbieter — Grok CLI und Kimi Code CLI](/docs/de/ai/providers/#grok-cli-and-kimi-code-cli).
- **OpenCode**, der optionale Sidecar, läuft in einem EYAS-eigenen Ordner (`cli-homes/opencode`, dort liegt seine Anmeldung) und lädt keine Host-Assistenten-Anweisungen, Skills oder Projektkonfiguration. Headless-OpenCode-Aufgaben fragen vor jedem Tool-Aufruf das EYAS-Security-Gate. Ein OpenCode-Terminal oder eine einfache Shell können nur der Eigentümer und Admins öffnen (das Verwaltungsrecht für OpenCode): Im Terminal gibt der Mensch OpenCodes Tool-Aufrufe selbst frei, und was dort läuft, läuft als Betriebssystem-Benutzer des Servers — siehe [OpenCode — Wer ein Terminal öffnen darf](/docs/de/automation/opencode/#who-can-open-a-terminal). OpenCode liest EYAS-Speicher nur über die lesenden Werkzeuge `memory_search` / `memory_expand`; ein Werkzeug, das Speicher schreibt, hat es nicht. Jeder OpenCode-Prozess, den EYAS startet, bekommt seinen eigenen Schlüssel auf Dateideskriptor 3 — nie in einer Umgebung, einer Argumentliste oder einer Datei —, und der Schlüssel erlischt mit diesem Prozess. Der Schlüssel selbst verlässt OpenCode nie: Jeder Speicheraufruf trägt einen einmaligen Nachweis für die eine OpenCode-Sitzung, in der das Werkzeug läuft, sodass weder ein Befehl, den das Modell ausführt, noch ein anderer Prozess den Speicher einer anderen Sitzung lesen kann. Was an Grenzen bleibt: OpenCode liest sein Server-Passwort nur aus seiner Umgebung, ein Prozess desselben Betriebssystem-Benutzers, der die Umgebung eines anderen Prozesses lesen kann, kann also die Sitzungen dieses OpenCode-Servers über OpenCodes eigene API steuern; OpenCode hat keine Kernel-Sandbox; und ein Prozess, der den Speicher eines anderen Prozesses lesen darf, kann den Schlüssel erreichen. Eine Attach-URL zu einem externen OpenCode-Server ist nicht isoliert und hat keinen Zugriff auf EYAS-Speicher. Siehe [OpenCode](/docs/de/automation/opencode/#eyas-memory-inside-opencode).
- **Kernel-Datei-Sandbox.** Die Shell-Befehle von Claude Code und die eigenen Tools von Grok CLI laufen in der Datei-Sandbox des Betriebssystems, wo eine verfügbar ist (`security.cliSandbox`); Kimi Code CLI hat keine. Siehe [Anbieter — Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox).

### Wie die Isolation bewiesen wird {#how-isolation-is-proven}

Jeder CLI-Lauf wird beim Start geprüft (siehe oben). Darüber hinaus wird jede CLI-Version, die EYAS unterstützt, vor dem Release durch eine **Release-Prüfung** bewiesen: `bun run test:live-cli`, ausgeführt von Entwicklern und Release-Verantwortlichen. Sie startet die echten Claude Code und Grok CLI (und Kimi Code CLI, wo installiert) über EYAS' eigene Anbieter in einem Wegwerf-Home voller Fallen: Host-Einstellungen, die alles erlauben, Hooks und MCP-Server, die eine Spur hinterlassen würden, wenn sie liefen, `CLAUDE.md`, `AGENTS.md`, Skills, ein Vault im Obsidian-Stil und ein Projektordner mit eigener Konfiguration. Der kostenlose Teil schickt jede Modellanfrage an ein Scheinmodell auf der lokalen Maschine; er braucht also kein Konto und verbraucht keine Tokens. Der kostenpflichtige Teil führt echte Modell-Züge mit der eigenen Anmeldung des Owners aus und wird für jeden Lauf einzeln freigegeben.

Die Prüfung stellt sicher, dass:

- keine Host- oder Projektkonfiguration, Anweisungsdatei, kein Hook und kein MCP-Server geladen wird;
- Grok jede gelesene Datei über EYAS erfragt und der Vault draußen bleibt;
- EYAS' Speicherrichtlinie den Vault und EYAS' eigenen Datenordner ablehnt;
- die Datei-Sandbox des Betriebssystems ein verstecktes Vault-Lesen in der Shell von Claude Code stoppt;
- ein normales Lesen im Workspace weiterhin funktioniert;
- in EYAS' CLI-Homes kein Session-Store zurückbleibt;
- Grok und Kimi nichts im Host-Home ändern;
- Claude Code auf den Host nur eine kurze, versionierte Liste von Verwaltungsdateien schreibt, nie Gesprächsinhalt;
- der temporäre Ordner von Claude Code, in den die Ausgabe von Shell-Befehlen im Hintergrund geht, der eigene Ordner des Laufs in EYAS ist und mit dem Lauf verschwindet — im `/tmp/claude-<uid>` des Hosts bleibt nichts.

Diese Liste: `~/.claude.json`, beschränkt auf Start- und Verwaltungsschlüssel (erster Start, Migrationen, Feature-Flag-Cache, Plugin-Nutzungszähler), dazu seine Sicherungskopien und sein Sperrordner; leere Session- und Markierungsordner unter `~/.claude` und `~/.config/anthropic`; Shell-Snapshots ohne Gesprächsinhalt; npms eigenes Log von `npm root --global` in `~/.npm/_logs`; Buns Cache, wenn das `node` im PATH Bun ist; und auf Hosts ohne Schlüsselbund die Datei zum Auffrischen der Anmeldung. Nie ein Transkript, eine Todo-Liste, ein Dateiverlauf, ein Plan oder ein Prompt-Verlauf.

**Speichertest.** Auf Claude Code und Grok CLI führt die Prüfung die Speicherrichtlinie auch durch das echte Security-Gate. Ein Ordner, der nur in `security.foreignMemoryPaths` eingetragen ist, wird sowohl dem eigenen Datei-Lesen des Modells als auch einem Shell-`cat` verweigert, und ein Schreiben in EYAS' Vault wird abgelehnt. Jede Ablehnung ist genau eine Zeile **Ablehnen** in den Sicherheitsereignissen aus der Speicherrichtlinie (Checkpoint `deterministic`, nie eine Rate-Limit-Sperre) und eine abgelehnte Tool-Zeile. Ein Lesen im Workspace nach diesen Ablehnungen funktioniert weiterhin, und nichts aus dem abgelehnten Ordner erreicht das Modell. Zwei weitere kostenlose Fälle decken Suchen ab: Grep, Glob und `grep -r` von Claude Code sowie grep und list_dir von Grok, jeweils im Home voller Fallen angesetzt, werden von der Speicherrichtlinie über das echte Gate abgelehnt — auditiert, mit einer abgelehnten Tool-Zeile —, während eine Suche im Projektordner weiterhin funktioniert. Ein dritter zeigt, dass Claude Code eine Datei in seinem Arbeitsordner liest, ohne EYAS' Berechtigungsprüfung zu fragen, und dass die Prüfung der Speicherrichtlinie ein solches Lesen ablehnt, wenn es in einem Vault landet.

**Bewiesene Versionen:** Claude Code 2.1.281 und Grok CLI 1.0.41, nur der kostenlose Teil. Kimi Code CLI ist noch nicht bewiesen und hat keinen Speichertest. Zwei Befunde der Prüfung sind in die Startprüfungen eingebaut:

- Claude Code 2.1.281 meldet zwei in das Binary kompilierte Plugins, `agents-md` und `telemetry`. Sie werden nur als `<Name>@builtin` angenommen, weil die Prüfung sie unter EYAS' Isolation als harmlos bewiesen hat: Keine `AGENTS.md` aus dem Arbeitsordner oder einem Unterordner erreicht das Modell. Jedes andere Plugin, auch ein neues eingebautes einer späteren Claude-Code-Version, stoppt den Lauf weiterhin.
- Grok CLI 1.0.41 schreibt einen Cache anbieterverwalteter Einstellungen (`managed_config.toml`) in sein EYAS-Home, bei einem normalen Konto leer. Ein leerer wird angenommen; einer mit irgendeiner Einstellung stoppt den Zug weiterhin.

**`eyas doctor`** zeigt pro CLI-Anbieter eine Zeile: *CLI isolation (Claude Code)*, *CLI isolation (Grok CLI)* und *CLI isolation (Kimi Code CLI)*. Jede nennt das Binary, das EYAS ausführt — wie es gefunden wurde (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, im PATH oder im SDK gebündelt), Pfad und Version — und ob die Release-Prüfung diese Version bewiesen hat. Eine andere Version, ein Binary ohne Versionsangabe oder eine nie bewiesene CLI ist eine Warnung, kein Stopp: EYAS prüft weiterhin jede Session beim Start. Eine nicht installierte CLI ist in Ordnung; ein ungültiges `EYAS_*_BIN` ist ein Fehler. Für Grok und Kimi prüft die Zeile außerdem ihr EYAS-Home, `<Datenordner>/cli-homes/<Anbieter>`: noch nicht angelegt ist in Ordnung; ein symbolischer Link oder kein Ordner ist ein Fehler (EYAS führt die CLI nicht aus; entferne ihn, der nächste Lauf legt ihn neu an); ein Ordner, den andere Benutzer lesen können, ist eine Warnung, weil er die Anmeldung der CLI enthält (`chmod 700 <Ordner>`); eine dort von EYAS verwaltete Datei, die sich seit dem Schreiben durch EYAS geändert hat, ist eine Warnung — EYAS schreibt diese Dateien vor dem nächsten Lauf neu, eine Änderung zwischen zwei Läufen heißt also, dass etwas anderes diesen Ordner bearbeitet. Doctor ändert nichts: Es führt nur `--version` aus. Siehe [CLI](/docs/de/deploy/cli/).

### Speicher eines Anbieters unter Quarantäne stellen {#quarantine-a-providers-memory}

Lief ein Modell — typischerweise eine CLI wie Grok CLI, Kimi CLI oder Claude Code — ohne EYAS' Isolation, hat es womöglich aus Speicher außerhalb von EYAS geantwortet, und seine Antworten wurden wie jeder andere Zug im EYAS-Speicher abgelegt. Der Owner kann vor jedem Modell verbergen, was ein Anbieter geschrieben hat — seine Antworten und Tool-Ausgaben, die daraus abgeleiteten Fakten und Zusammenfassungen sowie die Erfassungsnotizen seiner Gespräche — und es später wieder freigeben. Nichts wird gelöscht, und die eigenen Nachrichten des Owners werden nie angefasst. Die Karte liegt unter **Speicher → Übersicht**; siehe [Speicher — Speicher eines Anbieters unter Quarantäne stellen](/docs/de/knowledge/memory/#quarantine-a-providers-memory). Jedes Anwenden und Freigeben wird ins Audit-Log geschrieben (`memory.quarantine.apply` / `memory.quarantine.release`).

### SSH auf entfernten Knoten {#remote-node-ssh}

**SSH-Invoke** auf entfernten Knoten (über Knoten) führt abgesicherte Befehle aus; **destruktive** Befehlsmuster brauchen ein ausdrückliches Force-Flag. Knotentypen ohne SSH können für Invoke „nicht implementiert“ zurückgeben.

### Speicher im Ruhezustand {#memory-at-rest}

Dauerhafte Notizen maskiert das Datenschutz-Modul **bevor sie auf die Platte kommen**, nicht beim Lesen — eine Schwärzung beim Lesen ließe den Rohtext in der Datei und im FTS-Index. Es ist dieselbe Funktion mit denselben Regeln wie für ausgehenden Modellverkehr: Datumsangaben bleiben erhalten, Werte der Klassen mask und block werden ersetzt — eine IBAN in einer Notiz wird als `[IBAN]` gespeichert (frühere Versionen ersetzten in Notizen nur E-Mail-Adressen und Telefonnummern). Rohaufzeichnung, Gesprächszusammenfassungen und Fakten bleiben innerhalb von EYAS unmaskiert und werden erst maskiert, wenn sie EYAS verlassen. Die Erfassung selbst schaltet `memory.capture.enabled` in `config/default.yaml` (Default **an**). Siehe [Speicher](/docs/de/knowledge/memory/) und [FAQ](/docs/de/reference/faq/).

**Von Modellen geschriebene Notizen durchlaufen den Anweisungsfilter.** Vault-Notizen, die ein Modell schreibt — die Speichererfassung pro Zug, nächtliche Konsolidierungszusammenfassungen und Zusammenfassungen von Team-Sessions —, durchlaufen denselben Filter, den EYAS schon für Fakten und Zusammenfassungen nutzt. Text, der wie eine Anweisung an den Assistenten aussieht (*ignore previous instructions*, *from now on you are…*, gefälschte `<system>`-Tags, *delete all memory*, auf Englisch, Ungarisch, Deutsch, Spanisch und Französisch), wird nie geschrieben. Ablehnungen erscheinen im Server-Log mit dem Namen des Detektors, nie mit dem Text. Jede solche Notiz trägt außerdem ein `origin` im Frontmatter und wird als von einem Modell geschrieben gespeichert, nie als deine eigenen Worte. Siehe [Speicher — Warum manche Sätze abgelehnt werden](/docs/de/knowledge/memory/#why-some-sentences-are-refused).

## Datenschutzrichtlinie {#privacy-policy}

EYAS speichert seine Daten roh und **maskiert personenbezogene Daten, wenn Text EYAS in Richtung eines entfernten Modells verlässt**. Eine einzige deterministische Funktion übernimmt das Maskieren — für Prompts, Ergebnisse der Speicher-Tools, Embeddings und Vault-Notizen gleichermaßen.

### Wie die Erkennung arbeitet {#how-detection-works}

Die Erkennung ist regelbasiert und deterministisch: Derselbe Text ergibt immer dasselbe Ergebnis, und nichts wird je an ein Modell geschickt, um personenbezogene Daten zu erkennen. Sie ist **zeilengebunden** — ein Wert, der über zwei Zeilen verteilt ist, wird nicht erkannt, und ein Telefon- oder Steuerwort zählt nur in derselben Zeile wie die Nummer.

Nie als personenbezogene Daten behandelt: Kalenderdaten in jeder gängigen Schreibweise (`2026-09-08`, `2026.09.30.`, `2026. 09. 30.`, `22.09.2026`, `09/22/2026`), Uhrzeiten, ISO-Zeitstempel, IP-Adressen, Softwareversionen (`1.0.40`, `0.8.29-beta`), Geldbeträge (Dezimalzahlen oder Zahlen neben einer Währung wie HUF/Ft/EUR/€/$) sowie Datensatz-, Ticket-, Build-, Commit- und Zeitstempel-Ids, UUIDs, ULIDs und Hashes. Die Zeile *Current date* des Prompts erreicht jedes Modell unverändert.

### Was erkannt wird {#what-is-detected}

| Typ | Wie er erkannt und geprüft wird |
|-----|---------------------------------|
| `email` | Übliche Adressform |
| `phone` | Eine internationale Nummer mit `+` (8–15 Ziffern); eine Nummer mit Vorwahl in Klammern; das ungarische Inlandsformat (06/36 + Vorwahl + 6–7 Ziffern); oder jede 7- bis 15-stellige Nummer mit einem Telefonwort höchstens 40 Zeichen davor in derselben Zeile. Telefonwörter zählen nur als ganze Wörter: phone, tel, mobile, cell, call, fax, WhatsApp, telefon, mobil, hívj, Handy, Telefonnummer, teléfono, móvil, téléphone, Tél., portable und ähnliche. Locker geschriebene Nummern ohne `+`, Inlandsformat oder Telefonwort werden bewusst nicht erkannt. |
| `iban` | IBANs aller Länder, kompakt oder mit Leerzeichen gruppiert, geprüft mit der offiziellen Mod-97-Prüfsumme und der exakten Länge des Landes (frühere Versionen erkannten nur ungarische IBANs) |
| `bank_account` | Ungarische Giro-Kontonummern, 8-8 oder 8-8-8 Ziffern (Leerzeichen oder Bindestrich), geprüft mit der Blockprüfsumme 9-7-3-1 |
| `credit_card` | 13–19 Ziffern mit einem Kartennetz-Präfix, geprüft mit Luhn |
| `ssn` | US-Sozialversicherungsnummer `AAA-GG-SSSS` mit gültiger Area, Group und Serial |
| `personal_id` | Ungarische Personalausweisnummer (6 Ziffern + 2 Großbuchstaben) als eigenständiges Token |
| `tax_number` | Ungarische Steuernummer (adószám, `12345676-2-42`) mit gültiger Prüfziffer, MwSt.-Code 1–5 und echtem Komitatscode; ungarische EU-USt-IdNr. (`HU12345676`); und die ungarische persönliche Steuer-ID (adóazonosító jel, 10 Ziffern, beginnt mit 8) nur mit gültiger Prüfziffer **und** einem Steuer-ID-Wort davor (adóazonosító, adószám, tax ID, TIN, Steuer-ID, NIF, numéro fiscal, …). Wörter zählen nur als ganze Wörter: `tin` in *routine* oder `tax` in *syntax* löst nichts aus, und eine beliebige 10-stellige Zahl neben dem Wort *tax* ist keine Steuernummer. |
| `taj_number` | Ungarische TAJ-Nummer, geprüft mit ihrer Prüfziffer |

Namen und Postanschriften werden nicht erkannt. Nutze dafür und für jede andere organisationsspezifische Kennung [eigene Muster](#custom-patterns).

Es gibt keinen modellbasierten Scanner. Der frühere NER-Scanner, der Prompt-Text stillschweigend an ein lokales Ollama schickte, ist entfernt; steht `ner` noch unter `privacy.scanners` in `config/personality/privacy.yaml`, wird es ignoriert und eine Warnung geloggt.

### Aktionen {#actions}

Jeder erkannte Typ hat genau eine Aktion:

| Aktion | Wirkung |
|--------|---------|
| `off` | Ignoriert |
| `warn` | Gezählt und geloggt; der Text bleibt, wie er ist |
| `mask` | Durch einen Platzhalter wie `[EMAIL]` oder `[IBAN]` ersetzt, wenn der Text EYAS in Richtung eines entfernten Modells verlässt |
| `block` | Auf dem Weg hinaus genauso maskiert; außerdem wird eine **neue** Chat- oder Kanal-Nachricht, die einen solchen Wert trägt, vor dem Speichern abgelehnt, wenn sie an ein entferntes Modell ginge (siehe [Abgelehnte Nachrichten](#refused-messages)) |

Eingebaute Defaults: `email` und `phone` sind **mask**; `iban`, `bank_account`, `tax_number`, `personal_id`, `credit_card` und `ssn` sind **block**; `taj_number` ist **warn**.

**Maskieren stoppt nie einen Modellaufruf.** Ein Wert der Klasse block irgendwo im Prompt — etwa eine IBAN in einer Speicher-Notiz — wird maskiert, und die Runde läuft weiter; auch Memory-Capture scheitert an solchen Runden nicht. `block` hat genau eine weitere Wirkung: Es lehnt eine **neue** Nachricht ab, die du sendest.

### Abgelehnte Nachrichten {#refused-messages}

Nur eine **neue** Nachricht, die ein User sendet — im Chat, in einem God-Modus-Gespräch oder über einen Kanal (Telegram, Slack, Discord, E-Mail, WhatsApp, Signal, …) —, kann abgelehnt werden. Alles andere, was EYAS an ein Modell schickt (Verlauf, Speicher, Tool-Ergebnisse, extrahierter Text von Anhängen, Embeddings), wird nie abgelehnt; es wird auf dem Weg hinaus maskiert.

Eine Nachricht wird abgelehnt, wenn sie einen Wert der Klasse block enthält **und** an ein entferntes Modell ginge. Lokal heißt: Der Endpunkt-Host des Modells ist Loopback (`localhost`, `127.x`, `::1`) oder steht in den lokalen Hosts der Richtlinie; CLI-Anbieter (Claude Code, Grok CLI, Kimi CLI) und unbekannte Endpunkte gelten als entfernt. Ziel ist das Modell, auf dem die Nachricht laufen wird (eine Modellüberschreibung für einen Zug, das feste Modell des Gesprächs oder das Modell seines Kollegen). Ein auf Auto gesetztes Gespräch gilt immer als entfernt, weil sein Modell erst nach der Prüfung pro Nachricht gewählt wird — außer das Auto-Routing ist global ausgeschaltet; dann wird sein gespeichertes Modell beurteilt. Im God-Modus wird jeder Teilnehmer des Kaders beurteilt; ist einer entfernt oder ist der Kader leer, wird die Nachricht abgelehnt. Ist die Richtlinie oder das Datenschutzmodul aus, wird nichts abgelehnt.

- **Im Chat** wird die abgelehnte Nachricht nicht gespeichert: kein Eintrag im Transkript, keine Umbenennung, kein Speicher, kein Modellaufruf, kein God-Modus-Rennen. Eine Karte über dem Composer, **Nachricht nicht gesendet — Datenschutz**, listet die Typen (nie die Werte) und bietet **Mit maskierten Angaben senden**, **Nachricht bearbeiten** und **Verwerfen**. Siehe [Gespräche — Abgelehnte Nachrichten](/docs/de/daily/conversations/#refused-messages-privacy).
- **Auf einem Kanal** bekommt der Absender eine automatische Antwort in der Sprache, in der er geschrieben hat (Englisch, Ungarisch, Deutsch, Spanisch, Französisch oder Klingonisch; Englisch, wenn unklar), die die Typen nennt, nie die Werte, und darum bittet, ohne diese Werte erneut zu senden. Es entsteht kein Gespräch, keine Nachricht und kein Agentenlauf; das eingehende Ereignis zeigt den Status **übersprungen** mit dem Fehler `privacy_blocked`, und nur sein maskierter Text bleibt erhalten. Siehe [Kanäle](/docs/de/communication/channels/#refused-messages).
- Nachrichten, die vor einer Änderung der Richtlinie schon gespeichert waren, werden nachträglich nicht abgelehnt.

Jede Ablehnung schreibt die Audit-Aktion `privacy.inbound_refused`, jedes *maskiert senden* schreibt `privacy.inbound_masked`; beide halten die Typen, das Gespräch (Chat) oder die ID des eingehenden Ereignisses (Kanäle) und den User fest — nie einen Wert.

### Eigene Muster {#custom-patterns}

Jedes eigene Muster hat einen `name`, eine `regex`, einen `type`-Slug in Kleinbuchstaben, der zum Platzhalter wird (etwa `[INTERNAL_PROJECT]`), und eine eigene `action`. Du legst sie auf der [Datenschutz-Seite](#privacy) an (bis zu 50); bei Mustern mit gleichem Typ gilt die Aktion des ersten Musters. Muster sind zeilengebunden: Sie treffen nie über einen Zeilenumbruch hinweg, und `^` / `$` verankern am Anfang und Ende einer Zeile. Ein unsicheres Muster (katastrophales Backtracking) oder eines, das nicht kompiliert, wird übersprungen und im Server-Log gemeldet. Ein Muster, das einen leeren String treffen kann, lässt den Scanner nicht mehr hängen.

### Lokale Hosts: wer Text unmaskiert bekommt {#local-hosts-who-receives-text-unmasked}

Text geht nur unmaskiert hinaus, wenn der Modell-Endpunkt auf dieser Maschine liegt: ein Loopback-Endpunkt (`localhost`, `127.x.x.x`, `::1`) oder ein Host aus den **lokalen Hosts** der Richtlinie (bis zu 32 Hostnamen oder IP-Adressen, ohne Schema oder Port). Entscheidend ist der Endpunkt-Host, an den der Anbieter sendet — nie der Name des Anbieters:

- Ein lokales Ollama oder LM Studio ist ausgenommen; ein **entferntes `OLLAMA_HOST` wird maskiert**. Hast du dich für einen entfernten Ollama-Host auf die alte Ollama-Ausnahme verlassen, trag diesen Host bei den lokalen Hosts ein.
- Nicht eingetragene LAN-Hosts, Cloud-APIs, unbekannte Endpunkte und jeder CLI-Anbieter (Claude Code, Grok CLI, Kimi CLI) gelten als entfernt — EYAS kann nicht sehen, wohin eine CLI ihren Verkehr schickt.
- Die alte Aktion `auto_local` (Umleiten an ein lokales Ollama) gibt es nicht mehr; eine alte `auto_local`-Regel wird als `mask` behandelt, mit einer Warnung im Log.

### Gespeicherte Completions (OpenAI) {#stored-completions-openai}

Anfragen an den eingebauten **OpenAI**-Anbieter widersprechen OpenAIs *Stored Completions* ausdrücklich, bei Chat, Streaming und Tool-Aufrufen gleichermaßen. OpenAI behält EYAS-Gespräche daher nicht für seine Destillations- oder Evaluationsfunktionen, selbst wenn *store completions* in deinem OpenAI-Konto oder -Projekt eingeschaltet ist. Es muss nichts konfiguriert werden. Das gilt auch, wenn `OPENAI_BASE_URL` den eingebauten OpenAI-Anbieter umleitet. OpenAI-kompatible Anbieter (xAI, Mistral, Groq, DeepSeek und der Rest des kompatiblen Katalogs, OpenRouter, Kimi API, LM Studio) bekommen das Flag nicht, weil manche dieser Dienste unbekannte Parameter ablehnen; was sie aufbewahren, bestimmen ihre eigenen Kontoeinstellungen und Bedingungen. Embeddings sind nicht betroffen.

### Wo maskiert wird {#where-masking-applies}

Maskiert wird im Model-Gateway bei **jedem Versuch, für den Anbieter, der tatsächlich antwortet**. Wird ein Aufruf wiederholt oder fällt er auf den Fallback-Anbieter einer Stufe zurück, wird jeder Versuch für sein eigenes Ziel maskiert: Ein lokales Ollama als Primary bekommt den Rohtext, und wenn es scheitert und der Aufruf auf einen Cloud-Fallback wechselt, bekommt der Cloud-Anbieter den maskierten Text. Auch die schnelle Routing-Prüfung vor einer Chat-Runde wird maskiert.

Für ein entferntes Ziel maskiert EYAS:

- den System-Prompt, Abschnitt für Abschnitt: Speicher, Persona- und Agentendateien, Projektkontext, Skills, Designs und jeden Text, den EYAS keinem Abschnitt zuordnen kann;
- den Gesprächsverlauf;
- die Ergebnisse der EYAS-Speicher-Tools, auch ihre Fehlertexte: `memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`;
- Texte, die an einen entfernten Embedding-Anbieter gehen.

Nicht maskiert:

- die Abschnitte, die EYAS selbst schreibt — Identität, Kernregeln, der Laufzeitblock mit Datum und Uhrzeit, Arbeitsordner, die Tool-, Skill- und Agentenlisten, die Orchestrierungsanweisung —, damit das Modell das heutige Datum und seine Ordner immer wörtlich liest;
- Ergebnisse der Workspace-Tools (Dateien, Shell, Git, Grep, Browser, Dokumente, Codesuche). CLI-eigene Tools lassen sich ohnehin nicht maskieren, und Maskieren würde Platzhalter wie `[EMAIL]` zurück in Dateien schreiben, die das Modell bearbeitet.

Derselbe Speicher-Eintrag wird gleich maskiert, ob EYAS ihn in den Prompt legt oder das Modell ihn mit einem Speicher-Tool holt — es ist dieselbe Funktion. Das gilt auf **jedem Weg**, auf dem ein Modell EYAS-Speicher lesen kann:

- Anbieter, deren Tool-Schleife in EYAS läuft (API- und lokale Anbieter);
- die prozessinternen EYAS-Tools von Claude Code (`mcp__eyas__*`);
- Grok CLI und Kimi CLI über EYAS' MCP-Bridge;
- externe MCP-Clients, die EYAS' eigenen MCP-Server aufrufen (`POST /api/v1/mcp/tools/call`);
- der OpenCode-Sidecar: Der Aufgaben-Prompt von `opencode_run` und der als Systemtext mitgeschickte abgerufene Speicher werden maskiert, bevor sie OpenCode erreichen (der Titel der OpenCode-Session entsteht aus dem maskierten Prompt), und ebenso die Antworten von `memory_search` / `memory_expand` in OpenCode.

Eine CLI, ein externer MCP-Client und OpenCode gelten immer als entfernt, weil sie jedes Modell ausführen können: Nichts in einer Anfrage kann sie lokal machen, und die Liste der lokalen Hosts nimmt sie nicht aus. Werte der Klassen mask und block werden durch `[TYPE]`-Platzhalter ersetzt; Datumsangaben, Uhrzeiten, Ids, Zahlen und die JSON-Struktur bleiben erhalten.

**Geschlossenes Scheitern.** Scheitert der Datenschutz-Scan selbst, wird das Speicher-Tool-Ergebnis nicht gesendet: Das Modell bekommt *Error: memory tool result withheld (privacy scan failed)*, und eine OpenCode-Aufgabe scheitert mit *privacy scan failed — the task was not sent to OpenCode* — nichts erreicht OpenCode. Das Log hält nur Typen, Anzahlen und Identität fest (Gespräch, Lauf, Agent, Zug, Tool, Transportweg), nie einen Wert: *Privacy: masked values in a tool result sent past the model gateway* bzw. *warn-class values in a tool result sent past the model gateway*.

Eine Änderung der Richtlinie wirkt ab der nächsten Runde. Eine bereits laufende Runde behält die Richtlinie, mit der sie begann, damit eine Tool-Schleife einheitlich maskiert wird.

### Wo die Richtlinie liegt {#where-the-policy-lives}

Die Richtlinie wird in der EYAS-Datenbank gespeichert. `config/personality/privacy.yaml` ist ihre Vorlage: Die Datei wird bei jeder Änderung automatisch neu eingelesen, ohne Neustart, bis die Richtlinie zum ersten Mal auf der [Datenschutz-Seite](#privacy) gespeichert wird. Danach gilt die gespeicherte Richtlinie, und Änderungen an der Datei werden mit einer Warnung im Log ignoriert.

Eine fehlende oder ungültige `privacy.yaml` fällt nicht mehr stillschweigend auf Defaults zurück: Der Fehler wird mit dem vollständigen Pfad der Datei und den Gründen geloggt, und die letzte gültige Richtlinie bleibt in Kraft. Bei einer Erstinstallation ohne lesbare Datei gelten die eingebauten Defaults.

Das alte Format (`scanners` / `rules` / `custom_patterns`) wird weiter angenommen:

- Pro Typ entscheidet die erste passende Regel; ein Typ, auf den keine Regel passt, ist `warn`.
- `sanitize` wird zu `mask`; `auto_local` wird mit einer Warnung zu `mask`; `ner` wird mit einer Warnung ignoriert.
- Ein Scanner, der in `scanners` fehlt, schaltet seine Treffer ab.
- Unbrauchbare Regeln oder Muster werden mit einer Warnung verworfen.

**Audit.** Mit eingeschaltetem `audit` schreibt jeder Modellaufruf, der etwas maskiert (oder davor gewarnt) hat, **einen** Audit-Eintrag mit der Aktion `privacy.egress`, bezogen auf das Gespräch. Er ersetzt die alten `privacy.detected`-Einträge (einer pro Treffer), die nicht mehr geschrieben werden. Der Eintrag listet die Ids von Gespräch, Lauf, Agent und Zusammenstellung (bzw. Zug); den Anbieter; das Ziel (entfernt); den Transportweg (`gateway`, `embed`, `mcp-bridge`, `mcp-external`, `opencode`); die Richtlinienversion; die Anzahl maskierter und gewarnter Werte; Anzahlen pro Typ; die beteiligten Prompt-Abschnitte (`unattributed` = Systemtext außerhalb der aufgezeichneten Abschnitte); die Anzahl der Treffer im Gesprächsverlauf; und die beteiligten Speicher-Tools. Ein Speicher-Tool-Ergebnis, das am Gateway vorbei gesendet wird, bekommt einen eigenen Eintrag. Erkannte Werte werden nie geloggt oder gespeichert. Richtlinienänderungen werden immer als `privacy.policy.updated` auditiert (Version, Quelle, geänderte Typen und der User, der gespeichert hat — nie Werte). Die Log-Zeilen lauten *Privacy: masked values in outgoing model traffic* bzw. *warn-class values in outgoing model traffic* und nennen jetzt auch Gespräch, Zusammenstellung, Abschnitte und Tools. Der Kontext-Inspektor zeigt pro Prompt-Abschnitt, was maskiert wurde — siehe [Gespräche — Kontext-Zusammenstellung](/docs/de/daily/conversations/#context-composition).

**Upgrade.** Nichts zu tun: Bestehende `privacy.yaml`-Dateien im alten Format funktionieren weiter, und eine bestehende `privacy.yaml` liefert die Vorlage der Richtlinie, bis sie zum ersten Mal auf der Seite gespeichert wird. Text, den der alte Scanner mit einem durch `[PHONE]` ersetzten Datum gespeichert hat — etwa in einer Vault-Notiz —, wird nicht automatisch repariert, weil der ursprüngliche Wert verloren ist; ein erneuter Import aus der Quelle stellt ihn wieder her.

## Felder und Steuerelemente

### Sicherheitsereignisse (`/security`) {#security-events}

Untertitel: *Tool-Ausführungsentscheidungen und Sicherheitsprotokoll.*

Die Seite beginnt mit der Karte **Speicher außerhalb von EYAS** (Owner und Admins) — siehe [oben](#memory-outside-eyas-card).

| Steuerung | Bedeutung |
|-----------|-----------|
| Statistik | **Ereignisse gesamt**, **Ablehnungsrate**, **Am häufigsten blockierte Tools** |
| Entscheidungsfilter | **Alle / Zulassen / Ablehnen / Eskalieren** |
| Risikofilter | **Alle / niedrig / mittel / hoch / kritisch** |
| Checkpoint-Filter | Freitext (*Checkpoint filtern…*) — `deterministic` für Pfad-Ablehnungen wie Speicher außerhalb von EYAS |
| Spalten | Zeitstempel, Tool, Entscheidung, Checkpoint, Risiko, Agent, Grund |

Leer: *Keine Sicherheitsereignisse gefunden.*

### Audit (`/audit`) {#audit}

Untertitel: *Aktionsprotokollierung, Snapshots und Rollback-Verfolgung.*

| Steuerung | Bedeutung |
|-----------|-----------|
| Statistik | **Einträge gesamt**, **Aktionen / Tag**, **Top-Modul**, **Gesamtkosten** |
| Filter | **Aktion**, **Modul**, **Von**, **Bis** |
| Spalten | Zeitstempel, Benutzer, Aktion, Modul, Ziel, Ergebnis, Kosten |
| **Rollback** | Aus einem Snapshot wiederherstellen (mit Bestätigung) |

Ergebnisse: **erfolgreich / Fehler / abgelehnt / zurückgerollt**.

### Datenschutz (`/privacy`) {#privacy}

Die Seite hat drei Teile. (Vor dieser Version wurde jeder Aufruf der Datenschutz-API als nicht angemeldet abgelehnt, sodass die Seite zum Login-Bildschirm zurückspringen konnte; das ist behoben.)

**1. Statistik** (oben auf der Seite). Zähler des echten Verkehrs seit dem Serverstart — im Speicher gehalten, ein Neustart setzt sie also zurück; *Seit dem Serverstart: &lt;Zeit&gt;* zeigt, wann sie begannen, und **Aktualisieren** lädt sie neu. Läufe des Scan-Tests werden nie gezählt.

| Zähler | Bedeutung |
|--------|-----------|
| **Geprüfte entfernte Aufrufe** | Ausgehende Nutzlasten, die für ein entferntes Ziel geprüft wurden: jeder Versuch eines Modellaufrufs (Wiederholungen und Fallback-Sprünge zwischen Stufen zählen einzeln), Embeddings an einen entfernten Embedder und Speicher-Tool-Ergebnisse, die am Gateway vorbei gehen (Bridges von Claude Code / Grok / Kimi, externe MCP-Clients, der OpenCode-Sidecar). Aufrufe an ein lokales Ziel werden weder geprüft noch gezählt |
| **Aufrufe mit maskierten Werten** | Wie viele davon mindestens einen ersetzten Wert hatten |
| **Abgelehnte Nachrichten** | Neue Chat-, God-Modus- und Kanal-Nachrichten, die wegen eines Werts der Klasse block abgelehnt wurden |
| **Auf Wunsch maskiert gesendet** | Abgelehnte Chat-Nachrichten, die der Absender danach mit **Mit maskierten Angaben senden** geschickt hat |
| **Erkannte PII-Typen** | Treffer pro Typ, dazu *Treffer pro Scanner* (regex / custom) |

**2. Editor der Datenschutzrichtlinie.** Ein Kopf mit der Version der Richtlinie (*Version N*) und ihrer Herkunft: *Aus config/personality/privacy.yaml importiert …* (bei jeder Änderung der Datei neu eingelesen, bis du hier speicherst), *Wird auf dieser Seite verwaltet. Änderungen an privacy.yaml werden ignoriert.* oder *Eingebaute Standardwerte: privacy.yaml konnte nicht gelesen werden.* Solange die Richtlinie noch aus der Datei kommt, zeigt ein rotes Banner *Problem mit privacy.yaml: &lt;Fehler&gt;* eine fehlende oder ungültige Datei samt vollständigem Pfad.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Datenschutzrichtlinie aktiv** | Aus: Es wird nichts erkannt, maskiert oder abgelehnt |
| **Audit** | Jeden Modellaufruf und jedes Speicher-Tool-Ergebnis mit maskierten oder gewarnten Werten im Audit-Log festhalten (Typen und Anzahlen, nie die Werte). Richtlinienänderungen werden immer auditiert |
| **Aktion pro Typ** | Eine Legende der vier Aktionen (**Aus**, **Warnen**, **Maskieren**, **Blockieren**, jeweils erklärt) und eine Zeile pro eingebautem Typ (`email`, `phone`, `iban`, `bank_account`, `credit_card`, `ssn`, `personal_id`, `tax_number`, `taj_number`) mit Namen, einer einzeiligen Beschreibung dessen, was erkannt wird, und einer Aktionsauswahl |
| **Eigene Muster** | Zeilen aus **Name**, **Regulärer Ausdruck**, **Typ** (ein Slug in Kleinbuchstaben wie `project_code`; in Großbuchstaben wird er zum Platzhalter, z. B. `[PROJECT_CODE]`) und **Aktion**; **Muster hinzufügen** / **Muster entfernen**; bis zu 50. Muster treffen zeilenweise; bei Mustern mit gleichem Typ gilt die Aktion des ersten. Ein unsicherer (katastrophales Backtracking) oder ungültiger regulärer Ausdruck wird beim Speichern abgelehnt, mit dem Grund unter dem Feld |
| **Lokale Hosts** | Hostnamen oder IP-Adressen (ohne Schema, Port oder Pfad; bis zu 32), deren Modell-Endpunkte Text unmaskiert bekommen, wie localhost. Ungültige Eingaben werden vor dem Speichern abgelehnt |
| **Richtlinie speichern** / **Änderungen verwerfen** | Mit einer Markierung *Ungespeicherte Änderungen*. Speichern ersetzt die ganze Richtlinie und legt sie in der Datenbank ab; ab dann wird die Richtlinie auf dieser Seite verwaltet, und Änderungen an `privacy.yaml` werden ignoriert (mit einer Warnung im Log). Sie gilt ab dem nächsten Modellaufruf — eine bereits laufende Runde behält die Richtlinie, mit der sie begann. Lehnt der Server die Richtlinie ab, ändert sich nichts, und jedes Problem wird an seinem Feld angezeigt |

Nur der Owner kann die Richtlinie ändern. Admins sehen sie nur lesend, mit *Du kannst die Richtlinie ansehen. Ändern und den Scan-Test nutzen kann nur der Eigentümer.* Ein Operator kann alles ausschalten; diese Änderung wird auditiert.

**3. PII-Scanner testen** (nur Owner). Bis zu 100.000 Zeichen einfügen und **Text prüfen**. Der Test nutzt immer die **gespeicherte** Richtlinie (ein Hinweis erscheint, solange der Editor ungespeicherte Änderungen hat). Ergebnisse: das Urteil für eine neue Nachricht — *Eine neue Nachricht mit diesem Text würde abgelehnt: &lt;Typen&gt;.* oder *Eine neue Nachricht mit diesem Text würde angenommen.*; jeder Treffer mit Typ, Position, Scanner und Aktion; und **So erhält es ein entferntes Modell** — der Text mit ersetzten Werten der Klassen mask und block (Werte der Klasse warn bleiben). *Die Datenschutzrichtlinie ist aus: Es wird nichts erkannt.*, wenn die Richtlinie ausgeschaltet ist.

**API (Integratoren).**

- `GET /api/v1/privacy/policy` (Owner und Admin) → `{policy: {enabled, actions, customPatterns, localHosts, audit}, version, source ('yaml'|'ui'|'defaults'), seedError, updatedAt, rulesetVersion, builtinTypes, actions, limits: {customPatterns: 50, localHosts: 32}, canManage}`.
- `PUT /api/v1/privacy/policy` (Owner) — der Body ist die ganze Richtlinie (fehlende Felder bekommen ihre Defaults; unbekannte Keys werden abgelehnt) → dieselbe Form wie `GET` oder `400 {code: 'invalid_policy', issues: [{path, code, message}]}`, ohne dass sich etwas ändert (Codes u. a. `unsafeRegex`, `invalidRegex`, `invalidHost`, `invalid_enum_value`, `too_big`, `unrecognized_keys`).
- `POST /api/v1/privacy/scan` (Owner; `text` nicht leer, höchstens 100.000 Zeichen) → `{enabled, rulesetVersion, matches: [{type, start, end, scanner, action, value: '***'}], inbound: {refused, types}, egressPreview}`. Die Felder `blocked`, `blockedTypes`, `warnings`, `sanitizedText` und `confidence` sind entfallen. Nicht in der Statistik gezählt.
- `GET /api/v1/privacy/stats` (Owner und Admin) → `{since, egress: {calls, maskedCalls, byType}, inbound: {checked, refused, masked}, byScanner}`; `totalScans`, `totalDetections`, `detectionsByType`, `detectionsByScanner` und `detectionsByAction` sind entfallen.
- `/api/v1/privacy/*` verlangt bei ändernden Aufrufen mit Session-Cookie den Header `X-Eyas-Request`, wie die anderen Admin-APIs (die Web-UI sendet ihn; API-Schlüssel und Bearer-Tokens sind nicht betroffen).

## Verwandt

- [Autonomie](/docs/de/agents/autonomy/)
- [Benutzer](/docs/de/admin/users/)
- [Werkzeuge](/docs/de/automation/tools/)
- [Observability](/docs/de/admin/observability/)
- [Knoten](/docs/de/admin/nodes/)
- [Speicher](/docs/de/knowledge/memory/)
- [OpenCode](/docs/de/automation/opencode/)
- [CLI](/docs/de/deploy/cli/)
