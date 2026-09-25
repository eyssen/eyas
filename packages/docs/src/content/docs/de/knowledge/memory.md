---
title: Speicher
description: Was EYAS behält — automatische Vault-Notizen, fünf Stufen, die Rohaufzeichnung jeder Nachricht, und welchen Store du wann nutzt.
---

**Wozu das da ist.** Speicher ist EYAS' eigener Langzeitspeicher. Ein dauerhafter Fakt aus einem Gespräch wird ohne Nachfrage zur Vault-Notiz, und dieselbe Notiz liest jedes spätere Gespräch zurück. Hier prüfst du Working-Blöcke, episodische Fakten, Vault-Dateien und die Review-Queue — du kuratierst kein Wiki. Wie erinnerter Text ein Modell erreicht, steht unter [Wie der Abruf funktioniert](#how-recall-works). Seit 0.8.23 führt EYAS zusätzlich eine Rohaufzeichnung jeder Nachricht, die es speichert; [Die Rohaufzeichnung](#the-raw-record) weiter unten ist alles, was es dazu zu wissen gibt.

## Wann du es brauchst {#when-to-use-it}

- Der Assistent soll sich merken, wer du bist, wie du arbeitest, oder welche Constraints ein Projekt hat.
- Ein Fakt stand im Chat, und du willst sehen, ob er in der Vault gelandet ist (oder warum Capture übersprungen wurde).
- Review, Tags, Graph oder Konsolidierung — oder **Heutige Notiz**.
- Du wählst zwischen Speicher, Wissens-Wiki, Dokumenten und handgeschriebenen Vault-Dateien (siehe unten).
- Capture für diese Instanz aus (`memory.capture.enabled: false`) — oder auch die Rohaufzeichnung aus (`memory.l0.enabled: false`).
- Ein Modell lief ohne EYAS' Isolation, und was es geschrieben hat, soll vor jedem Modell verborgen werden (**Speicher eines Anbieters unter Quarantäne stellen**, nur Owner).
- Du willst sehen, worauf der Abruf hier läuft — den lokalen Embedder, wie viel Speicher schon Vektoren hat und welche Aufzeichnungsschalter wirklich an sind (Karte **Abruf-Engine**).

## Typischer Ablauf {#typical-workflow}

1. Öffne **Speicher** in der Sidebar (Bereich **Inhalt**) — Route `/memory`. (Auch unter **Einstellungen → KI & Modell**.)
2. Sieh dir **Übersicht** an (Zähler, Salienz, neueste episodische Erinnerungen und die Karte **Abruf-Engine**), dann **Vault-Dateien** für dauerhafte Notizen.
3. Führe ein Gespräch, länger als ~40 Zeichen, das einen bleibenden Fakt nennt. Komm nach der Antwort hierher zurück — du solltest eine neue Vault-Notiz sehen (Art `user`, `feedback`, `domain`, `project` oder `reference`).
4. Wenn nichts erscheint: zu kurz, Capture aus, kein Hintergrundmodell konnte das Capture ausführen (siehe [Capture läuft auf dem Hintergrundmodell](#capture-runs-on-the-background-model)), oder eine God-Mode-Runde (die eigene Runde des Rennens schreibt keine Vault-Notiz; der Lauf jedes Workers wird für sich erfasst). Schreib die Notiz von Hand in den Vault, wenn du sie trotzdem brauchst. Die siegreiche Antwort einer God-Mode-Runde landet trotzdem in der Rohaufzeichnung — siehe [Die Rohaufzeichnung](#the-raw-record).

## Welchen Store du nutzt {#which-store-to-use}

| Store | Job |
|-------|-----|
| **Speicher** (diese Seite) | Fakten, die EYAS automatisch aufzeichnet — Agenten schreiben nie selbst Speicher. EYAS hängt einen Einzeilen-Index, und was es für die Nachricht abgerufen hat, an jeden späteren Zug an. |
| **Wissen** Wiki | Kuratierte Seiten, **die du** editierst. Capture schreibt hier nicht. |
| **Dokumente** | Hochgeladene Dateien zur Retrieval — keine Identitätsnotizen. |
| **Vault-Dateien** (handgeschrieben) | Dieselbe Vault wie Capture (`<Datenverzeichnis>/vault/…`, standardmäßig `data/vault/…`). Nicht `~/.claude` / `~/.grok`. |
| **Projekt-Wiki** | Ticket- und Entscheidungsseiten eines Projekts, nicht globaler Speicher. |
| **Rohaufzeichnung** | Jede Nachricht, die EYAS speichert, ein zweites Mal wörtlich und komprimiert. Wird seit 0.8.23 automatisch geschrieben; keine Seite zeigt sie an, und der Assistent erreicht sie nur über den Abruf. |

Host-Claude- / Grok-Speicher auf der Maschine ist **nicht** die Quelle, und Modelle erreichen ihn nicht. Claude Code läuft immer isoliert und lädt keine Host-Konfiguration und kein Auto-Memory; Grok und Kimi laufen in ihrem eigenen EYAS-Home; das Security-Gate verweigert Lesen wie Schreiben im Speicher jedes anderen Tools; und MCP-Server, die einen Speicher außerhalb von EYAS führen, sind gesperrt. Der Master-Prompt sagt jedem Agenten dasselbe (siehe [Prompts — der Speicher-Vertrag](/docs/de/ai/prompts/#the-memory-contract-in-the-master-prompt)). Siehe [Speicher außerhalb von EYAS wird verweigert](#memory-outside-eyas-is-refused).

## Funktionen {#features}

Untertitel in der App: *5-stufiges hybrides Gedächtnissystem — Arbeits-, episodisch, semantisch/prozedurales Vault, Archiv*.

### Aktionen {#actions}

| Steuerelement | Bedeutung |
|---------------|-----------|
| **Heutige Notiz** | Zur heutigen Notiz springen / sie anlegen |
| **Jetzt konsolidieren** | Den Konsolidierer ausführen (Erinnerungen höher- oder herabstufen) |
| **Aktualisieren** | Statistiken neu laden |

Über den Tabs zeigt die Karte **Morgen-Briefing** die letzte nächtliche Reflexions-Zusammenfassung, sofern es eine gibt (der Reflexions-Job ist standardmäßig aus: `memory.reflection.enabled`).

### Tabs {#tabs}

| Tab | Inhalt |
|-----|--------|
| **Übersicht** | Statistiken, Salienz-Diagramme und neueste episodische Erinnerungen, darunter die Karten **Abruf-Engine** und **Speicher eines Anbieters unter Quarantäne stellen** (nur Owner) |
| **Arbeitsgedächtnis** | Blöcke mit kurzer TTL (24 h) |
| **Episodisches Gedächtnis** | Fakten/Episoden mit Salienz |
| **Vault-Dateien** | Markdown-Vault-Browser |
| **Archiv** | Archivierte Einträge mit niedriger Salienz |
| **Graph** | Graph-Ansicht des Speichers |
| **Tags** | Tag-Browser |
| **Prüfung** | Prüf-Warteschlange für die Speicherpflege |

### Übersicht {#overview}

| Statistik | Bedeutung |
|-----------|-----------|
| **Arbeitsblöcke** | Aktive Arbeitsblöcke (24h TTL) |
| **Episodische Fakten** | Anzahl episodischer Einträge (+ ungültig gemachte) |
| **Vault-Dateien** | Semantische + prozedurale Markdown-Dateien |
| **Archiviert** | Anzahl archivierter Einträge mit niedriger Salienz |
| **Bereit zur Höherstufung** → Vault | Wertvolle episodische Kandidaten |
| **Bereit zur Herabstufung** → Archiv | Kandidaten mit niedriger Salienz |
| Salienz min / Ø / max | Verteilung |
| **Top-Tags** / **Episodisch — Nach Quelle** | Aufschlüsselungen |

Unter den Statistiken folgen die Karten [Abruf-Engine](#recall-engine) und [Speicher eines Anbieters unter Quarantäne stellen](#quarantine-a-providers-memory).

### Die Tabs im Einzelnen {#tab-details}

Jede Zeile im **Arbeitsgedächtnis** zeigt *N Zeichen · N× aufgerufen · läuft ab: (Zeit)*.

Im **Episodischen Gedächtnis** öffnet ein Klick auf eine Zeile ihr Detail:

| Feld | Bedeutung |
|------|-----------|
| **Salienz** | Wichtigkeitswert |
| **ungültig gemacht** | Nicht mehr vertrauenswürdig oder aktuell |
| **ID / Quelle / Quellen-ID / Agent** | Herkunft |
| **Zugriffsanzahl / Unterhaltungsanzahl** | Nutzung |
| **Gültig ab / Ungültig gemacht am / Erstellt / Zuletzt aufgerufen** | Zeitstempel des Lebenszyklus |
| **Embedding-Hash** | Ob der Eintrag einen Vektor hat |
| **Tags** | Die Tags des Eintrags |

**Vault-Dateien**:

| Steuerelement | Bedeutung |
|---------------|-----------|
| **Dateien** | Vault-Pfade |
| **Frontmatter** | YAML-Metadaten |
| **Tags:** / **Links:** | Tags und Wikilinks |
| **Inhalt** | Markdown-Text |
| **Rückverweise** | Notizen, die hierher verlinken |

Jede Zeile im **Archiv** zeigt *archiviert (Datum) · Original (Datum)* und *id · Original-id*. Der Konsolidierer verschiebt Einträge mit niedriger Salienz hierher.

### Abruf-Engine {#recall-engine}

Die Karte **Abruf-Engine** in der **Übersicht** zeigt, nur lesend, die Maschinerie, über die jedes Modell abruft. Sie ist dieselbe, welcher Chat-Anbieter auch antwortet, und auf der Karte lässt sich nichts ändern.

| Zeile | Was sie zeigt |
|-------|---------------|
| **Embedder** | Das lokale Modell, das Speicher und Anfragen in Vektoren umwandelt: *Mehrsprachiges e5 (lokal)*, wenn die Gewichte von multilingual-e5-small geladen wurden, sonst *Hash-Stamm-Embedder (lokaler Ersatz)*, darunter die Modell-Id. *Aus* nur, wenn bei diesem Start kein Embedder gebaut werden konnte; der Vektor-Abruf ist dann aus (siehe [Die Vektorsuche läuft immer lokal](#vector-search-always-runs-locally)). |
| **Zusammenfassungen mit Vektor** / **Fakten mit Vektor** | *X von Y*. Y sind die Zusammenfassungen und Fakten, die der Abruf liefern kann: aktuell, nicht überholt, nicht unter Quarantäne; mit `contains-secrets` getaggte bleiben außen vor, außer `memory.recall.includeSecrets` ist an. X ist, wie viele davon schon einen Vektor des aktuellen Embedders haben. Eine Lücke schließt sich binnen Sekunden nach dem nächsten Schreiben in den Speicher. Vektoren eines früheren Embedders zählen nicht; sie werden beim nächsten Start ersetzt. |
| **Vektoren zuletzt aktualisiert** | Wann der Vektor-Worker im Hintergrund in diesem Serverprozess zuletzt lief. *Seit dem Start noch nicht*, bis nach einem Neustart sein erster Durchlauf kommt — ein paar Sekunden nach dem Start. |
| **Projektpartitionen** | Wie viele Projekte und Projekttypen Vektoren in einer eigenen Partition abgelegt haben — das hält den Speicher eines Projekts aus dem Abruf eines anderen heraus. Es zählen nur Partitionen, die gerade Vektoren enthalten; globaler Speicher hat immer seine eigene. |
| **Rohaufzeichnung** | Ob die [Rohaufzeichnung](#the-raw-record) läuft: `memory.l0.enabled` ist an und die Aufzeichnung ist beim Start angelaufen. |
| **Werkzeugausgaben aufzeichnen** | `memory.l0.captureToolResults`. *Aus*, sobald die Rohaufzeichnung aus ist, weil dann nichts aufgezeichnet wird. |
| **Denkprozess aufzeichnen** | `memory.l0.captureThinking`. Ebenfalls *Aus*, sobald die Rohaufzeichnung aus ist. |
| **Notizen mit Geheimnissen abrufen** | `memory.recall.includeSecrets` |
| **Abrufbudget (100k-Token-Fenster)** | `memory.index.budgetChars` (Standard 2.400 Zeichen): die Größe des Abrufblocks bei einem 100k-Token-Kontextfenster; der Block skaliert mit dem Fenster des antwortenden Modells (siehe [Dauerzeilen des Speichers](#standing-memory-lines)). |

Die Karte zeigt die Konfiguration, mit der EYAS läuft, und liest sie bei jedem Seitenaufruf neu; eine Änderung in `local.yaml` erscheint nach einem Neustart. Dahinter steht `GET /api/v1/memory/engine`, das Lesezugriff auf den Speicher verlangt (Rollen owner, admin, user und agent; ein Gast bekommt `403`). Es liefert nur Zähler, Schalter und die Id des Embedders — nie Speicherinhalt.

## Dauerhafte Notizen {#durable-notes}

Eine dauerhafte Notiz ist ein bleibender Fakt, kein Ereignisprotokoll: wer du
bist, wie gearbeitet werden soll, welche Randbedingungen ein Projekt hat. Jede
ist eine Markdown-Datei im Vault, und das Modell bekommt pro Zug einen
**einzeiligen Index** davon — nur die Zusammenfassungen, jede Zeile mit einer
Id — im Abrufblock, der an deine Nachricht angehängt wird (siehe
[Wie der Abruf das Modell erreicht](#how-recall-reaches-the-model)). Die ganze
Notiz öffnet es bei Bedarf mit `memory_expand`, weiter sucht es mit
`memory_search` (siehe [Weitersuchen](#looking-further-memory_search-and-memory_expand)).

Derselbe Block trägt auch, was EYAS **für die aktuelle Nachricht abgerufen**
hat — Gesprächszusammenfassungen, Fakten, Vault-Notizen, episodischen Speicher
und frühere Nachrichten — plus den Volltext der besten Treffer. Das Modell muss
`memory_search` nicht aufrufen, damit diese Treffer erscheinen. Frühere
Nachrichten sind durchsuchbar, weil sie schon gespeichert sind — der Abruf legt
keine zusätzliche Kopie an. (Die Rohaufzeichnung unten ist eine eigene,
absichtliche Zweitkopie.) Der eigene Block *Related prior work*, der früher an
den System-Prompt angehängt wurde, ist weg: Frühere Arbeit kommt jetzt im
Abrufblock an.

Zwei Frontmatter-Felder steuern das: `kind` (`user`, `feedback`, `domain`,
`project`, `reference` — zugleich die Rangfolge) und `summary` (die Indexzeile). `user`
und `feedback` stehen vorn. `domain` ist der Projekttyp (geteilt mit Geschwisterprojekten),
`project` dieser eine Mandant. Ohne `kind` gilt eine Notiz in `procedural/` als
`feedback`, sonst als `reference` — nie als `user`. Ohne `summary` wird die
erste echte Zeile verwendet, eine handgeschriebene Datei funktioniert also ohne
EYAS-spezifisches Frontmatter.

Ablage: `<Datenverzeichnis>/vault/semantic/`, `procedural/`, `projects/` und
`project-types/` — standardmäßig unter `data/vault/`. Der Vault liegt immer im
Datenverzeichnis und folgt `EYAS_DATA_DIR`; eine eigene Pfadeinstellung hat er
nicht (siehe [Konfiguration — Datenverzeichnis und Vault](/docs/de/deploy/configuration/#data-directory-and-vault)).
Schreib selbst eine, und EYAS nimmt sie auf.

**Sie füllen sich selbst.** Nachdem die Antwort ausgeliefert ist — in einem
Chat, einem Hintergrund-Kartenlauf, einem Spezialisten- oder delegierten Lauf,
dem Lauf eines Teammitglieds, einer A2A-Aufgabe oder einer Kanal-Antwort —, liest ein
kleiner Modellaufruf auf EYAS' Hintergrundmodell den Austausch (siehe
[Capture läuft auf dem Hintergrundmodell](#capture-runs-on-the-background-model)) und fragt, ob darin etwas steckt, das in
einem Monat noch stimmt und noch nützlich ist. Höchstens zwei Notizen pro Zug,
meist zu Recht keine. Das läuft nie im kritischen Pfad deiner Antwort: eine
gescheiterte Erfassung kostet eine Notiz, nie eine Antwort.

Vor diesem Aufruf stehen nur eine Längenprüfung und eine Obergrenze je Gespräch, und du kannst ihn abschalten — siehe [Capture ist standardmäßig an](#capture-is-on-by-default). Von Hand geschriebene Notizen funktionieren immer. Agenten können keinen Speicher schreiben: EYAS zeichnet ihn automatisch auf, und `save_memory` ist stillgelegt — es schreibt nichts und verweist den Agenten auf `memory_search`. Auch das Modell in OpenCode kann nicht schreiben: Das EYAS-Speicher-Plugin in OpenCode bietet nur `memory_search` und `memory_expand`.

Eine Kandidaten-Notiz durchläuft vor dem Schreiben denselben Anweisungsfilter
wie Fakten und Zusammenfassungen (siehe [Warum manche Sätze abgelehnt werden](#why-some-sentences-are-refused)),
und jede Notiz, die ein Modell schreibt, trägt im Frontmatter ein `origin` —
`by: capture` plus Anbieter, Modell und Gespräch, soweit bekannt —, sodass sie
als von einem Modell geschrieben gespeichert wird, nie als deine eigenen Worte.

Ein wiederholter Fakt bestärkt die vorhandene Notiz, statt eine zweite anzulegen:
die neue Formulierung kommt als datierter Punkt unter `## History` dazu und
überschreibt nichts. Das Datenschutz-Modul maskiert den Text, bevor er auf die
Platte kommt, nicht beim Lesen — mit derselben Funktion und denselben Regeln wie
den ausgehenden Modellverkehr: Datumsangaben bleiben erhalten, Werte der Klassen
mask und block werden ersetzt — eine IBAN in einer Notiz wird als `[IBAN]`
gespeichert. Das gilt für Vault-Notizen; die Rohaufzeichnung unten, die
Gesprächszusammenfassungen und die Fakten werden innerhalb von EYAS wörtlich
gespeichert und erst maskiert, wenn sie EYAS verlassen (siehe
[Speicher und Datenschutz](#memory-and-privacy)).

**Projektgedächtnis.** Was in den Unterhaltungen eines Projekts gelernt wurde,
liegt unter `projects/<projekt-id>/`, steht in diesem Projekt vor den
allgemeinen `reference`-Notizen und taucht sonst nirgends auf — Notizen fremder
Projekte erreichen den Prompt nie. Das Sammelprojekt **General**, in dem jede
Unterhaltung startet, zählt dabei nicht als Projekt: dort Gelerntes bleibt ein
Fakt über dich oder über die Arbeitsweise und begleitet dich überall hin.

### Capture ist standardmäßig an {#capture-is-on-by-default}

Capture läuft auf **jeder** Unterhaltung, global, außer du setzt `memory.capture.enabled: false` (in `local.yaml`, dann Neustart). Es läuft auf jedem Weg, auf dem EYAS ein Modell ausführt: deine eigenen Chat-Runden, Hintergrund-Kartenläufe, Spezialisten- und delegierte Läufe (`run_specialist` / `delegate_to_agent`, Ticket-zu-Code-Pipeline-Stufen eingeschlossen), A2A-Aufgaben eines Peer-Agenten, der Lauf jedes Teammitglieds und jede Kanal-Antwort (Telegram, E-Mail, Slack, …). Alle gehen durch dasselbe Gate und dieselben Einstellungen, und `memory.capture.enabled: false` schaltet jeden Weg ab. Ein Lauf, der nichts geantwortet hat, schreibt keine Zeile. Eine Nachricht unter `minUserChars` löst nie einen Modellaufruf aus, und ein Gespräch bekommt höchstens `maxPerConversation` davon. Ein Spezialist oder Teammitglied läuft in einem eigenen Untergespräch und hat damit seine eigene Obergrenze; ein Kanal-Gespräch teilt sich eine Obergrenze über alle seine Nachrichten. Jeder Spezialist, jedes Teammitglied und jede Kanal-Antwort, deren Anweisung mindestens `minUserChars` lang ist, kann also einen zusätzlichen Modellaufruf im Hintergrund kosten. Ist kein Hintergrundmodell geeignet oder steht das Budget auf *stop*, gibt es keinen Aufruf, und der Lauf wird als Überspringen festgehalten (siehe [Capture-Lauf-Ledger](#capture-run-ledger)).

**Wer die Nachricht geschrieben hat, entscheidet, wie sie gelesen wird.**

- Deine eigenen Chat-Nachrichten werden als deine gelesen.
- Eine delegierte Aufgabe, ein Team-Briefing, ein Übergabe-Briefing oder das Ziel einer Karte wird als Aufgabenanweisung gelesen, die ein Agent für dich geschrieben haben kann. Nur Fakten, die sie über dich, das Projekt oder die Welt aussagt, werden behalten, nie die Schritte der Aufgabe selbst.
- Eine Kanalnachricht oder eine A2A-Aufgabe sind die Worte eines Dritten. Sie können nie eine Notiz darüber anlegen, wer du bist (`user`), oder eine Regel dafür, wie gearbeitet werden soll (`feedback`) — sag EYAS das in der App. Sie können nur Notizen der Art `reference`, `project` oder `domain` erzeugen, die `trust: peer` im Frontmatter tragen und mit Peer-Vertrauen gespeichert werden, nicht als vom Modell abgeleitet. Eine solche Notiz ergänzt nie eine deiner vorhandenen Notizen: Ein wiederholter Fakt bekommt eine eigene Datei. Die Längenprüfung zählt nur die Worte des Absenders, ein kurzes „ok“ über einen Kanal kostet also keinen Modellaufruf.

| Gate | Default | Bedeutung |
|------|---------|-----------|
| `memory.capture.enabled` | **an** | Hauptschalter |
| `minUserChars` | 40 | Unicode-Codepunkte; kürzer überspringt den Aufruf |
| `maxPerConversation` | 20 | Modell-Spend-Deckel (erfolgreich, unparsable, rejected-shape, Anweisungsfilter (`poison_gate`) und error zählen; too-short-, no-eligible-model- und budget-stop-Skips nicht, weil kein Modell aufgerufen wurde) |
| `maxInputChars` | 4000 | Deine Nachricht und die Antwort werden je auf so viele Zeichen gekürzt, bevor das Capture-Modell sie sieht |

Keine Stichwortliste. `{"notes":[]}` ist die häufige und richtige Extractor-Antwort (0–2 Notizen).

### Capture läuft auf dem Hintergrundmodell {#capture-runs-on-the-background-model}

Speichererfassung, nächtliche Konsolidierung und das Reflexions-Briefing nutzen alle EYAS' **Hintergrundmodell**: einen API-Anbieter oder eine CLI, die einen isolierten Aufruf kann (heute Claude Code; Grok CLI und Kimi Code CLI, sobald EYAS deren Isolation auf diesem Host verifiziert hat). Die Reihenfolge ist die Heartbeat-Routing-Stufe, dann der Installations-Default, dann API-Anbieter, dann CLIs, die isoliert laufen können. Es fällt nie auf einen Anbieter zurück, den das Gateway selbst wählt, und nie auf eine CLI, die nicht isolieren kann.

Jeder Extraktions-, Konsolidierungs- und Reflexionsaufruf ist **isoliert**: ein Zug, keine Tools, kein CLI-nativer Speicher und keine CLI-Konfiguration, die Anweisung als System-Prompt. Ist das Extraktionsmodell entfernt, erreichen es Werte der Klasse block aus dem Austausch maskiert (`[IBAN]`) und Datumsangaben unverändert; eine Runde, die eine IBAN erwähnt, ergibt also trotzdem ihre Notiz.

Mit einem aktivierten API-Anbieter oder Claude Code ändert sich nichts Sichtbares. Auf einer Installation ohne geeignetes Hintergrundmodell — etwa reines Grok oder Kimi, bevor deren Isolation verifiziert ist:

- **Capture macht keinen Modellaufruf.** Jeder qualifizierende Zug schreibt eine Zeile ins Capture-Ledger mit dem Skip-Grund `no_eligible_model` und ohne Anbieter. Das ist ein festgehaltenes Überspringen, kein Fehler.
- **Die nächtliche Konsolidierung** macht aus wiederkehrenden episodischen Erinnerungen keine Vault-Notiz. Diese Cluster bleiben unangetastet (nicht zusammengefasst, nicht invalidiert) und werden in einer späteren Nacht befördert, sobald ein geeignetes Modell existiert.
- **Das Reflexions-/Morgen-Briefing** behält nur seinen deterministischen Teil (etwa überfällige Aufgaben), ohne vom Modell geschriebene Erfolge, Erkenntnisse oder Vorschläge.

Steht das Modellbudget auf *stop*, hält Capture den Skip-Grund `budget_stop` fest und macht keinen Aufruf.

Ohne Isolation las der Extractor einmal den Host-Speicher des Owners, meldete den Fakt „schon gespeichert“, und die EYAS-Vault blieb leer. Das schließt diesen Bug.

### Capture-Lauf-Ledger {#capture-run-ledger}

Jedes Ergebnis, das das Gate erreicht, schreibt eine `memory_capture_runs`-Zeile: Skips mit Grund (`too-short`, `cap-reached`, `unparsable`, `rejected-shape`, `poison_gate`, `no_eligible_model`, `budget_stop`, `error`), Extraktionen mit Kinds (ein `poison_gate`-Lauf zählt trotzdem die Notizen aus derselben Antwort, die gespeichert wurden), plus Spalte `provider`: `provider/model`, `provider/route`, wenn eine CLI geantwortet hat, ohne ihr Modell zu nennen (etwa `claude-code/isolated-cli`), oder null, wenn kein Modell aufgerufen wurde. Ein gescheiterter oder leerer Extraktionsaufruf schreibt eine `error`-Zeile mit dem versuchten Anbieter. Die Spalte `entry_path` hält fest, von welchem Laufweg die Zeile kam: `interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team` oder `channel` (leer bei Zeilen, die vor dieser Version geschrieben wurden). Zwei Absichten: Capture aus schreibt nichts; ein Lauf ohne Assistant-Text erreicht das Gate nicht. Ein **God Mode**-Rennen kehrt vor dem Post-Turn-Block mit eigenem Stream zurück — die eigene Runde des Rennens schreibt also weder eine Vault-Notiz noch eine Zeile hier; jeder Worker läuft als eigener Hintergrundlauf und wird dort erfasst, wobei die Aufgabe als von einem Agenten geschriebene Anweisung gelesen wird. Die Rohaufzeichnung unten ist ein eigenes Ledger und erfasst sie sehr wohl.

## Wie der Abruf funktioniert {#how-recall-works}

In jedem Zug, welches Modell auch antwortet, hängt EYAS das, woran es sich erinnert, in einem einzigen Block an deine Nachricht:

- **Dauernotizen** — ein einzeiliger Index dauerhafter Notizen und Zusammenfassungen, jede Zeile mit einer Id, die das Modell öffnen kann;
- **Abgerufene Treffer** — die Zusammenfassungen, Fakten, Notizen, episodischen Erinnerungen und früheren Nachrichten, die zu dieser Nachricht passen, gerankt nach Relevanz, Alter und Verfasser;
- **Die besten Treffer im Volltext** — die ersten zwei (vier bei einem Modell, das keine Tools aufrufen kann).

All das stammt nur aus dem Speicher, den das Gespräch sehen darf (sein Projekt, sein Projekttyp und globaler Speicher), wird in der Sprache gesucht, in der du schreibst, und nach Vertrauen gewichtet. Weiter suchen kann das Modell mit `memory_search` und `memory_expand`, drei Aufrufe pro Antwort. Die Abschnitte unten gehen das einzeln durch.

### Welchen Speicher ein Gespräch sieht {#which-memory-a-conversation-can-see}

Ein Gespräch sieht drei Arten von Speicher: den seines eigenen Projekts, den
seines Projekttyps und globalen Speicher. Den Speicher eines anderen Projekts
sieht es nie. Ein Gespräch außerhalb jedes Projekts — auch eines im
Default-Projekt **General** — sieht nur globalen Speicher.

Eine Regel gilt für alles, was das Modell bekommt: den Speicher, der in jede
Runde eingefügt wird, die Dauerzeilen des Index, den Vektor-Abruf und die Tools
`memory_search`, `memory_expand` und `search_memory`.

Wohin eine Vault-Notiz gehört, entscheidet ihr Frontmatter:

| Notiz deklariert | Sichtbar in |
|------------------|-------------|
| `project:` | Nur diesem Projekt, gleich welchen Kinds. (Früher wurden `user`- / `feedback`- / `reference`-Notizen überall gezeigt, auch wenn sie ein Projekt nannten.) |
| nur `projectType:` | Projekten dieses Typs |
| keins von beiden | Überall (global) |

Verschiebst du eine Notiz nach `projects/<id>/` eines existierenden Projekts
oder trägst `project:` in ihr Frontmatter ein, gilt sie nur noch für dieses
Projekt — ebenso die Fakten und die Zusammenfassung, die EYAS daraus ableitet:
Sie werden nur in diesem Projekt abgerufen statt in jedem Gespräch. Die Suche
auf der Speicher-Seite (`/memory`) ist weiterhin ungefiltert.

### Wie der Abruf das Modell erreicht {#how-recall-reaches-the-model}

Was EYAS für eine Nachricht abruft, hängt **an dieser Nachricht**, nicht am
System-Prompt. Es kommt als ein abgegrenzter Block `<eyas-memory>` in einem
Block `<turn-context>` an, den EYAS oben an deine aktuelle Nachricht setzt,
zusammen mit dem aktuellen Datum und der Uhrzeit (in `i18n.timezone`, sonst der
Zone des Servers). Der Block enthält, in dieser Reihenfolge:

1. die Dauernotizen — den Einzeilen-Index, jede Zeile mit ihrer Id;
2. die für diese Nachricht abgerufenen Notizen;
3. den Volltext der besten Treffer.

Das Format ist bei jedem Anbieter gleich — API-Modelle, Claude Code, Grok CLI,
Kimi Code CLI, lokale Modelle — und bei jeder Art von Lauf: interaktiver Chat;
Hintergrundläufe (Bot-Karten am Board, Wiederholungen und Fortsetzungen,
God-Mode-Worker); Spezialisten und delegierte Agenten (`run_specialist` /
`delegate_to_agent`) und Ticket-to-Code-Pipeline-Stufen; Team-Mitglieder;
Kanal-Antworten in der (internen) Stimme des Besitzers; und
[OpenCode](/docs/de/automation/opencode/)-Aufgaben. Ein Chat ohne Kollegen in
einem Projekt ohne Default-Agent bekommt keinen zusammengesetzten System-Prompt,
aber trotzdem Datum, Uhrzeit und abgerufenen Speicher. Ein `system`-Override in
der Nachrichtenanfrage ersetzt nur den System-Prompt; der Abruf kommt trotzdem an.
Ein fortgesetzter Lauf (Aktualisieren, Fortsetzen nach Freigabe, Critic-Feedback)
bekommt frisches Datum, frische Uhrzeit und frischen Abruf, nicht die vom
Laufstart.

- **Daten, keine Anweisungen.** Der Block sagt dem Modell, dass er Daten sind,
  keine Anweisungen, und bittet es, Verwendetes als `[source:<id>]` zu zitieren.
  Text darin kann den Block nicht schließen und sich nicht als System- oder
  User-Nachricht ausgeben: Solche Tags werden entschärft, bleiben aber lesbar.
- **Nie gespeichert.** Deine gespeicherte Nachricht wird nie verändert; der Block
  kommt nur auf die Kopie, die an das Modell geht, EYAS erfasst also nie den
  eigenen Abruf erneut als Speicher.
- **Ein stabiler System-Prompt.** Weil auch die Uhr in diesen Block gewandert
  ist, bleibt der System-Prompt von Zug zu Zug gleich und damit cachebar.
- **Tool-Namen für den Host.** Drill-down-Hinweise benennen die Tools so, wie der
  Host des Modells sie listet: `memory_search` / `memory_expand` bei nativen
  Anbietern, `mcp__eyas__memory_search` bei Claude Code, `use_tool` mit
  `eyas__memory_search` bei Grok CLI und `memory_search` auf dem MCP-Server
  `eyas` bei Kimi. Ein Modell, das keine Tools aufrufen kann, bekommt keinen
  Drill-down-Hinweis und bis zu vier Volltext-Notizen statt zwei, und sein Prompt
  sagt, dass dieser Block der ganze Speicher ist, den es bekommt, und dass es
  nicht weitersuchen kann, statt es auf `memory_search` / `memory_expand` zu
  verweisen (siehe
  [Prompts — Der Speicher-Vertrag](/docs/de/ai/prompts/#the-memory-contract-in-the-master-prompt)).
- **Kein Besitzer-Speicher für externe Leser.** Aufgaben eines A2A-Peers und
  Kanal-Antworten mit Stimm-Scope Extern (**Force External** am Gespräch oder
  ein temporärer Override) bekommen nur Datum und Uhrzeit. Kann EYAS den
  Stimm-Scope einer Kanal-Antwort nicht bestimmen, geht auch sie ohne
  abgerufenen Speicher raus. Die Speicher-Tools selbst sind unverändert und
  stehen weiter unter dem Security-Gate.

Der ganze Block, Rahmen eingeschlossen, wird von `memory.index.budgetChars`
bemessen (siehe [Dauerzeilen des Speichers](#standing-memory-lines)), skaliert mit dem
Fenster des antwortenden Modells — bei einer OpenCode-Aufgabe mit dem Fenster,
das OpenCode für das gewählte Modell listet (siehe [OpenCode — Speicher, der mit einer Aufgabe mitgeht](/docs/de/automation/opencode/#memory-sent-with-a-task)). In der
[Kontext-Zusammenstellung](/docs/de/daily/conversations/#context-composition)
ist der Abruf der Abschnitt **memory-recall** in der Zone **turn**, neben
**turn-time** (der Uhr); die Abschnitte *memory-index* und *related-work*
erscheinen nicht mehr. Das Feld **Gelieferter Speicher** der Ansicht zeigt bei
jedem Anbieter das Modell und Fenster, für das der Block bemessen wurde, wie
viele Einträge abgerufen wurden und wie viele davon vollständig, gemessen an der
Obergrenze des Blocks, warum der Abruf gegebenenfalls zurückgehalten wurde, und
die Drill-down-Aufrufe des Zugs gegenüber der Grenze von 3.

Um Anbieter über einen Zeitraum zu vergleichen, hat **Beobachtbarkeit → Kontext** die Karte **Speicherlieferung nach Provider**: je Anbieter, wie viele Züge Speicher trugen, die durchschnittlichen Einträge je Schicht und Speicher-Tokens in diesen Zügen und wie oft das Modell selbst Speicher geöffnet hat. Ähnliche Werte heißen, dass jedes Modell denselben Speicher bekam. Siehe [Beobachtbarkeit](/docs/de/admin/observability/).

### Womit der Abruf sucht {#what-recall-searches-with}

Jeder Zug durchsucht den Speicher mit derselben Anfrage, ob Chat oder Hintergrund-
bzw. geplanter Lauf eines Gesprächs. Die Anfrage entsteht ohne Modellaufruf aus:

- deiner aktuellen Nachricht (ist sie leer, deiner letzten Nachricht in diesem Gespräch);
- deiner vorigen, davon abweichenden Nachricht (erste 400 Zeichen);
- dem Titel des Gesprächs (erste 120 Zeichen; ein Platzhalter *Ohne Titel* wird
  ignoriert);
- der Aufgabenbeschreibung bzw. dem Ziel des Gesprächs (erste 400 Zeichen).

Sie hat höchstens 1.200 Zeichen, deine Nachricht steht vorn, und ein Teil, der
schon in einem früheren enthalten ist (etwa ein Titel aus deiner ersten
Nachricht), wird nicht wiederholt. Genutzt werden nur die eigenen Nachrichten
dieses Gesprächs, nie die eines anderen. Eine kurze Rückfrage wie *ja, mach das*
ruft also die besprochene Aufgabe ab, und ein Hintergrundlauf eines Gesprächs
ohne Beschreibung sucht trotzdem nach seinem Titel. (Vorher suchte der Chat nur
mit der aktuellen Nachricht und ein Hintergrundlauf nur mit der
Aufgabenbeschreibung.)

**Die Suche liest deine Sprache.** Die Sprache wird aus der Anfrage selbst
bestimmt. Bei einer kurzen Nachricht ohne klare Sprache nimmt EYAS die Sprache,
in der das Gespräch geführt wurde; ist auch die unbekannt, werden die üblichen
Funktionswörter aller unterstützten Sprachen ignoriert. Ungarische, deutsche,
spanische und französische Funktionswörter (*hogy*, *csak*, *aber*, *para*,
*avec* …) zählen also nicht mehr als Suchbegriffe und lassen keine unpassenden
Notizen mehr durch, und Klingonisch-Anfragen bekommen die stärkere
Schlüsselwort-Gewichtung. Die eigenen `memory_search`-Anfragen des Modells — auch die von OpenCode — bestimmen ihre Sprache auf dieselbe Weise.

### Wie der Abruf rankt {#how-recall-ranks}

Jedes Modell, jeder Einstiegspfad und die Tools `memory_search` / `memory_expand`
nutzen dasselbe Ranking. Konfigurieren oder migrieren musst du nichts.

- **Relevanz zuerst**: wie gut eine Notiz oder frühere Nachricht zu deiner
  Nachricht passt. Danach zählen, wie neu und wie wichtig sie ist, plus ein
  kleiner Bonus für Speicher aus derselben Aufgabe (demselben Gespräch) oder
  demselben Projekt.
- **Das Alter zählt je nach Art des Speichers.** Fakten veralten am schnellsten
  (etwa ein Monat), frühere Nachrichten in etwa drei Monaten, Zusammenfassungen
  und Vault-Notizen langsam (etwa ein Jahr), und angeheftete Zusammenfassungen
  altern nie. Bei einer Vault-Notiz heißt Alter, wann EYAS sie zuletzt indexiert
  hat — wann sich die Notiz zuletzt geändert hat; bei einer früheren Nachricht,
  wann sie geschrieben wurde. (Vorher galt jede Notiz und jede frühere Nachricht
  als brandneu.)
- **Wer es geschrieben hat, wiegt mit.** Deine eigenen Nachrichten und Text von
  EYAS-Agenten oder -Modellen zählen voll; Tool-Ausgaben und importierter Text
  Dritter wiegen 0,6×; Text von Kanal-Absendern wiegt 0,3×. Dafür nutzt EYAS das
  Vertrauen, das es beim Speichern festgehalten hat (siehe [Vertrauen: wer es geschrieben hat](#trust-who-wrote-it)).
- **Nie abgerufen:** Text, der als mögliche Prompt-Injection markiert ist
  (unter Quarantäne), auch nicht über die Zusammenfassung des Gesprächs, aus dem
  er stammt, das eigene Reasoning eines Modells und aufgezeichnete Tool-Aufrufe
  (siehe [Tool-Ergebnisse werden nicht aufgezeichnet](#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).
- **Eine frühere Nachricht sind ihre eigenen Worte.** Eine abgerufene Zeile aus
  einem früheren Gespräch zeigt den eigenen Text dieser Nachricht — die Passage
  um deine Suchwörter, höchstens 280 Zeichen — statt der Zusammenfassung des
  Gesprächs oder nur seiner Id. Vault-Notizen und frühere Nachrichten
  konkurrieren gleichberechtigt (vorher standen Stichworttreffer aus früheren
  Nachrichten immer vor passenden Notizen), und eine Notiz, die in die
  Rohaufzeichnung importiert wurde, kommt einmal zurück, als Notiz.
- Die Suche auf der Speicher-Seite (`GET /api/v1/memory/search`) und der
  `memory_search`-Fallback zeigen ebenfalls den eigenen Text früherer
  Nachrichten, nie markierten Text, Reasoning eines Modells oder aufgezeichnete
  Tool-Aufrufe.

### Die Vektorsuche läuft immer lokal {#vector-search-always-runs-locally}

Welcher Chat-Anbieter auch antwortet — Claude Code, Grok, Kimi oder ein
API-Anbieter —, EYAS wandelt Speicher auf der Maschine selbst in Vektoren um:
mit dem Modell multilingual-e5-small, wenn dessen Gewichte verfügbar sind, sonst
mit einem einfacheren eingebauten Hash-Embedder (geringere Qualität, kein
Download nötig). Speichertext wird nie an die Embedding-API eines Anbieters
geschickt, um abgerufen zu werden.

- Die Routing-Stufe **Embedding** speist nur noch den älteren Vault- und
  episodischen Suchindex; der Abruf nutzt sie nie. (Früher schaltete das Setzen
  dieser Stufe still den Vektor-Abruf von Zusammenfassungen und Fakten ab und
  schickte sie bei jedem Start an diese API.) Ändert sich der Embedder dieses
  älteren Index, wird der Index einmal geleert und automatisch neu aufgebaut.
- **Neuer Speicher ist binnen Sekunden durchsuchbar.** Wenn EYAS die gepufferten
  Nachrichten eines Gesprächs in den Speicher schreibt — beim Schließen der
  Aufgabe, nach 30 untätigen Minuten oder wenn der Puffer voll ist —, bekommen
  die daraus extrahierten Zusammenfassungen und Fakten etwa eine halbe Sekunde
  später ihre Vektoren, nicht erst nach einem Neustart.
- Überholte Zusammenfassungen, überholte oder gelöschte Fakten, Elemente in
  Quarantäne und als geheimnishaltig markierte Elemente (sofern
  `memory.recall.includeSecrets` nicht an ist) werden aus dem Vektorindex
  entfernt und belegen so keine Abrufplätze mehr.
- Das lokale e5-Modell wird auf jeder Installation beim Start geladen, auch wo
  eine Embedding-Stufe gesetzt ist (etwa 100 MB RAM). Lädt es nicht, nutzt EYAS
  den Fallback-Embedder und arbeitet weiter. `eyas doctor` zeigt in der Zeile
  **Memory embedder**, welcher genutzt wird — siehe [CLI](/docs/de/deploy/cli/#what-doctor-checks).

Es gibt nichts zu konfigurieren und nichts zu migrieren: Vektoren eines früheren
Embedders werden beim nächsten Start automatisch ersetzt.

### Weitersuchen: memory_search und memory_expand {#looking-further-memory_search-and-memory_expand}

Reicht der Abrufblock nicht, ruft das Modell `memory_search` auf und dann
`memory_expand`, um einen Treffer zu öffnen.
`search_memory` ist ein Alias von `memory_search`.

- **3 Aufrufe pro Antwort, bei jedem Anbieter.** Die drei Tools zusammen
  erlauben 3 Aufrufe pro Antwort — bei API-Modellen, Claude Code, Grok und Kimi
  gleich. Der Zähler beginnt mit jeder neuen Nachricht von dir von vorn und
  läuft nicht mitten in einer Antwort aus, wie lange die eigene Tool-Schleife
  des Modells auch läuft.
- **Eine frühere Nachricht öffnen.** `memory_expand` auf einer `rw:`-Id liefert
  den ursprünglichen Text der Nachricht, bis zu 8.000 Zeichen, mit ihrem
  Quelltyp und ihrem Vertrauen. Die Zusammenfassung des Gesprächs fügt es nur als
  Kontext hinzu, wenn diese selbst abrufbar ist (nicht markiert, nicht aus
  Geheimnissen abgeleitet, außer `memory.recall.includeSecrets` ist an).
- **Von EYAS auf dem Server an das Projekt des Gesprächs gebunden.** Was auch
  immer das Modell, eine CLI oder eine Bridge schickt: Die Tools lesen das
  eigene Projekt des Gesprächs, seinen Typ und globalen Speicher. Ein `scope`-
  oder Projekt-Argument wird ignoriert: Ein anderes Projekt anzusehen, machst du
  in der UI, nie über ein Tool-Argument. Ein Aufruf, der ein Gespräch nennt, das
  EYAS nicht kennt, liefert den Fehler *memory scope unresolved* und keine
  Ergebnisse.
- Externe Clients von EYAS' eigenem MCP-Server haben kein EYAS-Gespräch: Ihre
  Speicher-Tool-Aufrufe lesen nur globalen Speicher, begrenzt auf 3 Aufrufe pro
  90 Sekunden. Dieselbe Grenze gilt für OpenCode-Aufrufe, die an keine Aufgabe gebunden sind.
- **OpenCode** bietet dem Modell dieselben zwei Tools, mit denselben Namen und Argumenten, nur lesend. Bei einer Aufgabe, die EYAS mit `opencode_run` delegiert, sind sie an das Projekt dieses Gesprächs gebunden und teilen sich die 3 Aufrufe des aufrufenden Zugs. Überall sonst — in einer OpenCode-Terminal-Session, die im Panel gestartet wurde, in einer Session, die EYAS nicht angelegt hat, oder für einen angemeldeten Aufrufer, der nicht der Benutzer der Session ist — lesen sie nur globalen Speicher. Ein von außen angebundener OpenCode-Server hat gar keinen Zugriff auf EYAS-Speicher. Siehe [OpenCode](/docs/de/automation/opencode/).

Jeder Host listet diese Tools unter seinem eigenen Namen — `memory_search` bei
API-Anbietern, `mcp__eyas__memory_search` in Claude Code, `use_tool` mit
`eyas__memory_search` in Grok. Siehe [MCP — Tool-Namen je Host](/docs/de/ai/mcp/#tool-names-per-host).

### Dauerzeilen des Speichers {#standing-memory-lines}

Jede Zeile des Dauerindex des Speichers zeigt eine Id, die
`memory_expand` öffnet: `(vt:<Pfad>)` für eine Vault-Notiz, `(gs:<id>)` für
eine Gesprächszusammenfassung. `memory_expand` öffnet außerdem Entitäts-Ids
(`en:<id>`): Es liefert Name, Typ, Aliasse und bis zu 10 aktuelle Fakten der
Entität aus dem Speicher, den das Gespräch sehen darf.

Die Zusammenfassungszeilen im Index sind angepinnte Zusammenfassungen, die
eigene Zusammenfassung des Projekts und bis zu 5 der jüngsten
Aufgaben-Zusammenfassungen desselben Projekts (oder, außerhalb eines Projekts,
anderer projektloser Gespräche) — nie die eines anderen Projekts, nie die des
aktuellen Gesprächs selbst und nie unter Quarantäne gestellte. (Früher: die 20
wichtigsten Zusammenfassungen aus beliebigen Projekten.)

`memory.index.budgetChars` (Standard 2400 Zeichen, etwa 600 Tokens) ist die
Größe des **gesamten Abrufblocks**, Rahmen eingeschlossen: Dauernotizen,
abgerufene Notizen und Volltext-Treffer zusammen. Dieser Standard ist für ein
Modell mit 100k-Token-Kontextfenster gedacht; der Block skaliert mit dem Fenster
des antwortenden Modells (bis zum 2,5-Fachen ab 250k Tokens, weniger unter
etwa 29k Tokens und gar keiner bei einem sehr kleinen Fenster). Eine OpenCode-Aufgabe wird
genauso bemessen, für das Fenster, das OpenCode für ihr Modell listet, oder
genau `memory.index.budgetChars`, wenn dieses Fenster unbekannt ist (früher
bekam OpenCode immer den unskalierten Wert). Dauernotizen kommen zuerst, lassen aber immer Platz — bis zur Hälfte des
Blocks — für das, was für die aktuelle Nachricht abgerufen wurde. Notizen, die
nicht hineinpassen, fasst eine Schlusszeile zusammen, *… N more notes not
shown*, die das Drill-down-Tool so nennt, wie der Host es listet; sie bleiben
über `memory_search` erreichbar. Erhöhe das Budget in `config/local.yaml` (und starte
neu), wenn deine `user`- und `feedback`-Zeilen nicht mehr hineinpassen. Frühere
Versionen lieferten 8000 in `config/default.yaml` aus — siehe den
[Upgrade-Hinweis](/docs/de/deploy/configuration/#memory-index-and-recall).

Beim ersten Start nach dem Upgrade ordnet EYAS jeden vorhandenen Speichervektor
seinem Projekt zu, einmalig und in Stapeln (geloggt als *L3 repartition: vectors
filed under their project*). Kann es das nicht abschließen, loggt es eine
Warnung und versucht es beim nächsten Start erneut. Zu tun ist nichts.

### Projektnotizen ohne Projekt {#project-notes-without-a-project}

Eine Notiz mit `kind: project` oder `kind: domain`, die kein `project:` /
`projectType:` trägt, ist **global**: sie steht im Dauerindex, in
`memory_search` und im Abruf jeder Unterhaltung, gerankt als
Projektnotiz. Verschiebst du sie nach `projects/<id>/` — oder trägst `project:`
ins Frontmatter ein —, gilt sie nur noch für dieses Projekt. Importierte Notizen
bleiben so, bis du die passenden Projekte anlegst.

### Importierte Geheimnisse bleiben aus dem Abruf heraus {#imported-secrets-stay-out-of-recall}

Der Importer verwirft nie eine Datei, weil sie Zugangsdaten enthält. Sie wird wörtlich gespeichert, und das Element trägt den Tag `contains-secrets` — als Notiz-Tag, als Skill-Fähigkeit oder als episodischen Tag, je nachdem, wozu es geworden ist.

Standardmäßig bleibt ein solches Element aus allem heraus, was das Modell von sich aus erreicht: dem Dauerindex, dem Abruf, `memory_search`, dem Reflexions-Job, dem nächtlichen Konsolidierer und dem Skill-Matcher. Es wird nie eingebettet und nie dem optionalen Anreicherungsmodell übergeben. Die Speicher-Seite zeigt es dir weiterhin vollständig.

**Alles daraus Abgeleitete bleibt ebenfalls draußen.** Der Tag geht von der Notiz oder Episode auf ihre Kopie in der Rohaufzeichnung über, auf jeden Fakt, den EYAS daraus extrahiert hat, und auf jede daraus gebaute Zusammenfassung; ein schon bekannter Fakt wird ebenfalls geheim, wenn eine getaggte Notiz ihn später bestätigt. Eine solche Rohzeile, ein solcher Fakt oder eine solche Zusammenfassung wird nicht eingebettet, nicht in den Dauerzeilen gelistet, nicht von `memory_search` oder `GET /api/v1/memory/search` geliefert und lässt sich nicht mit `memory_expand` öffnen. Beim Aufklappen einer Entität bleiben ihre geheimen Fakten weg, und eine frühere Nachricht, deren Gesprächszusammenfassung geheim ist, erscheint ohne diese Zusammenfassung. (Vorher konnten diese abgeleiteten Fakten und Zusammenfassungen das Modell noch erreichen.) Eine Notiz, die mit `contains-secrets` im Frontmatter direkt auf die Platte geschrieben wurde, gilt als geheim, noch bevor der Vault-Indexer sie gesehen hat.

Mit `memory.recall.includeSecrets: true` in `config/local.yaml` und einem Neustart öffnest du all das dem Modell, wie bisher.

**Upgrade.** Beim ersten Start nach dem Upgrade markiert EYAS die vorhandenen Rohzeilen, Fakten und Zusammenfassungen, die aus getaggten Notizen und Episoden stammen — einmalig, vor dem Aufbau der Vektoren — und loggt eine Zeile. Bekommt später eine weitere Notiz oder Episode den Tag, markiert der nächste Start auch deren abgeleitete Zeilen. Markierungen kommen nur hinzu: `contains-secrets` von Hand aus einer Notiz zu entfernen macht die bereits daraus abgeleiteten Zusammenfassungen und Fakten nicht wieder abrufbar.

Dieses Tor verhindert die automatische Aufnahme; ein Dateisystem-Sandkasten ist es nicht. Ein Agent mit Dateilese-Werkzeugen kann die ursprüngliche Datei auf der Platte weiterhin lesen. Eine importierte Agenten-Persona und eine freigegebene Workspace-Regeldatei sind gar nicht abgeschirmt — dort ist der Inhalt *der* Prompt —, prüfe diese Zeilen also vor der Freigabe.

Die Tags `legacy` (ein alter Speicherordner) und `third-party` (fremde Produktdokumentation) bezeichnen ganz normale, voll abrufbare Notizen; sie sagen nur, woher eine Notiz kommt. Jedes importierte Element trägt außerdem `source:<adapter>` und nennt damit den Adapter, der es gelesen hat. Eine selbst geschriebene Notiz darf `contains-secrets` in ihrem eigenen Frontmatter deklarieren und wird genauso behandelt. Siehe [Datenimport & -export](/docs/de/admin/data-port/).

### Speicher und Datenschutz {#memory-and-privacy}

EYAS speichert Speicher roh und maskiert ihn auf dem Weg hinaus. Geht Speicher an ein entferntes Modell — in den Prompt eingefügt oder als Ergebnis von `memory_search`, `memory_expand` und den anderen Speicher-Tools —, maskiert die Datenschutzrichtlinie ihn für dieses Ziel, und derselbe Speicher-Eintrag wird auf beiden Wegen gleich maskiert. Ein lokales Modell (Loopback oder ein Host, der in der Datenschutzrichtlinie als lokal eingetragen ist) bekommt ihn unmaskiert. Vault-Notizen werden zusätzlich beim Schreiben im Ruhezustand maskiert (Datumsangaben bleiben erhalten).

Speicher-Tool-Ergebnisse werden auf **jedem** Weg, auf dem ein Modell EYAS-Speicher lesen kann, gleich maskiert: API- und lokale Anbieter, die prozessinternen EYAS-Tools von Claude Code, Grok und Kimi über EYAS' MCP-Bridge, externe MCP-Clients von EYAS' eigenem MCP-Server und der OpenCode-Sidecar (sein Aufgaben-Prompt, der mit der Aufgabe geschickte abgerufene Speicher und die Antworten seiner Tools `memory_search` / `memory_expand`). Eine CLI, ein externer MCP-Client und OpenCode gelten immer als entfernt. Scheitert der Datenschutz-Scan, wird das Ergebnis zurückgehalten, statt unmaskiert gesendet zu werden. Siehe [Sicherheit & Datenschutz — Wo maskiert wird](/docs/de/admin/security-privacy/#where-masking-applies).

### Speicher außerhalb von EYAS wird verweigert {#memory-outside-eyas-is-refused}

Agenten wird gesagt, dass EYAS-Speicher der einzige Speicher ist, den sie haben, dass EYAS ihn aufzeichnet und dass sie ihn mit `memory_search` / `memory_expand` erreichen. Das wird auch durchgesetzt:

- **Das Security-Gate verweigert Lesen wie Schreiben** im Speicher anderer Tools (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, die Ordner von OpenCode, `ai-memory`-Ordner und der Rest der Liste), in Obsidian-Vaults, in jedem Pfad aus `security.foreignMemoryPaths`, in EYAS' eigenem Datenordner (Vault, Datenbank, Schlüssel, die CLI-Anmelde-Homes) und im Workspace eines anderen Gesprächs — für jedes Modell und jeden Tool-Aufruf, den das Gate prüft. Das Modell erfährt zum Beispiel *Memory outside EYAS (Claude Code) — use memory_search / memory_expand from EYAS* — außer bei Grok CLI, das seine Antwort beim verweigerten Aufruf beendet, ohne dass sein Modell den Grund sieht (siehe [Anbieter — Grok CLI und Kimi Code CLI](/docs/de/ai/providers/#grok-cli-and-kimi-code-cli)). Früher waren nur Schreib- und Shell-Zugriffe auf `~/.claude`, `~/.grok` und `ai-memory` blockiert, Lesen war erlaubt.
- **Claude Codes eigene Tools** durchlaufen dieselbe Prüfung vor dem Lauf, auch Lesezugriffe, die Claude Code in seinem Arbeitsordner sonst selbst erlauben würde.
- **Suchen werden danach beurteilt, was sie erreichen können.** Die eigene Suche einer CLI (Grep, Glob, ein rekursiver Shell-Befehl), deren Ordner den Speicher eines anderen Tools, einen Vault oder EYAS' Daten enthält, wird als *Search too broad* abgelehnt, weil die CLI diesen Ort nicht auslassen kann; und ein Ordner, der einen solchen Ort enthält, lässt sich nicht mehr speichern. Siehe [Sicherheit & Datenschutz — Speicher außerhalb von EYAS](/docs/de/admin/security-privacy/#memory-outside-eyas).
- **Die Kernel-Datei-Sandbox.** Die Shell-Befehle von Claude Code und die
  eigenen Tools von Grok CLI laufen außerdem in der Datei-Sandbox des
  Betriebssystems, wo eine verfügbar ist; sie sperrt dieselben Orte auch dann,
  wenn ein Shell-Befehl sie auf Wegen erreicht, die EYAS nicht lesen kann (siehe
  [Anbieter — Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox)).
  **Sicherheitsereignisse** listet in seiner Karte **Speicher außerhalb von EYAS**,
  was auf diesem Server geschützt ist.
- **Die CLIs laufen isoliert.** Claude Code lädt keine Host-`CLAUDE.md`, Einstellungen, Skills, MCP-Server oder Auto-Memory; Grok CLI und Kimi Code CLI laufen in ihrem eigenen EYAS-Home und sehen `~/.grok`, `~/.kimi` oder `~/.claude` nie. Siehe [Anbieter](/docs/de/ai/providers/#claude-code-isolation).
- **MCP-Server, die einen zweiten Speicher führen** (der Wissensgraph-Server Memory, Qdrant, Obsidian, MCPVault, …) oder auf einen geschützten Ordner zeigen, sind für jedes Modell gesperrt. Siehe [MCP](/docs/de/ai/mcp/#memory-store-servers-are-blocked).

**Migration.** Agenten, die früher `~/.claude/CLAUDE.md`, `~/.grok`-Speicher, Vault-Notizen oder Dateien unter `data/` direkt lasen, werden jetzt abgelehnt (Sicherheitsereignisse zeigt jede Ablehnung). Hole dieses Wissen einmal mit dem [Datenimport](/docs/de/admin/data-port/) in EYAS. Details und was noch nicht abgedeckt ist: [Sicherheit & Datenschutz — Speicher außerhalb von EYAS](/docs/de/admin/security-privacy/#memory-outside-eyas).

---

## Die Rohaufzeichnung {#the-raw-record}

**Nichts Gesagtes geht verloren.** Jede Nachricht, die EYAS festhält — deine, die
des Assistenten und die Ausgaben von Agentenläufen im Hintergrund — wird jetzt
ein zweites Mal wörtlich aufbewahrt, in einer Rohaufzeichnung neben dem Gespräch
selbst. Sie wird beim Schreiben komprimiert (auf echtem Text rund 2,7× kleiner)
und unter einem Hash ihrer eigenen Bytes abgelegt; derselbe Satz, innerhalb eines
Gesprächs wiederholt, liegt also einmal da und zählt zweimal.

**Was sie liest.** Es gibt keine Seite und keinen Befehl, der dir die
Rohaufzeichnung zeigt. Der Assistent erreicht sie nur über den Speicherabruf,
im selben Projektbereich wie alles andere: Die Zusammenfassungen und Fakten, die
EYAS daraus ableitet (unten), erscheinen als Dauerzeilen und Suchtreffer, und
`memory_search` / `memory_expand` können sie und Rohzeilen öffnen — siehe
[Welchen Speicher ein Gespräch sieht](#which-memory-a-conversation-can-see).

Was sich heute für dich ändert, ist, wo deine Worte liegen. Ein Gespräch ist
nicht mehr die einzige Kopie dessen, was darin gesagt wurde: Schließen,
Archivieren oder Löschen eines Gesprächs lässt die Rohaufzeichnung stehen, und es
gibt nirgends einen Knopf, der sie löscht. Wenn du das nicht willst, schalte die
Rohaufzeichnung ab, bevor du EYAS für etwas benutzt, das du später weghaben
möchtest (siehe unten).

Geschrieben wird gebündelt, nicht sofort. Nachrichten werden je Gespräch
gehalten und rausgeschrieben, wenn das Gespräch geschlossen wird (oder in eine
geschlossene Stage wandert), wenn rund 8.000 Token aufgelaufen sind, wenn das
Gespräch 30 Minuten untätig war, oder wenn EYAS herunterfährt — ein Neustart
verliert nichts, was schon gesagt war.

Jede Nachricht bekommt außerdem einen Stempel, woher sie stammt, und dieser
Stempel wird nie vererbt. Eine Zusammenfassung oder ein Fakt kann nie mehr
Vertrauen genießen als die Worte, aus denen sie gemacht sind — siehe
[Vertrauen: wer es geschrieben hat](#trust-who-wrote-it).

### Vertrauen: wer es geschrieben hat {#trust-who-wrote-it}

Wie sehr EYAS einem gespeicherten Text vertraut, hängt davon ab, **wer ihn
geschrieben hat**, nicht davon, auf welcher Seite des Gesprächs er stand.

| Vertrauen | Was dazu gehört |
|-----------|-----------------|
| **owner** | Was du in einem Gespräch tippst, auch in einem God-Mode-Zug |
| **derived** | Text, den ein Agent oder EYAS selbst geschrieben hat: die Antworten des Modells, eine Aufgabe, die ein Agent an einen anderen delegiert, ein Übergabe-Auftrag, der Prompt, den Prompt Coach / Prompt Enhancer um deinen Entwurf baut, das Ziel einer Board-Karte, wenn sie im Hintergrund läuft, und der Auftrag, den ein Team-Mitglied bekommt |
| **peer** | Nachrichten von Kanal-Absendern (Telegram, E-Mail und andere Kanäle) und Aufgaben, die ein anderes System über A2A schickt, sowie die Vault-Notizen, die die Speichererfassung daraus zieht (`trust: peer`) |
| **ingested** | Tool-Ausgaben |
| **quarantined** | Markierter Text — behalten, aber nie abgerufen |

Fakten und Zusammenfassungen genießen nie mehr Vertrauen als der Text, aus dem
sie stammen; eine Zeile wie *Target model: X* in einem Coach-Prompt oder
*Deadline: Freitag* in einer delegierten Aufgabe kann also kein Fakt auf
Owner-Ebene mehr werden. Auch der Abruf gewichtet diese Stufen (siehe
[Wie der Abruf rankt](#how-recall-ranks)): Tool-Ausgaben und importierter Text
Dritter zählen 0,6×, Kanal-Absender 0,3×, Text unter Quarantäne nie.

**Auch Hintergrund- und Team-Anweisungen werden gespeichert:** das Ziel einer
Karte, wenn ein Hintergrundlauf sie startet, und der Auftrag jedes
Team-Mitglieds. Jede unterschiedliche Anweisung wird einmal gespeichert, egal
wie oft der Lauf wiederholt oder fortgesetzt wird. Im Gespräch selbst erscheint
nichts Neues.

**Auch Vault-Notizen haben eine Vertrauensstufe.** Eine Notiz, die ein Modell
geschrieben hat, ist *derived*, nicht deine — die automatischen Notizen pro Zug,
die nächtliche Konsolidierung und Team-Zusammenfassungen. Du erkennst sie an
einem `origin`-Eintrag im Frontmatter (`by: capture`, `consolidation` oder
`team`, plus Anbieter, Modell und Gespräch, soweit bekannt), am Tag
`auto-consolidated` oder an ihrer Verknüpfung mit dem Gespräch, das sie erfasst
hat. Entfernst du das `origin` einer Notiz von Hand, wird eine Capture-Notiz
dadurch nicht wieder Owner-vertrauenswürdig, weil die Capture-Verknüpfung sie
weiterhin kennzeichnet. Eine Notiz, die die Erfassung aus einer Kanalnachricht oder
einer A2A-Aufgabe gezogen hat, trägt `trust: peer` und wird mit Peer-Vertrauen
gespeichert; sie bestärkt nie eine Notiz mit höherem Vertrauen, ein wiederholter
Fakt bekommt also eine eigene Datei. Notizen, die du von Hand
geschrieben oder selbst importiert hast, bleiben *owner*. Du kannst `trust:` ins
Frontmatter einer Notiz schreiben, aber es kann die Stufe nur **senken**, nie
anheben: `trust: quarantined` hält eine Notiz aus den Dauerzeilen des Speichers
heraus, und der Assistent kann sie nicht mit `memory_expand` öffnen (die Datei
bleibt im Vault und im Vault-Browser).

**Upgrade.** Beim ersten Start nach dem Upgrade liest EYAS jede Vault-Notiz
einmal, um ihre Vertrauensstufe festzuhalten; dieser Start dauert also etwas
länger. Einige Sekunden später korrigiert ein einmaliger Hintergrunddurchlauf
den Speicher bestehender Vault-Notizen — vom Modell geschriebene Notizen
verlieren die Owner-Stufe, Projektnotizen wandern in ihr Projekt — und baut ihre
Fakten und Zusammenfassung neu. Zu tun ist nichts, und der Durchlauf wiederholt
sich nicht.

<h3 id="what-eyas-works-out-from-it--with-no-model-call">Was EYAS daraus ableitet — ohne Modellaufruf</h3>

Immer wenn ein Bündel geschrieben ist, liest EYAS zurück, was es gerade
geschrieben hat, und ermittelt selbst:

- **Fakten** aus `key: value`-Zeilen im Text, dazu ein paar aus der Board-Karte
  des Gesprächs (Titel, Projekt, Projekttyp, Agent);
- **eine kurze Zusammenfassung** von höchstens 280 Zeichen — erste und letzte
  Nachricht plus ein paar der charakteristischsten Sätze dazwischen;
- **Entitäten**: Daten, `@mentions`, `#tickets`, Code-Bezeichner, Begriffe in
  Backticks, großgeschriebene Namen;
- **Themen** und einen **Wichtigkeitswert** aus Länge des Gesprächs, deinem
  Anteil daran, Entscheidungs-Formulierungen (in fünf Sprachen), ob es
  geschlossen ist und ob du es angepinnt hast.

Nichts davon ruft ein Modell auf. Kein Anbieter wird kontaktiert, kein API-Key
benutzt, kein Budget ausgegeben, und es gibt nichts zu konfigurieren. Der Preis
dafür: Es liest sorgfältig, nicht clever — es findet, was klar dasteht, und
übersieht, was nur mitgemeint war.

Fakten häufen sich nicht an. Dasselbe noch einmal zu sagen, verknüpft mit dem
Fakt, der schon da ist. Etwas Neues zum selben Gegenstand zu sagen — eine Frist,
die von Montag auf Freitag rutscht — setzt den alten Fakt mit einem Enddatum
außer Kraft, statt ihn zu überschreiben: genau eine gültige Antwort, und eine
unversehrte Historie dahinter. Nichts wird an Ort und Stelle geändert, nichts
weggeworfen. Ein Fakt erbt auch nie ein Projekt- oder Gesprächs-Label, das nicht
alle seine Quellen tragen.

Zusammenfassungen und Fakten sind das, was die Dauerzeilen des Speichers
(`gs:`-Ids), der Abruf, `memory_search` und `memory_expand` lesen. Ihre
Suchvektoren bekommen sie etwa eine halbe Sekunde, nachdem ein Bündel
geschrieben ist (siehe
[Die Vektorsuche läuft immer lokal](#vector-search-always-runs-locally)).

### Was es kostet, und wie du es abschaltest {#what-it-costs-you-and-how-to-switch-it-off}

Die Rohaufzeichnung wächst mit der Nutzung, und **nichts räumt sie bisher auf** —
in dieser Version gibt es keine Aufbewahrungseinstellung und keinen Cleanup-Job.
Gemessen kostet eine aufgezeichnete Nachricht inklusive Indizes
größenordnungsmäßig 5 KB auf der Platte; erwarte also, dass die Datenbank
spürbar schneller wächst als bisher.

Drei Einstellungen in `config/default.yaml`, alle unter `memory`:

| Einstellung | Default | Bedeutung |
|-------------|---------|-----------|
| `memory.l0.enabled` | **an** | Hauptschalter. `false` zeichnet gar nichts auf; wirkt ab dem nächsten Neustart |
| `memory.l0.extractInLegacy` | **an** | `false` behält den Text und leitet nichts daraus ab — keine Fakten, keine Zusammenfassungen, keine Themen |
| `memory.engine` | `legacy` | Entscheidet nur, ob die deterministische Fakten-Extraktion läuft: `v2` extrahiert immer; `legacy` extrahiert, solange `memory.l0.extractInLegacy` an ist (der Default). Der Abruf ist immer der auf dieser Seite beschriebene geschichtete Abruf, egal welcher Wert gesetzt ist |

`memory.capture.enabled: false` schaltet die Rohaufzeichnung **nicht** ab. Dieser
Schalter regelt Vault-Notizen und den kleinen Modellaufruf dahinter; die beiden
sind unabhängig, und eines abzuschalten lässt das andere laufen.

`eyas doctor` meldet, ob Kompression verfügbar ist und welche Implementierung
benutzt wird. Ist keine da, sagt EYAS das im Log und zeichnet nichts auf, statt
still einen Puffer zu füllen.

<h3 id="tool-results-are-not-recorded--and-why-to-leave-it-that-way">Tool-Ergebnisse werden nicht aufgezeichnet — und warum das so bleiben sollte</h3>

`memory.l0.captureToolResults` ist **standardmäßig aus**. Lies das, bevor du es einschaltest.

Ein Schalter deckt jedes Tool ab, das ein Agentenlauf aufruft, egal welches Modell antwortet: EYAS' eigene Tools; EYAS-Tools, die Claude Code, Grok oder Kimi über die EYAS-Bridge aufrufen; und die eingebauten Tools von Claude Code, Grok und Kimi — Befehle ausführen, Dateien lesen, schreiben oder durchsuchen. Er gilt auch für OpenCode: für die Tools, die OpenCode in einer `opencode_run`-Aufgabe ausführt, und für die Ausgabe des OpenCode-Terminals des Gesprächs (das Terminal-Symbol in der oberen Leiste des Gesprächs) — aufgezeichnet nur für ein Gespräch, das existiert und dem Benutzer des Terminals gehört. Die endgültige Antwort und die Diffs von OpenCode sind das Ergebnis von `opencode_run` und werden wie jedes andere Tool-Ergebnis aufgezeichnet. (Vorher speicherte OpenCode Terminal-Ausgabe und Ereignisse unabhängig von diesem Schalter.)

- Aufgezeichnet werden nur Aufrufe, die tatsächlich gelaufen sind. Ein fehlgeschlagener Aufruf wird aufgezeichnet und als Fehler markiert. Abgelehnte, übersprungene und auf Freigabe wartende Aufrufe werden nicht aufgezeichnet, ebenso wenig leere Ergebnisse oder Wiederholungen desselben Aufrufs.
- Jeder aufgezeichnete Aufruf behält, was der Aufruf zurückgegeben hat: den Tool-Namen, die Ausgabe, ob er fehlschlug, das Ergebnis und wer ihn ausgeführt hat (EYAS oder die eigene CLI des Modells). Die ersten 2.048 Zeichen seiner Argumente liegen nur als Herkunftsangabe daneben: Sie werden nicht im Volltext indexiert und prägen nie die Themen, Namen oder Fakten, die EYAS gewinnt.
- Aufgezeichnet werden nur Aufrufe innerhalb eines Agentenlaufs, der zu einem Gespräch gehört. Ein Tool, das außerhalb jedes Agentenlaufs aufgerufen wird (etwa von einem externen MCP-Client), wird nicht aufgezeichnet. Terminal-Ausgabe wird nur für ein Gespräch aufgezeichnet, das existiert und dem Benutzer des Terminals gehört.
- Aufgezeichnete Aufrufe liegen im Projekt des Gesprächs, mit dem Vertrauen *ingested* (siehe [Vertrauen: wer es geschrieben hat](#trust-who-wrote-it)).

Eingeschaltet behält die Rohaufzeichnung die **gesamte Ausgabe jedes Tool-Aufrufs, wörtlich und unbearbeitet**, dazu die ersten 2.048 Zeichen seiner Argumente. Also die vollständige Ausgabe eines Befehls, den Inhalt jeder Datei, die der Assistent liest, und jeden Einmalcode und jedes Token, das ein Tool zufällig zurückgibt — alles als gewöhnlicher Text in der Datenbank. Nichts maskiert es, nichts prüft es, und Kompression ist keine Verschlüsselung. Vault-Notizen laufen vor dem Schreiben durch das Datenschutz-Modul; aufgezeichnete Tool-Ergebnisse nicht.

**Was in einen Prompt zurückkommt.** Ein aufgezeichneter Tool-Aufruf wird nie abgerufen oder zitiert: nicht im Speicher, den EYAS einer Runde beifügt, nicht über `memory_search` oder `memory_expand`, nicht in der Suche auf der Speicher-Seite und nicht in der Zusammenfassung seines Gesprächs. Nur seine Ausgabe prägt die Themen und die Namen (etwa einen Datei- oder Funktionsnamen), die EYAS aus dem Gespräch gewinnt; die Argumente prägen nichts. Ein Passwort, das ein Tool in ein Formular eingetragen hat, ein Suchbegriff oder ein Pfad, den das Modell übergeben hat, wird also nie zu einem Thema, einem Namen oder einem Fakt, und ein Token, das ein Befehl ausgegeben hat, oder eine Webseite, die ein Tool abgerufen hat, taucht nie im Prompt eines anderen Gesprächs wieder auf — auch nicht, wenn dieser Prompt an ein entferntes Modell geht.

`memory.l0.toolResultMaxBytes` (8 KB) deckelt den Datensatz dessen, was der Aufruf zurückgegeben hat — Tool-Name, Ausgabe, Fehler-Flag, Ergebnis und wer ihn ausgeführt hat —, geschnitten an einer Zeichengrenze und sichtbar als gekürzt markiert. Die Argumente zählen nicht mit; sie werden getrennt auf ihre ersten 2.048 Zeichen gekürzt. Bei eingeschaltetem Schalter loggt EYAS bei jedem Start eine Warnung, dass Tool-Ergebnisse wörtlich und ungeschwärzt gespeichert werden und nichts sie prüft oder verschlüsselt.

### Reasoning der Modelle (nur zur Prüfung) {#model-reasoning-audit-only}

`memory.l0.captureThinking` (default **aus**) behält das Reasoning („Thinking“)
jedes Modells, das es meldet, in der Rohaufzeichnung — ein Eintrag pro
Modellaufruf. Es dient nur der Prüfung: Es wird nie zu Fakten und nie in einen
Prompt abgerufen. Es wird wie Tool-Ergebnisse wörtlich und ungeschwärzt
gespeichert, und solange es an ist, gibt EYAS beim Start eine Warnung aus.

Beide Schalter werden zu Beginn jedes Laufs aus der laufenden Konfiguration
gelesen; eine Änderung in `local.yaml` gilt nach einem Neustart von EYAS.

**Herkunft.** Aufgezeichnete Tool-Ergebnisse und Reasoning sowie die Antworten
von Hintergrund-, Team- und delegierten Läufen halten jetzt Anbieter und Modell
fest, die tatsächlich geantwortet haben (nicht immer die angeforderten, etwa
nach einem Fallback), und wie der Lauf begann: interaktiv, Hintergrund, Team,
Delegation, A2A, Kanal oder Pipeline. Älteren Zeilen fehlen diese Felder einfach.

### Warum manche Sätze abgelehnt werden {#why-some-sentences-are-refused}

Text, der sich wie eine Anweisung an den Assistenten liest, darf kein
vertrauenswürdiger Fakt werden. „Ignoriere alle vorherigen Anweisungen“, ein
Rollenwechsel der Art „ab jetzt bist du …“ oder alles, was wie eine
System-Nachricht aufgemacht ist, wird rundheraus abgelehnt. Schlichte Befehle an
den Assistenten, Aufforderungen, ein Tool auszuführen, und Formulierungen der Art
„vergiss alles“ bleiben erhalten, werden aber als nicht vertrauenswürdig
markiert, damit ein späterer Abruf sie weglassen kann. Die Prüfung deckt
Englisch, Ungarisch, Deutsch, Spanisch und Französisch ab.

Wird eine Zusammenfassung abgelehnt, steigt EYAS ab, statt aufzugeben: zuerst auf
eine schlichtere Zusammenfassung, dann auf nur die Sätze, die sauber lesen,
zuletzt auf einen Stummel, der das Gespräch benennt, ohne seinen Text zu
wiederholen. Du verlierst nie das Gespräch, nur dessen Zusammenfassung.

Das ist ein Musterfilter, kein Beweis, und er irrt in Richtung Vorsicht:
gewöhnliche Arbeitsprosa wie `Führe folgenden Befehl im Pod aus: …` wird manchmal
ebenfalls als nicht vertrauenswürdig markiert. Text, der als mögliche
Prompt-Injection markiert ist (unter Quarantäne), wird nie abgerufen oder mit
`memory_expand` geöffnet, auch nicht über die Zusammenfassung des Gesprächs, aus
dem er stammt.

**Notizen, die ein Modell schreibt, durchlaufen denselben Filter.** Die
Speichererfassung pro Zug, die nächtlichen Konsolidierungszusammenfassungen und
die Zusammenfassungen von Team-Sessions werden geprüft, bevor etwas in den Vault
geschrieben wird, und jeder Treffer verhindert das Schreiben:

- **Capture:** Die abgelehnte Notiz fällt weg. Der Capture-Lauf wird mit dem
  Grund `poison_gate` festgehalten und zählt gegen `maxPerConversation`, weil
  das Modell aufgerufen wurde.
- **Konsolidierung:** Es wird nichts geschrieben, und die episodischen
  Erinnerungen bleiben; der nächste nächtliche Lauf versucht es erneut.
- **Team-Sessions:** Nur der beanstandete Befund oder die beanstandete
  Entscheidung wird weggelassen.

Ablehnungen erscheinen im Server-Log mit dem Namen des Detektors, nie mit dem
abgelehnten Text — ein Fehlalarm ist also sichtbar, nie still.

---

## Speicher eines Anbieters unter Quarantäne stellen {#quarantine-a-providers-memory}

Nutze das, wenn ein Modell — typischerweise eine CLI wie Grok CLI, Kimi Code CLI oder Claude Code — ohne EYAS' Isolation lief und womöglich aus Speicher außerhalb
von EYAS geantwortet hat, etwa aus dem Speicherordner eines anderen Werkzeugs
oder einem Obsidian-Vault. Seine Antworten wurden wie jeder andere Zug im
EYAS-Speicher abgelegt und konnten so zu jedem Modell zurückkommen.

**Wo:** **Speicher → Übersicht**, Karte **Speicher eines Anbieters unter
Quarantäne stellen**. Nur der Owner kann sie nutzen; Admins und User sehen *Nur
der Eigentümer kann Speicher unter Quarantäne stellen oder freigeben.*

1. Einen oder mehrere **Anbieter** ankreuzen. Die Liste zeigt jeden Anbieter,
   der Speicher geschrieben hat, mit der Zahl seiner Zeilen, die noch abrufbar
   sind.
2. Optional **Von** / **Bis** setzen. Das sind ganze lokale Tage, jeweils
   einschließlich; leer heißt ohne Grenze.
3. **Vorschau** klicken. Sie zeigt, wie viele Rohzeilen, Fakten,
   Zusammenfassungen und Erfassungsnotizen verborgen würden, und aus wie vielen
   Gesprächen. Noch ändert sich nichts.
4. **Quarantäne** klicken und direkt dort bestätigen. Abbrechen ändert nichts.

**Was vor jedem Modell verborgen wird**, auf jedem Weg (der Speicherblock pro
Zug, `memory_search` / `memory_expand`, der Dauerindex des Speichers und die
Vektorsuche):

- die Antworten des Anbieters und die Tool-Ausgaben seiner Läufe — nach dem
  Anbieter, der an jeder Zeile festgehalten ist; ältere Zeilen ohne diesen
  nutzen den Anbieter, auf den das Gespräch festgelegt ist;
- jeder daraus abgeleitete Fakt und jede daraus abgeleitete Zusammenfassung,
  einschließlich einer Gesprächszusammenfassung, die auch deine Nachrichten
  umfasst, und jedes Fakts mit mindestens einer solchen Quelle;
- die Erfassungsnotizen der betroffenen Gespräche. Sie wandern in den
  Vault-Ordner `.quarantine/<id>/…` und fallen damit aus dem Vault-Browser, dem
  Notizindex und der Suche heraus.

**Was nicht betroffen ist:** Deine eigenen Nachrichten kommen nie unter
Quarantäne; das Transkript des Gesprächs bleibt unverändert; nichts wird
gelöscht. Künftige Züge des Anbieters werden weiterhin normal gespeichert — die
Quarantäne ist eine Bereinigung, keine Sperre; stell das Gespräch also auf ein
anderes Modell um oder sorge dafür, dass die CLI isoliert läuft. Semantische
Notizen, die die nächtliche Konsolidierung aus mehreren Gesprächen geschrieben
hat, tragen keine Verknüpfung zu einem Gespräch und werden nicht
zurückverfolgt; prüfe sie im Vault-Browser.

**Verlauf und Freigabe.** Der **Verlauf** listet jede Quarantäne mit ihren
Anbietern, Zeitpunkt und Zählern und einem Knopf **Freigeben** (oder
*Freigegeben &lt;Datum&gt;*). Die Freigabe stellt genau die Vertrauensstufen
wieder her, die die Zeilen vorher hatten, und verschiebt die Notizen zurück.
Hat eine neue Notiz inzwischen den Pfad einer wiederhergestellten Notiz belegt,
kommt die alte als `<name>-restored.md` zurück, weiterhin als von einem Modell
geschrieben markiert. Eine Notiz, die von Hand aus dem Ordner `.quarantine`
gelöscht wurde, wird als fehlend gemeldet; alles andere wird trotzdem
wiederhergestellt. Was die automatische Vergiftungsprüfung schon unter
Quarantäne gestellt hatte, bleibt dort, ebenso Fakten und Zusammenfassungen,
die nach der Quarantäne aus Zeilen unter Quarantäne entstanden sind. Dieselbe
Auswahl erneut unter Quarantäne zu stellen bewirkt nichts; sich überschneidende
Quarantänen lassen sich unabhängig freigeben.

**Audit.** Jedes Anwenden und Freigeben wird ins Audit-Log geschrieben (Aktionen
`memory.quarantine.apply` / `memory.quarantine.release`, Modul `memory`) und ins
Server-Log; der genaue Datensatz (Zeilen-Ids nach vorheriger Vertrauensstufe,
verschobene Notizen) bleibt im Purge-Log des Speichers erhalten.

**API (nur Owner; `delete` auf MemoryEntry).** Der Body ist `{providers:
string[], from?: epochMs, to?: epochMs, conversationIds?: string[]}`; ein
ungültiger Body bekommt `400`. `GET /api/v1/memory/quarantine` liefert
`{entries, providers}`; `POST /api/v1/memory/quarantine/preview` liefert
`{counts}`; `POST /api/v1/memory/quarantine` liefert `201 {id, counts}` oder
`200 {id: null}`, wenn nichts mehr unter Quarantäne zu stellen ist; `POST
/api/v1/memory/quarantine/:id/release` liefert `404` für eine unbekannte Id und
`409`, wenn schon freigegeben.

## Shared Memory Blocks (stillgelegt) {#shared-memory-blocks-retired}

Die Agenten-Tools `memory_block_read` und `memory_block_write` gibt es nicht
mehr. Was Agenten in Blöcken gespeichert hatten, geht nicht verloren: Beim
ersten Start nach dem Upgrade wird jeder Block einmal als von einem Modell
geschriebene Notiz in den EYAS-Speicher kopiert und ist ab dann wie jeder andere
Speicher zu finden — im Dauerabruf, mit `memory_search` und mit `memory_expand`
(als `rw:`-Treffer). Blöcke werden globaler Speicher, wie sie es in der Praxis
immer waren (jeder Agent konnte jeden Block lesen). Ein Block, dessen Text wie
eine Anweisung an den Assistenten aussieht, bleibt zur Prüfung erhalten, wird
aber nie abgerufen. Ein eigener Agent, dessen Tool-Liste noch `memory_block_*`
nennt, bekommt diese Tools einfach nicht mehr; nichts scheitert.

## Verwandt {#related}

- [Wissensbasis](/docs/de/knowledge/knowledge-base/)
- [Dokumente](/docs/de/knowledge/documents/)
- [Projekt-Wiki](/docs/de/knowledge/client-wiki/)
- [Anbieter](/docs/de/ai/providers/) (CLI-Isolation)
- [Sicherheit & Datenschutz](/docs/de/admin/security-privacy/) (Speicher außerhalb von EYAS)
- [Datenimport](/docs/de/admin/data-port/)
- [Konfiguration](/docs/de/deploy/configuration/) (`memory.l0.*`-Keys)
- [Tools](/docs/de/automation/tools/)
- [OpenCode](/docs/de/automation/opencode/) (Speicher-Tools in OpenCode)
- [Beobachtbarkeit](/docs/de/admin/observability/) (Speicherlieferung nach Provider)
