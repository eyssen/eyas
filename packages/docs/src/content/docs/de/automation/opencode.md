---
title: OpenCode
description: Optionaler MIT-Coding-Engine-Sidecar mit Live-Webterminal in der Unterhaltung — isoliert in einem EYAS-eigenen Ordner.
---

**Wozu das gut ist.** OpenCode ist ein Terminal-Coding-Agent (MIT, [opencode.ai](https://opencode.ai)). EYAS importiert **nicht** den privaten Kern und nicht dessen AI-SDKs. Offizieller Embed: lokaler HTTP-Server (`opencode serve` auf 127.0.0.1) plus POSIX-PTY nach xterm.js. Der Chat schickt EYAS' abgerufenen Speicher mit der Aufgabe, dann führt `opencode_run` sie aus. Du kannst im Gesprächsterminal zusehen oder übernehmen. Jeder OpenCode-Prozess, den EYAS startet, läuft in einem EYAS-eigenen Ordner, nicht in deinem alltäglichen OpenCode-Setup.

**Route:** `/opencode`. Seitenleiste: **KI → OpenCode**. In der Unterhaltung das Terminal-Icon in der Kopfzeile.

## Wann du es brauchst

- Eine Coding-Aufgabe soll in OpenCodes eigener Schleife laufen, nicht als Stapel von EYAS-`write_file`-Aufrufen.
- Du willst die TUI **sehen** oder hineintippen.
- OpenCode soll im EYAS-Speicher mit denselben `memory_search` / `memory_expand` nachschlagen wie jedes andere Modell — nur lesend, auf das Projekt des Gesprächs beschränkt.
- Delegierte OpenCode-Aufgaben sollen ein bestimmtes Modell und eine bestimmte Reasoning-Variante nutzen (Karte **Modell und Reasoning**).

## Typischer Ablauf

1. **OpenCode** (`/opencode`) öffnen. Steht dort **Nicht bereit**, die CLI installieren (`curl -fsSL https://opencode.ai/install | bash` oder `npm i -g opencode-ai`) oder `EYAS_OPENCODE_BIN` setzen.
2. OpenCode **für EYAS** anmelden: Gespräch öffnen, Terminal-Icon klicken und im OpenCode-Terminal `/connect` nutzen (siehe [Anmeldung](#sign-in)).
3. `opencode_status` / `opencode_run` am Agenten erlauben, der delegieren soll. Das funktioniert bei jedem Anbieter: Auch CLI-Modelle (Claude Code, Grok, Kimi) erreichen diese Werkzeuge über die EYAS-Brücke. Optional Modell und Reasoning-Variante auf der Karte **Modell und Reasoning** wählen.
4. Den Kollegen in einem Gespräch `opencode_run` aufrufen lassen. EYAS schickt die Aufgabe mit ihrem abgerufenen Speicher; OpenCode fragt EYAS vor jedem Tool-Aufruf; Antwort und Diffs kommen als Ergebnis von `opencode_run` zurück.

## Funktionen

| Teil | Was es tut |
|------|------------|
| Doctor | Fail-closed: fehlende CLI oder PTY liefert eine Abhilfe, nie einen Absturz |
| `opencode_status` | Grün. Bereit / nicht bereit + Checks |
| `opencode_run` | Rot, Freigabe. Läuft nur innerhalb eines Gesprächs. HTTP-Session gegen den Sidecar; jeder Tool-Aufruf darin fragt das EYAS-Security-Gate |
| Webterminal | `@xterm/xterm` über `/api/v1/opencode/terminal/:id` (JWT). Trennen beendet die PTY |
| Speicher-Plugin | `memory_search` / `memory_expand` in OpenCode — dieselben Namen, Beschreibungen und Argumente wie in jedem anderen EYAS-Lauf, nur lesend. Nichts in OpenCode kann EYAS-Speicher schreiben |
| Isolation | Immer an: ein EYAS-eigener Ordner, `<EYAS-Datenverzeichnis>/cli-homes/opencode` — siehe unten |

### Isolation {#isolation}

Jeder OpenCode-Prozess, den EYAS startet — der Hintergrund-Server für Chat-Aufgaben und das OpenCode-Terminal in einem Gespräch —, läuft in `<EYAS-Datenverzeichnis>/cli-homes/opencode`. Es gibt keinen An/Aus-Schalter: Die frühere Einstellung *isolated config* ist entfernt, ein früher gespeicherter Wert wird ignoriert.

| Bereich | Bedeutung |
|---------|-----------|
| **Gehört EYAS** | Die Konfiguration von OpenCode (`config/opencode/opencode.json`, von EYAS geschrieben, lädt nur das EYAS-Speicher-Plugin, `config/opencode/eyas/eyas-memory.ts`), Daten (inklusive der Anmeldung, `data/opencode/auth.json`, und der OpenCode-Sessions), Zustand und Cache (inklusive npm-Cache). Das `HOME` von OpenCode ist derselbe Ordner. |
| **Nicht geladen** | Host-`~/.claude/CLAUDE.md`, `~/.claude`-Skills und der Rest von OpenCodes Claude-Code-Kompatibilität; `~/.agents` und andere externe Skills; die eigene `opencode.json`, der `.opencode`-Ordner, `AGENTS.md`, `CLAUDE.md` und `CONTEXT.md` des Projekts; das alltägliche `~/.config/opencode` und `~/.local/share/opencode`; Provider-API-Schlüssel aus der Server-Umgebung (etwa `OPENAI_API_KEY`). |
| **Aus** | Auto-Update und Session-Sharing. |
| **Shell** | OpenCodes eigenes Shell-Werkzeug sieht den EYAS-Ordner als Home-Verzeichnis, deine `~/.gitconfig` und SSH-Schlüssel sind für es also nicht sichtbar. |

Der Hintergrund-Server lauscht auf 127.0.0.1 und ist bei jedem Start mit einem frischen Zufallspasswort geschützt.

**Wo das Speicher-Plugin liegt.** Das EYAS-Speicher-Plugin wird nach `<EYAS-Datenverzeichnis>/cli-homes/opencode/config/opencode/eyas/eyas-memory.ts` geschrieben, neben den Ordner `node_modules`, in den OpenCode die Abhängigkeit `@opencode-ai/plugin` des Plugins installiert, und die verwaltete `opencode.json` verweist darauf. Frühere Versionen schrieben es nach `…/cli-homes/opencode/plugins/eyas-memory.ts`, wo OpenCode 1.18.29 diesen Import nicht auflösen konnte und das Plugin ohne Fehlermeldung übersprang — OpenCodes Modell hatte dann kein `memory_search` / `memory_expand`, und der Shell-Hook des Plugins lief nie. EYAS löscht die alte Kopie beim nächsten Start. Wie bisher braucht der erste Start von OpenCode Zugriff auf die npm-Registry, um die Abhängigkeit des Plugins zu installieren; ohne ihn läuft OpenCode ohne die EYAS-Speicher-Werkzeuge.

### Anmeldung {#sign-in}

OpenCode meldet sich selbst bei seinen Modellanbietern an; EYAS reicht keine API-Schlüssel in diesen Prozess. Die Anmeldung liegt jetzt im EYAS-Ordner, daher werden **bestehende OpenCode-Nutzer einmal abgemeldet**. Öffne das OpenCode-Terminal eines Gesprächs und nutze `/connect`. Nutze nicht `opencode auth login` in einem einfachen Shell-Terminal: Diese Shell nutzt deine normale Umgebung und würde dein alltägliches OpenCode anmelden, nicht das von EYAS.

### Headless-Aufgaben fragen EYAS {#headless-tasks-ask-eyas}

`opencode_run`-Aufgaben fragen EYAS vor jedem Tool-Aufruf: Datei lesen und bearbeiten, auflisten und suchen, Shell-Befehle, Web-Abruf und -Suche, Zugriff auf Ordner außerhalb des Aufgabenordners, Subagenten, LSP und Skills.

- EYAS beantwortet jede Anfrage mit seinem [Security-Gate](/docs/de/admin/security-privacy/), demselben wie für die anderen Assistenten. Erlaubte Aufrufe laufen einmal; verweigerte werden abgelehnt.
- Will das Gate eine menschliche Entscheidung, wird der Aufruf abgelehnt und eine Freigabe in [Ausstehende Freigaben](/docs/de/agents/autonomy/) eingereiht.
- Ist das Security-Gate nicht verfügbar, wird jede Anfrage abgelehnt.
- EYAS antwortet nur für die Aufgabe, die es gestartet hat, einschließlich der Subagenten, die diese Aufgabe startet. Im OpenCode-Terminal gibst du Tool-Aufrufe selbst frei.
- Nach einer Aufgabe löscht EYAS die OpenCode-Session. Antwort und Diffs bleiben als Ergebnis von `opencode_run` im Gespräch.

**Aufgabenordner.** `opencode_run` läuft nur innerhalb eines Gesprächs und lehnt überall sonst ab. Der Ordner, den du nennst, muss innerhalb der Ordner des Gesprächs liegen. Ohne Angabe nutzt EYAS den ersten Gesprächsordner, sonst den eigenen Workspace des Gesprächs — nie den EYAS-Installationsordner. Das OpenCode-Terminal fällt genauso auf den Gesprächs-Workspace zurück. Seine Ordner durchlaufen dieselbe Prüfung wie die jedes anderen Laufs: Ein Ordner, der ein geschützter Ort ist, in einem liegt oder einen enthält (EYAS' eigene Daten, der Speicher eines anderen KI-Werkzeugs, ein Notiz-Vault oder dein Home-Ordner), wird ausgelassen, das Terminal öffnet sich im nächsten erlaubten Ordner oder im Gesprächs-Workspace, und eine Zeile oben im Terminal nennt den ausgelassenen Ordner.

### Speicher, der mit einer Aufgabe mitgeht {#memory-sent-with-a-task}

`opencode_run` schickt EYAS' Abrufblock — denselben, den jeder andere Lauf bekommt — als Systemtext der Aufgabe. Er ist bemessen wie der Abruf jedes anderen Modells: `memory.index.budgetChars` (standardmäßig 2.400 Zeichen) ist die Größe bei einem Kontextfenster von 100k Tokens, und der Block wächst mit dem Fenster des Modells, das OpenCode ausführt, bis zum 2,5-Fachen ab 250k Tokens (standardmäßig 6.000 Zeichen); unter etwa 29k Tokens schrumpft er, und ein sehr kleines Fenster bekommt gar keinen abgerufenen Speicher. EYAS liest das Fenster aus OpenCodes eigener Modellliste — das Eingabelimit des Modells, wenn OpenCode eines listet, sonst sein Kontextlimit. Ist das Fenster unbekannt, ist der Block genau `memory.index.budgetChars`: Auf der Karte **Modell und Reasoning** ist kein Modell gewählt (OpenCode nutzt dann sein eigenes Default-Modell, das EYAS erst aus der Antwort erfährt); das gewählte Modell steht nicht in OpenCodes Liste oder ist ohne Limit gelistet (etwa ein Modell eines eigenen Anbieters ohne `limit` in seiner OpenCode-Konfiguration); oder die Liste lässt sich nicht lesen (eine Warnung wird geloggt, und die Aufgabe läuft trotzdem). Die Liste wird höchstens einmal pro Aufgabe gelesen, nur wenn ein Modell gewählt ist, und die Anfrage trägt nichts von der Aufgabe. Früher bekamen OpenCode-Aufgaben immer genau `memory.index.budgetChars`, ein Modell mit großem Fenster bekam also weniger Speicher, als jeder andere Anbieter ihm gegeben hätte. Der Block trägt denselben Hinweis wie in jedem anderen Lauf: eine Zeile mit `memory_expand` öffnen, mit `memory_search` weitersuchen. Nur eine Aufgabe auf einem angehängten externen Server bekommt keinen Hinweis (dieser Server hat keine EYAS-Speicher-Werkzeuge) und stattdessen mehr der besten Treffer im Volltext. Siehe [Speicher — Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model).

**Maskiert, bevor es EYAS verlässt.** OpenCode gilt immer als entferntes Ziel, weil es jedes Modell ausführen kann. Der Aufgaben-Prompt und der abgerufene Speicher, der als Systemtext der Aufgabe mitgeht, werden von der Datenschutzrichtlinie maskiert, bevor irgendetwas OpenCode erreicht, und der Titel der OpenCode-Session entsteht aus dem maskierten Prompt. Auch die Antworten von `memory_search` / `memory_expand` in OpenCode sind maskiert. Scheitert der Datenschutz-Scan, scheitert die Aufgabe mit *privacy scan failed — the task was not sent to OpenCode*, und nichts erreicht OpenCode. Ist die Datenschutzrichtlinie (oder das Datenschutzmodul) aus, wird nichts maskiert. Siehe [Sicherheit & Datenschutz — Wo maskiert wird](/docs/de/admin/security-privacy/#where-masking-applies).

### EYAS-Speicher in OpenCode {#eyas-memory-inside-opencode}

Das EYAS-Speicher-Plugin gibt OpenCodes Modell genau zwei Werkzeuge, `memory_search` und `memory_expand`. Sie haben dieselben Namen, Beschreibungen und Argumente wie in jedem anderen EYAS-Lauf, sind nur lesend und teilen dasselbe Budget von 3 Speicher-Tool-Aufrufen pro Zug. Ein Werkzeug zum Speichern hat OpenCode nicht: Was EYAS sich merkt, entscheidet EYAS, nie OpenCodes Modell.

Was die Werkzeuge lesen dürfen, hängt davon ab, wer sie aufruft:

- **Eine `opencode_run`-Aufgabe.** EYAS bindet die OpenCode-Session, die es anlegt, an das Gespräch und den User, die die Aufgabe gestartet haben. Die Werkzeuge lesen dann das Projekt dieses Gesprächs, seinen Projekttyp und den globalen Speicher und teilen das 3-Aufrufe-Budget des aufrufenden Zugs.
- **Überall sonst** — ein OpenCode-Terminal, das jemand im Panel öffnet, jede Session, die EYAS nicht angelegt hat, oder ein angemeldeter Aufrufer, der nicht der User der Session ist — lesen die Werkzeuge nur globalen Speicher.
- **Ein angehängter externer Server** (Attach-URL) hat gar keinen Zugriff auf EYAS-Speicher.

**Der Schlüssel verlässt OpenCode nie und steht nie in einer Umgebung.**

- Jeder OpenCode-Prozess, den EYAS startet — der Hintergrund-Server und jedes OpenCode-Terminal —, bekommt seinen eigenen Schlüssel auf Dateideskriptor 3, einer Verbindung, die nur dieser Prozess hält. Der Schlüssel steht nie in einer Umgebung, einer Argumentliste oder einer Datei. Er erlischt, wenn dieser Prozess endet oder neu startet.
- Das EYAS-Plugin liest den Schlüssel einmal, wenn OpenCode es lädt, hält ihn im Arbeitsspeicher und schließt Deskriptor 3, sodass nichts, was OpenCode später startet — auch nicht die Shell-Befehle des Modells —, ihn erbt. Die Prozessumgebung sagt nur, dass der Schlüssel auf Deskriptor 3 liegt (`EYAS_OPENCODE_KEY_FD=3`), und eine Shell, die das Modell ausführt, sieht diese Variable und `OPENCODE_SERVER_PASSWORD` leer. `ps eww` oder `/proc/<pid>/environ` des OpenCode-Prozesses zeigt keinen Schlüssel.
- Jeder Speicheraufruf trägt statt des Schlüssels einen einmaligen Nachweis für eine OpenCode-Session: eine Signatur über die Id der Session, in der das Werkzeug läuft (von OpenCode gesetzt, nicht vom Modell), einen Zufallswert und die Zeit. EYAS nimmt einen Nachweis einmal an, für 2 Minuten und nur, solange dieser OpenCode-Prozess läuft, und bedient den Aufruf nur für die Session, die der Nachweis nennt. Eine Session-Id, die das Modell als Tool-Argument übergibt, wird nicht an EYAS gesendet. Ein Befehl, den das Modell ausführt, hält keinen Schlüssel und kann daher für keine Session einen Speicheraufruf machen.
- Wo sich der Schlüssel nicht auf Deskriptor 3 übergeben lässt, läuft OpenCode ohne die EYAS-Speicher-Werkzeuge, statt einen Schlüssel auf anderem Weg zu bekommen.

Jeder Aufruf läuft durch denselben EYAS-Tool-Executor wie der Speicheraufruf jedes anderen Modells (Security-Gate, Berechtigungen, Drill-Budget, Speicher-Zugriffslog, Datenschutzmaske).

**Grenzen, die bleiben.** OpenCode 1.18.29 liest sein Serverpasswort nur aus seiner Umgebung. Eine Shell, die das Modell ausführt, sieht es leer, doch jeder Prozess desselben Betriebssystem-Benutzers, der die Umgebung eines anderen Prozesses lesen kann, kann es lesen und die Sessions dieses OpenCode-Servers über OpenCodes eigene API steuern — etwa um die Nachrichten einer anderen laufenden Aufgabe zu lesen —, und dazu zählt auch ein Befehl, den das Modell ausführt. Der eigene Server des Terminals hat einen eigenen Port und ein eigenes Passwort; das Passwort des Hintergrundservers bekommt er nie, ein Befehl im Terminal erbt es also nicht. Jede Aufgabe auf einem eigenen Server laufen zu lassen, würde das nicht schließen, weil jeder Prozess desselben Betriebssystem-Benutzers die Umgebung jedes anderen lesen kann; das schließt nur ein eigener Betriebssystem-Benutzer oder eine Sandbox um OpenCode. OpenCode hat keine Kernel-Sandbox. Ein Prozess, der den Speicher eines anderen Prozesses lesen darf (ein vom Betriebssystem zugelassener Debugger oder root), kann den Schlüssel weiterhin erreichen.

**Was EYAS aufzeichnet.** OpenCodes Tool-Ausgabe innerhalb einer `opencode_run`-Aufgabe und die Ausgabe des Terminal-Panels werden nur mit eingeschaltetem `memory.l0.captureToolResults` (Default aus) aufgezeichnet, wie die Ausgabe jedes anderen Werkzeugs: unter dem Projekt des Gesprächs, mit Vertrauensstufe *ingested*, und nie wörtlich abgerufen. Terminal-Ausgabe wird nur für ein Gespräch aufgezeichnet, das existiert und dem User des Terminals gehört. Die endgültige OpenCode-Antwort und die Diffs werden nicht getrennt gespeichert: Sie sind das Ergebnis von `opencode_run`. Siehe [Speicher](/docs/de/knowledge/memory/).

**API (Integratoren).** `POST /api/v1/opencode/memory/search` und `POST /api/v1/opencode/memory/expand` nehmen die Argumente von `memory_search` / `memory_expand`. Das Plugin authentifiziert sich mit einem einmaligen Session-Nachweis, `Authorization: Bearer eyas-ocs.<payload>.<signature>`, einem pro Aufruf, und der Aufruf handelt für die Session, die der Nachweis nennt: Ein Body, der in `sessionId` eine andere Session nennt, bekommt `403`; ein gefälschter, wiederholter oder abgelaufener Nachweis, ein Nachweis von einem beendeten Prozess oder der rohe Schlüssel als Bearer bekommt `401`. Ein angemeldeter User mit dem Erstellrecht auf OpenCode kann die Routen weiterhin aufrufen und im Body mit `sessionId` eine Session nennen; der Aufruf handelt nur dann für diese Session, wenn der User ihr gebundener User ist, sonst liest er nur globalen Speicher. Eine Berechtigungsablehnung ist `403`. Die Antworten werden maskiert wie jedes Speicher-Tool-Ergebnis an ein entferntes Modell. Die alten `/api/v1/opencode/memory/query` und `/api/v1/opencode/memory/save` sind entfallen (`404`). Ändernde Aufrufe an `/api/v1/opencode/*` mit Session-Cookie brauchen den Header `X-Eyas-Request`, wie die anderen Admin-APIs (die Web-UI sendet ihn).

### Modell und Reasoning {#model-and-reasoning}

Die Karte **Modell und Reasoning** auf der OpenCode-Seite wählt Modell und Reasoning-Variante für Aufgaben, die der Assistent an OpenCode delegiert (`opencode_run`).

- **Modell** listet OpenCodes eigene Modelle: die Anbieter und Modelle, bei denen der EYAS-eigene OpenCode-Sidecar angemeldet ist, gelesen vom laufenden OpenCode-Server. **OpenCode-Standard** (leer) sendet kein Modell; OpenCode nutzt also wie bisher seinen eigenen Default.
- **Reasoning-Variante** listet die Varianten, die OpenCode für das gewählte Modell anbietet — etwa low/medium/high/xhigh/max für Claude Opus 5.5, none…max für GPT-5.6, minimal/high für manche Gemini-Modelle. Hat das Modell keine Varianten, ist das Feld ausgeblendet. **Standard des Modells** (leer) sendet keine Variante. Standardnamen (none, minimal, low, medium, high, xhigh, max) erscheinen mit EYAS' Effort-Beschriftungen; anbieterspezifische Namen so, wie OpenCode sie nennt.
- Ein anderes Modell zu wählen setzt die Variante zurück, außer das neue Modell bietet dieselbe an. **Speichern** legt die Wahl ab; das braucht das Verwaltungsrecht auf OpenCode (standardmäßig Owner und Admin).
- Die Liste braucht den laufenden OpenCode-Server. Er startet mit der ersten OpenCode-Terminal-Session oder delegierten Aufgabe — die Seite startet ihn nicht. Bis dahin sagt die Karte das und zeigt nur die gespeicherte Wahl; lade die Seite neu, sobald der Server läuft. Kann OpenCode seine Liste nicht liefern, sagt die Karte *Die Modellliste konnte nicht von OpenCode gelesen werden.*
- Zur Laufzeit wird eine gespeicherte Variante, die das Modell nicht mehr anbietet oder die sich wegen einer unlesbaren Liste nicht prüfen lässt, mit einer Warnung im Server-Log verworfen; die Aufgabe läuft auf dem gewählten Modell mit seinem Default-Reasoning. Das Ergebnis der Aufgabe nennt Modell und Variante, die tatsächlich gelaufen sind, so wie OpenCode sie meldet (Feld `effective`) — einschließlich des Modells, das OpenCode gewählt hat, wenn keines gesetzt war.
- Das OpenCode-Terminal ist nicht betroffen: Dort wählst du das Modell weiterhin in OpenCode selbst.

Bestehende Installationen starten mit OpenCodes Default-Modell und -Variante; es gibt nichts zu migrieren.

**API (Integratoren).** `GET /api/v1/opencode/models` (Lesen von OpenCode) liefert `{running, providers: [{id, name, models: [{id, name, variants: [{id, level}], contextWindow?}]}], defaults}`; `contextWindow` ist das Eingabelimit des Modells (sonst sein Kontextlimit), wenn OpenCode eines listet. Anbieter-Zugangsdaten werden nie zurückgegeben, und der Endpunkt startet den Server nie: Läuft kein Server, liefert er `running: false`; scheitert die Liste, `502` mit Code `OPENCODE_MODELS_UNAVAILABLE`. `PUT /api/v1/opencode/settings` nimmt `model` (`{providerID, modelID}` oder null) und `variant` (String oder null) an und lehnt jeden fehlerhaften Body mit `400` ab, statt ihn zu ignorieren.

### Verbindung zu einem externen Server {#attaching-to-an-external-server}

Eine Attach-URL zu einem externen OpenCode-Server bedeutet **keine Isolation**: Dieser Server behält seine eigene Konfiguration, Anmeldung und Berechtigungsregeln und bekommt keine EYAS-Speicher-Werkzeuge, keinen Speicherschlüssel und keine Aufzeichnung. Die OpenCode-Seite zeigt **Server** und **Isolierung** als *Warnung* mit diesem Hinweis.

### Die OpenCode-Seite {#the-opencode-page}

Die Seite zeigt übersetzte Check-Namen, eine Zeile **Isolierung**, eine Zeile **Server**, einen Anmeldehinweis und die Karte **Modell und Reasoning**.

### Upgrade {#upgrade}

- Frühere Versionen legten OpenCode-Dateien unter `data/opencode` im Installationsordner ab. Dieser Ordner wird nicht mehr genutzt. Verschiebe, was du noch brauchst, aus `data/opencode/workspaces` (frühere Terminal-Sessions); danach kannst du ihn löschen.
- Die OpenCode-Werkzeuge `eyas_query_memory` und `eyas_save_memory` sind durch `memory_search` / `memory_expand` ersetzt. Ein laufendes OpenCode übernimmt das neue Plugin beim nächsten Start (einem EYAS-Neustart).
- `EYAS_OPENCODE_PLUGIN_TOKEN` gibt es nicht mehr: EYAS liest und setzt es nicht. Jeder OpenCode-Prozess bekommt seinen eigenen Schlüssel auf Dateideskriptor 3, und Speicheraufrufe tragen Nachweise pro Session. Ein angehängter Server erreicht EYAS-Speicher nicht mehr.
- Das Speicher-Plugin ist nach `config/opencode/eyas/eyas-memory.ts` im EYAS-eigenen OpenCode-Ordner umgezogen; das alte `plugins/eyas-memory.ts` wird beim nächsten Start gelöscht. OpenCodes Modell hat jetzt wirklich `memory_search` / `memory_expand` (geprüft mit OpenCode 1.18.29).
- OpenCodes Tool- und Terminal-Ausgabe wird nur noch gespeichert, wenn `memory.l0.captureToolResults` an ist.

## Verwandt

- [Werkzeuge](/docs/de/automation/tools/)
- [Speicher](/docs/de/knowledge/memory/)
- [Unterhaltungen](/docs/de/daily/conversations/)
- [Sicherheit & Datenschutz](/docs/de/admin/security-privacy/)
