---
title: Gespräche
description: Mit Agenten sprechen — Arbeit senden, Designs anhängen, Orchestrierung steuern.
---

**Wozu das da ist.** Ein Gespräch ist der Ort, an dem du mit einem Agenten sprichst. Nachrichten stehen im Hauptbereich; Projekt, Phase, Quellen, Dateien und Laufzeit in der rechten Spalte. Derselbe Thread ist eine Board-Karte — Chat und Pipeline bleiben ein Datensatz.

## Wann du es brauchst

- Ein Agent soll eine Aufgabe erledigen, und du willst Antwort, Tool-Aufrufe und Fortschritt an einem Ort sehen.
- Du musst festlegen, welchen indexierten Codebaum (Odoo-Version, Addons) dieser Thread durchsuchen darf und welche **Arbeitsordner** Datei-Tools anfassen dürfen.
- Du willst wählen, mit welchem Modell das Gespräch antwortet — ein festes Modell, automatisches Routing oder der Standard des Kollegen (die Modellauswahl in der oberen Leiste).
- Ein passender Skill wartet — annehmen, für diesen Thread überspringen oder global abschalten.
- Das Modell soll erst einen Plan schreiben und warten, bevor ein Tool läuft (**Zuerst planen**).
- Mehrere Modelle sollen dieselbe Aufgabe im Wettlauf lösen (**God-Modus**), oder Kollegen ziehen ohne Team-Karte Spezialisten hinzu (`run_specialist`).
- Ein Design-Canvas soll mit jeder Runde mitreisen, oder der Prompt Enhancer soll den Entwurf vor dem Senden formen.

## Typischer Ablauf

1. Öffne einen **Kollegen** in der Seitenleiste unter **Kollegen** (sein Home-Thread), klicke **Neue Unterhaltung** (Bereich **Haupt**) oder öffne eine Karte vom **Board** / von Start **Letzte Unterhaltungen**. Route `/conversations/:id`.
2. Setze **Projekt:**, **Phase:** und den Agenten vor der ersten Nachricht (der Agent wird danach gesperrt). Die Agentenauswahl listet deine **Primär**- und **Team**-Kollegen. Pinne **Quellen**, wenn mehrere Codebäume indexiert sind. Prüfe **Arbeitsordner** — ein neuer Thread erbt die Liste des Projekts (oder die des Projekttyps, wenn das Projekt keine hat).
3. Tippe im Composer. Nutze den **Prompt Enhancer**, wenn der Entwurf Form braucht; das Karten-Icon ist **Zuerst planen** (Plan schreiben und vor den Tools warten). Hänge Dateien an oder, in der oberen Leiste, **Designs**.
4. Erscheint eine Skill-Karte, wähle **Verwenden**, **Diesmal nicht** oder **Abschalten**. Senden. Die Antwort streamt mit Live-Tool-Zeilen, darunter die Beschriftung *Anbieter · Modell*, und der dünne Kontextstreifen zeigt, wie voll das Fenster des Modells ist. **Stopp** bricht den Lauf ab.

## Funktionen

Aufbau: **obere Leiste** und **Feldleiste** über **Nachrichten + Composer** (Hauptbereich); rechts der **Laufzeit**-Streifen (Laufbaum, Agent-Fortschritt, Unterunterhaltungen) über der **Kontextleiste** (Chatter: Verlauf, Quellen, Ordner, nächste Schritte, Dateien).

## Gesprächsstatus

| Status | Bedeutung |
|--------|-----------|
| **Inaktiv** | Kein aktiver Agent-Lauf |
| **Arbeitet…** | Der Agent läuft |
| **Wartet** | Wartet auf Eingabe von dir oder von außen |
| **Wartet auf Freigabe** | Blockiert durch eine menschliche Freigabe (Sicherheit / Autonomie) |
| **Wartet auf Plan** | Runde mit Zuerst planen: Die Plankarte wartet auf **Freigeben** / **Plan überspringen** / **Ablehnen** |
| **Archiviert** | Geschlossener / archivierter Thread |

---

## Obere Leiste

Von links nach rechts: der Zurück-Pfeil, der Titel (zum Umbenennen anklicken — siehe [Automatischer Titel](#automatic-title)), das Status-Badge, der Name des Kollegen, ein Hilfe-Symbol, die Priorität, das OpenCode-Terminal-Symbol, das **Designs**-Symbol, der Stimmen-Bereich und die Modellauswahl. Der dünne Streifen am oberen Rand ist der Kontextstreifen ([Kontext-Zusammenstellung](#context-composition)).

| Steuerung | Bedeutung |
|-----------|-----------|
| **Niedrig / Normal / Hoch / Dringend** | Geschäftliche Priorität des Gesprächs (auch auf dem Board sichtbar) |
| Terminal-Symbol (*OpenCode-Terminal*) | Öffnet ein OpenCode-Terminal für dieses Gespräch über der rechten Leiste — siehe [OpenCode](/docs/de/automation/opencode/) |
| **Designs** (Formen-Symbol) | Canvas, die mit jeder Runde mitreisen — siehe [Angehängte Designs](#attached-designs) |
| **Stimme: …** | Der aktive Stimmen-Bereich und seine Überschreibung — siehe [Stimmen-Bereich](#voice-scope) |
| **Modell** (rechts) | Klicken, um zu wählen, wie dieses Gespräch sein Modell bestimmt. Mit Suchfeld (*Modelle suchen…*) und drei Arten von Wahl: **Festes Modell** — jedes aktivierte Modell eines aktivierten Anbieters, gruppiert als *Festes Modell · &lt;Anbieter&gt;* (etwa *Festes Modell · Claude Code CLI*); **Automatisches Routing** — EYAS wählt für jede Nachricht ein Modell; **Standard des Kollegen (&lt;Modell&gt;)** — nur bei einem Gespräch mit Kollegen und bei Unterunterhaltungen. |
| *Standardmodell — wird bei der ersten Nachricht festgelegt* | Ein neues Gespräch ohne Kollegen: Das aktuelle Standardmodell wird mit der ersten Nachricht daran festgelegt und bleibt, wenn sich die Standards später ändern |
| Tooltip | Welches Modell die nächste Nachricht beantwortet und warum, etwa *Antwortet mit Claude Code CLI / sonnet — das für diese Unterhaltung festgelegte Modell*. Andere Gründe: das eigene Modell des Kollegen; das Modell der Unterhaltung, die diese delegiert hat; das automatische Routing wählt für jede Nachricht ein Modell (angezeigt: die Standard-Stufe); das Standardmodell |
| Warnsymbol | Ein Fallback greift (das Modell des Kollegen oder das eigene Modell des Gesprächs ist nicht verfügbar, oder das automatische Routing ist aus bzw. hat keine Stufe), oder kein Modell kann antworten. Darüberfahren zeigt den Grund |
| Ausgegrautes **Automatisches Routing** | Automatisches Routing ist nicht erlaubt: *Schalte „Automatisches Routing erlauben“ unter Anbieter ein.* |
| Abgeblendete Auswahl | Der God-Modus ist an: *God-Modus verwendet den Einstellungen-Kader* |

Anbieternamen sind überall in der App gleich — in der Auswahl, in der Beschriftung der Antwort, in Fehlermeldungen und auf der Anbieter-Seite.

### Welches Modell antwortet {#which-model-answers}
Ein Gespräch behält das Modell, auf dem es läuft; Nachrichten werden nicht einzeln neu geroutet. Wie, wählst du in der Modellauswahl (oben).

- **Festes Modell.** Ein auf ein Modell festgelegtes Gespräch antwortet immer damit. Ein neues Gespräch ohne Kollegen, das kein Modell nennt, bekommt mit seiner **ersten Nachricht** den Installations-Standard — die Standard-Routing-Stufe, sonst den Standard-Anbieter, sonst den ersten aktiven Anbieter mit einem Modell, CLIs eingeschlossen — und behält ihn ab dann. Spätere Änderungen am Standard-Anbieter oder an den Routing-Stufen verschieben bestehende Gespräche nicht. Früher angelegte Gespräche behalten den Anbieter und das Modell, die schon an ihnen gespeichert sind; ein altes Gespräch ohne gespeichertes Modell bekommt mit seiner nächsten Nachricht den aktuellen Standard.
- **Standard des Kollegen.** Ein Gespräch mit einem Kollegen und eine Unterunterhaltung folgen dem eigenen Modell des Kollegen; sonst dem Modell des Gesprächs, das es delegiert hat; sonst dem Standardmodell, das mit der ersten Nachricht festgelegt wird. Ein mit `run_specialist` / `delegate_to_agent` gestarteter Spezialist, eine mit `assign_task` vergebene Karte und eine mit `create_sub_conversation` erzeugte Unterunterhaltung laufen auf dem Modell, **auf dem die delegierende Runde tatsächlich lief** — nicht auf einer Kopie der gespeicherten Einstellungen des Elterngesprächs. Der Home-Thread eines Kollegen, der durch eine Übergabe geöffnet wird, folgt dem Modell des Kollegen, nicht dem des übergebenden Gesprächs. Ist das Modell des Kollegen nicht verfügbar (sein Anbieter ist ausgeschaltet oder das Modell deaktiviert), fällt das Gespräch auf sein gespeichertes oder das Standardmodell zurück, und die Antwort hält den Hinweis `agent-binding-unavailable` fest; EYAS wählt nie einen anderen Anbieter anhand seines Namens.
- **Automatisches Routing** ist eine Wahl pro Gespräch. Nur ein auf Auto gesetztes Gespräch wird triagiert: Seine Nachricht wird klassifiziert und an die Stufe Quick, Standard, Complex oder Code geroutet. Der Schalter **Automatisches Routing erlauben** auf der Anbieter-Seite *erlaubt* es nur; solange er aus ist, ist der Eintrag in der Auswahl ausgegraut, und ein bestehendes Auto-Gespräch nutzt sein gespeichertes Modell und sagt das. Bestehende Gespräche werden nicht automatisch auf Auto umgestellt. Siehe [Routing & Budget](/docs/de/ai/routing-budget/#auto-routing).
- **Ein Modell, das du wählst, wird nie still ausgetauscht.** Wird ein Modell, das du in der Auswahl gewählt hast, später unverfügbar (es oder sein Anbieter wird ausgeschaltet, oder eine CLI bietet es nicht mehr an), antwortet EYAS nicht mit einem anderen Modell: Die Nachricht wird abgelehnt und nicht gespeichert, mit *Das Modell &lt;Anbieter&gt; / &lt;Modell&gt; ist nicht verfügbar: Es oder sein Anbieter ist ausgeschaltet. Wähle oben in der Unterhaltung in der Modellauswahl ein anderes Modell oder aktiviere es unter Anbieter.* Die Auswahl zeigt das Modell rot mit demselben Grund, und die Wahl eines anderen Modells behebt es. Hintergrundläufe von Karten auf einem solchen Gespräch scheitern genauso.
- **Modelle, die EYAS selbst festgelegt hat, fallen mit Hinweis zurück.** Der mit der ersten Nachricht festgelegte Standard, Gespräche aus der Zeit vor der Modellauswahl und das delegierende Modell einer Unterunterhaltung: Ist eines davon nicht verfügbar, antwortet das Gespräch mit dem Standardmodell und sagt das (Warnsymbol und Tooltip). Sobald sein eigenes Modell zurück ist, wechselt es automatisch zurück. Nur wenn es auch keinen Standard gibt, wird die Nachricht abgelehnt (Code `model_binding_unavailable`). Ist gar kein Modell eingerichtet, scheitert der Lauf mit *Kein Modell eingerichtet…* (Code `no_model_configured`) und wird nicht wiederholt.

**Wer geantwortet hat.** Jede Assistenten-Antwort zeigt eine kleine Beschriftung *Anbieter · Modell* (etwa *Grok CLI · grok-4*). Ihr Tooltip lautet *Beantwortet von …* und ergänzt, warum dieses Modell genutzt wurde, und einen eventuellen Fallback. Hat bei einem Failover ein anderes Modell geantwortet, nennt die Beschriftung das Modell, das tatsächlich geantwortet hat. Eine noch streamende Antwort zeigt das Modell, sobald die Runde beginnt; God-Modus-Antworten zeigen das siegreiche Modell.

**Beim Wechsel bleibt der Kontext.** Ein Wechsel von Anbieter oder Modell behält den Kontext des Gesprächs. EYAS schickt in jeder Runde das ganze Gespräch aus seinem eigenen Speicher; kein Anbieter — auch nicht Claude Code, Grok CLI und Kimi Code CLI — führt oder setzt eine eigene Session fort. Siehe [Anbieter — Gesprächskontinuität](/docs/de/ai/providers/#conversation-continuity).

**API (Integratoren).** `POST /api/v1/conversations` speichert `providerId` + `modelId` nur, wenn beide ein aktiviertes Modell eines aktiven Anbieters nennen (sonst wird nichts gespeichert, und der Standard wird mit der ersten Nachricht festgelegt), und nimmt optional `modelBinding` (`pinned` | `auto` | `inherit`; `inherit` braucht einen Kollegen, sonst `400 binding_inherit_needs_agent`) und einen Start-`effort` an. `POST /api/v1/projects/:id/conversations` (eine Karte auf einem Projekt-Board) wendet dieselbe Regel an. `PATCH /api/v1/conversations/:id` nimmt `modelBinding` und `providerId` + `modelId` an, immer zusammen gesendet und validiert (`400 model_binding_unavailable` für ein unbekanntes oder deaktiviertes Modell); ein PATCH, der ein Paar sendet, markiert es als deine Wahl (ein Flag, das der Client nicht direkt setzen kann). `GET` liefert `effectiveBinding` (Anbieter, Modell, Grund und Bildunterstützung) und `autoRoutingEnabled`, und der Live-Stream kündigt die Bindung an, wenn eine Runde beginnt. Ein Anbieter- + Modell-Override für eine Runde bei `POST …/messages` muss beides senden. Gesprächsobjekte enthalten kein `sdkSessionId` mehr, und ein `PATCH`, der eines mitschickt, wird ignoriert.

### Kontext-Zusammenstellung {#context-composition}
Der dünne Streifen am oberen Rand des Gesprächs ist klickbar: Er öffnet die **Kontext-Zusammenstellung** für die aktuelle Runde — jeden Abschnitt, der in den Prompt dieser Runde eingeflossen ist, in der Reihenfolge des Zusammenbaus, mit Größe, ob er gekürzt wurde, und Rohinhalt. Das gilt pro Runde, nicht kumulativ für das ganze Gespräch.

Die Zone **turn** enthält, was an deine Nachricht angehängt wird statt an den System-Prompt: **turn-time** (aktuelles Datum und Uhrzeit) und **memory-recall** (der Abrufblock, seine Ids und sein Budget). Der Laufzeitabschnitt enthält Datum und Uhrzeit nicht mehr, und die alten Abschnitte *memory-index* und *related-work* sind weg. Siehe [Speicher — Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model).

Die Abschnittsgrößen richten sich nach dem Modell, das die Runde beantwortet — fest oder automatisch geroutet —; ob ein Abschnitt gekürzt wurde, hängt also vom Kontextfenster dieses Modells ab. Ein Modell mit großem Fenster bekommt mehr Platz für Projektkontext und Agentendateien, ein kleines lokales Modell einen Prompt, der trotzdem Raum für das Gespräch lässt. Siehe [Prompts — auf das Modell zugeschnitten](/docs/de/ai/prompts/#prompt-size). In einer Agentenschleife zeigt die Ansicht den letzten Modellaufruf der Runde.

**Wie voll das Fenster ist.** Der Streifen zeigt, wie voll das Kontextfenster des Modells wirklich ist:

- **Gemessen.** Meldet der Anbieter die Prompt-Größe des letzten Modellaufrufs, nutzt der Streifen diese Zahl, und sein Tooltip sagt *gemessen* (Anthropic und Anthropic-kompatibel, die OpenAI-Familie einschließlich OpenRouter, Kimi API und LM Studio, Gemini und Claude Code).
- **Geschätzt.** Sonst zeigt er eine Schätzung, markiert mit `~` und *geschätzt*: der System-Prompt plus der mit der Runde gesendete Gesprächsverlauf. Ollama, Grok CLI und Kimi Code CLI zeigen immer die Schätzung (Ollama lässt den Teil weg, den es aus seinem Cache wiederverwendet; die CLIs von Grok und Kimi melden eine Summe über ihre internen Schritte).
- **Das Fenster** ist bei jedem Anbieter das eigene des gewählten Modells: Das unter Anbieter für das Modell eingetragene Fenster gewinnt, ein mit 1M-Fenster gelistetes CLI-Modell nutzt also 1M. Meldet die Laufzeit das Fenster des Modells, das geantwortet hat (Claude Code tut das), gewinnt dieses. Die festen Fenster der CLIs (Claude Code 200k, Grok 500k, Kimi 256k) sind nur der Fallback für ein Modell, für das die Liste kein Fenster hat. Die Einträge Fable, Opus, Sonnet und Haiku von Claude Code listen 200k — das Fenster, das die Laufzeit diesen Namen gibt —, auch bevor die Laufzeit ihre Modelle gemeldet hat; nur ein Eintrag, den die Laufzeit als ihre 1M-Variante anbietet (zum Beispiel *Opus (1M context)*), wird mit 1M gelistet. Stellst du das Gespräch auf ein anderes Modell um, nutzt der Streifen sofort das Fenster des neuen Modells.
- Die Farben (unter 50 % / unter 75 % / ab 75 %) folgen den Erfolgs-, Warn- und Destruktiv-Farben des Themes. Dieselbe Zahl speist den Streifen *% Kontext* der Board-Karte. Ältere Runden zeigen ihre Schätzung bis zur nächsten Runde.

**Datenschutz pro Abschnitt.** Jeder aufgezeichnete Prompt-Abschnitt hat ein Datenschutz-Badge:

| Badge | Bedeutung |
|-------|-----------|
| *N maskiert · &lt;Typen&gt;* | Werte wurden durch Platzhalter wie `[EMAIL]` ersetzt, bevor das Modell sie sah (etwa *2 maskiert · E-Mail-Adresse, IBAN*) |
| *nicht geprüft (von EYAS erzeugt)* | Identität, Regeln, die Laufzeituhr, Arbeitsordner, Tool-/Skill-/Agentenlisten und die Orchestrierungsanweisung gehen so hinaus, wie sie sind |
| *nichts maskiert* | Der Abschnitt wurde geprüft, und nichts musste maskiert werden |
| *lokales Ziel — nicht maskiert* | Das Modell läuft auf dieser Maschine (Loopback oder ein Host unter Datenschutz → Lokale Hosts), daher wird absichtlich nichts maskiert |
| Kein Badge | Für den Abschnitt wurde nichts aufgezeichnet: Abschnitte, die in deiner Nachricht mitgehen (der Speicherblock pro Runde), Abschnitte, die sich im Prompt nicht verorten ließen (sie werden trotzdem geprüft, mit dem übrigen Systemtext), und Runden, bei denen die Maskierung noch nicht aufgezeichnet wurde |

Wurde etwas maskiert, erscheint ein Umschalter **Wie zusammengestellt / Wie an das Modell gesendet**; *Wie an das Modell gesendet* zeigt den Abschnitt mit den Platzhaltern genau so, wie das Modell ihn erhalten hat. Eine Zeile nennt die genutzte Version der Datenschutzrichtlinie (*Datenschutzrichtlinie regex@2/policy@N*), und eine Zeile *Maskierte Ergebnisse von Speicher-Tools: memory_search (2), …* listet Speicher-Tool-Ergebnisse, in denen Werte maskiert wurden — auch Ergebnisse, die Claude Code, Grok und Kimi über die EYAS-Tool-Bridge geholt haben. Siehe [Sicherheit & Datenschutz — Wo maskiert wird](/docs/de/admin/security-privacy/#where-masking-applies).

**Gelieferter Speicher.** Ein Feld zeigt, welcher Speicher das Modell erreicht hat — gleich, was die Runde beantwortet hat (API-Anbieter, Claude Code, Grok, Kimi oder ein lokales Modell), eine Zeile pro Sachverhalt:

- *Bemessen für &lt;Modell&gt; · Fenster von &lt;N&gt; Tokens* — das Modell, für das Prompt und Speicherbudget bemessen wurden; *Fenster unbekannt, 100k-Token-Basis verwendet*, wenn EYAS das Fenster dieses Modells nicht kennt.
- *&lt;Treffer&gt; Einträge abgerufen (&lt;vollständig&gt; vollständig) · &lt;Tokens&gt; / &lt;Budget&gt; Tokens* — der an diese Nachricht angehängte Abrufblock (Dauernotizen plus die dafür abgerufenen Einträge), wie viele davon im Volltext angehängt wurden und die geschätzte Größe des Blocks gegenüber seiner Obergrenze für dieses Fenster. Sonst *Für diese Nachricht wurde kein Speicher abgerufen* oder *Abruf zurückgehalten: &lt;Grund&gt;* — die Antwort geht an jemand anderen als dich (einen A2A-Peer oder eine Kanal-Antwort mit externer Stimme); das Kontextfenster des Modells lässt keinen Platz; von hier aus gibt es nichts abzurufen; der Abruf ist fehlgeschlagen, und die Runde bekam nur die Uhrzeit.
- *Drill-down: &lt;Aufrufe&gt; von &lt;Grenze&gt; Aufrufen in dieser Runde · &lt;Einträge&gt; Einträge gelesen* — die eigenen `memory_search`- / `memory_expand`- / `search_memory`-Aufrufe des Modells in dieser Runde gegenüber der Grenze von 3 pro Runde (bei jedem Anbieter gleich), gezählt bis zum letzten Aufruf, der etwas gefunden hat. Runden, deren Aufrufe noch nicht gezählt wurden, zeigen nur *Einträge gelesen*. *Drill-down nicht verfügbar: die Speicher-Tools erreichen dieses Modell nicht*, wenn das Modell keine Tools aufrufen kann oder die CLI-Tool-Bridge ihren Selbsttest nicht bestanden hat.
- *System-Prompt: …* (nur Grok und Kimi) — *als System-Prompt übergeben (bestätigt)*, *als System-Prompt gesendet (nicht bestätigt)* oder *in der Nachricht mitgeschickt*.

Das Feld erscheint nicht bei Runden, die vor seiner Einführung aufgezeichnet wurden, oder wenn kein Prompt zusammengestellt wurde. Wie das übrige Detail pro Runde wird es standardmäßig 7 Tage aufbewahrt und dann gelöscht. Die Karte **Speicherlieferung nach Provider** unter [Beobachtbarkeit → Kontext](/docs/de/admin/observability/) vergleicht diese Lieferung über die Anbieter hinweg.

### Automatischer Titel {#automatic-title}
Ein neues Gespräch startet mit den ersten Wörtern deiner Nachricht als Titel; ein kurzer Modellaufruf kann ihn danach durch einen besseren ersetzen. Dieser Aufruf läuft nur auf der Routing-Stufe **Heartbeat**, als isolierter Aufruf, und wird nie dem eigenen Modell des Gesprächs oder einem anderen Anbieter berechnet. Hat die Heartbeat-Stufe kein geeignetes Modell (etwa auf einer reinen Grok- oder Kimi-Installation, bevor deren Isolation verifiziert ist), bleibt der Ausschnitt der ersten Nachricht der Titel. Klick auf den Titel, um ihn selbst umzubenennen.

### Stimmen-Bereich {#voice-scope}
| Steuerung | Bedeutung |
|-----------|-----------|
| **Stimme: INTERN / EXTERN / AUTO** | Welches Stimmprofil aktiv ist ([Stimmprofile](/docs/de/agents/voice/)); *(Standard)* hinter AUTO heißt: Der Standard des Agenten gilt, ohne Überschreibung |
| Auswahl (*Stimmen-Bereich überschreiben*) | **Auto**, **Erzwingen: Intern** oder **Erzwingen: Extern** |

---

## Gesprächsfelder (Kontext)

Die Feldleiste unter der oberen Leiste enthält von links: Projekt, Arbeitsordner, Agent, Phase, Aufwand, Orchestrierung und Fälligkeitsdatum. Zuständige und Tags erscheinen, wenn das Gespräch welche hat.

| Feld | Bedeutung |
|------|-----------|
| **Projekt:** | Zugehöriges Projekt, nach Projekttyp gruppiert (*Keine*, wenn nicht gesetzt). Ein Projektwechsel **setzt die Standard-Codequellen des Projekts** im Tab Quellen erneut (sofern du nicht in derselben Änderung ausdrücklich Quellen setzt) und ersetzt die Liste der Arbeitsordner. Vor der ersten Nachricht wählt er auch den Standard-Agenten des Projekts. |
| **Arbeitsordner** | Welche benannten Wurzeln dieser Thread lesen und schreiben darf; die Auswahl legt fest, welche **primär** ist (cwd). Ein Thread ohne eigene Ordner arbeitet in seinem eigenen **EYAS-Workspace** (siehe [Ordner](#working-folders)); **Kein Ordner** erscheint nur, wenn der Workspace-Ort nicht beschreibbar ist. Die Liste bearbeitest du im Tab **Ordner** der Leiste. |
| Agent | Zugewiesener Kollege — **nach der ersten Nachricht gesperrt** (*Der Agent kann nach der ersten Nachricht nicht mehr geändert werden*). Der Chat bietet nur die **Tools**-Liste dieses Kollegen plus `memory_search` und `memory_expand` an (ohne Kollegen die Liste des Standard-Agenten des Projekts); eine leere Liste oder gar kein Agent heißt: alle Tools. Die Liste gilt bei jedem Anbieter, und ein Modell kann kein Tool ausführen, das ihm nicht angeboten wurde. Siehe [Agenten — Tools](/docs/de/agents/configure/#tools--constraints). |
| **Phase:** | Phase in der Pipeline des Projekts |
| Aufwand | Reasoning-Tiefe. Die Auswahl listet nur die Stufen, die das Modell des Gesprächs anbietet (aus Keiner, Minimal, Niedrig, Mittel, Hoch, Sehr hoch, Maximum; ein An/Aus-Modell zeigt Aus / An). **Automatisch** speichert nichts und nennt, was es erbt — *Automatisch · Maximum (Tief)*, *Automatisch · Hoch (Kollege)*, *Automatisch · Sehr hoch (delegierende Unterhaltung)* oder *Automatisch · Modellstandard (Mittel)*. Höher = tiefer, langsamer, teurer. Eine Stufe, die das Modell nicht unterstützt, wird nicht gespeichert, und eine Meldung nennt die Stufen, die es unterstützt. Wechselt das Modell, bleibt die gespeicherte Stufe; eine, die das neue Modell nicht hat, erscheint als *Sehr hoch → Hoch (… bietet Sehr hoch nicht an)*, und jede Runde wird angepasst. Siehe [Anbieter — Reasoning-Effort](/docs/de/ai/providers/#reasoning-effort). |
| **Orchestrierung: …** | **Solo** = keine Spezialisten, Übergaben oder Teamvorschläge, bei jedem Anbieter (bei CLI-Modellen die EYAS-Bridge eingeschlossen): `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` und `propose_team` werden nicht angeboten; Speicher-Tools und `assign_task` bleiben. **Automatisch** = das Modell zieht bei Bedarf Spezialisten hinzu. **Tief** = aggressive `run_specialist`-Verteilung; Tief setzt den Standardaufwand auf Maximum, und Spezialisten ohne eigenen Aufwand übernehmen ihn. Jedes Modell bekommt dieselbe Tief-Anweisung: nicht-triviale Arbeit aufteilen, pro unabhängigem Teil einen Spezialisten parallel mit einem präzisen, in sich geschlossenen Auftrag starten, an den zuständigen Kollegen übergeben, ein Team nur vorschlagen, wenn ein benötigter Spezialist noch fehlt, wichtige Ergebnisse prüfen und die abschließende Synthese behalten. Der letzte Eintrag, **God-Modus**, lässt dieselbe Aufgabe vom Kader aus den Einstellungen im Wettlauf lösen (siehe [God-Modus](#god-modus)). |
| Fälligkeitsdatum | Frist des Gesprächs (auch ein verfolgtes Geschäftsfeld) |

### Komplexitätsanzeigen

Läuft das Gespräch nicht im einfachen Modus, zeigt ein Badge unter der Feldleiste seinen Modus, daneben die Komplexitätsklasse, wenn sie bekannt ist.

| Badge | Bedeutung |
|-------|-----------|
| **Verwaltet** | Strukturierter / überwachter Pfad |
| **Autonom** | Pfad mit höherer Autonomie |
| **Assistent** | Assistentengestützter Ablauf |

---

## Nachrichtenstrom

| Steuerung / Anzeige | Bedeutung |
|---------------------|-----------|
| *Starte eine Unterhaltung…* | Leerer Zustand |
| **Denkt nach / Denkt nach…** | Das Modell denkt nach (zeigt eventuell eine Zeichenzahl) |
| *Antwort wird verfasst…* | Die Antwort streamt |
| *Werkzeuge laufen…* | Ein oder mehrere Tools laufen |
| **Stopp** | Den aktuellen Lauf abbrechen |
| *Agent arbeitet im Hintergrund…* | Du hast die Seite verlassen und bist zurückgekommen, während der Agent noch arbeitete — Nachrichten erscheinen, wenn sie fertig sind |
| Anhang | Eingebettetes Bild oder eingebettete Datei aus dem Thread (*Datei öffnen*) |

### Tool-Zeilen {#tool-trace}
Jeder Tool-Aufruf ist eine Live-Zeile im Stream: Tool-Name, eine kurze Vorschau der Argumente, ein kurzes Ergebnis, die Dauer und ein Symbol mit seinem Status. Klick auf die Zeile klappt sie auf.

Die Zeilen sehen bei jedem Anbieter gleich aus — API-Anbieter, Claude Code, Grok CLI und Kimi Code CLI. Sie nutzen EYAS' gemeinsame Tool-Namen (`read_file`, `run_command`, `edit_file`, … oder den eigenen Namen eines EYAS-Tools wie `memory_search`), zeigen Eingabe und Ausgabe des Aufrufs (sehr lange Ausgabe wird bei 64 KiB abgeschnitten und markiert), seine Dauer und bei Datei-Edits einen Diff. Weicht der eigene Name des Anbieters für ein Tool von dem von EYAS ab (etwa *Edit* von Claude Code für `edit_file`), zeigt ihn das Darüberfahren über den Tool-Namen (*Werkzeugname beim Anbieter: …*). Der Fehlertext eines fehlgeschlagenen Aufrufs erscheint einmal.

| Status | Bedeutung |
|--------|-----------|
| **Läuft** | Der Aufruf ist unterwegs |
| **Erfolgreich** | Das Tool ist gelaufen und hat zurückgemeldet |
| **Fehlgeschlagen** | Das Tool ist gelaufen und hat einen Fehler geliefert |
| **Abgelehnt** | Verweigert — vom Security-Gate, von der Speicher-Policy (eine zu breite Suche eingeschlossen) oder weil das Modell ein Tool nannte, das ihm nicht angeboten wurde, oder ein eigenes Werkzeug einer CLI, das die **Tools**-Liste des Agenten zurückhält |
| **Freigabe nötig** | Wartet auf eine menschliche Entscheidung (siehe [Freigaben im Chat](#approvals-in-the-chat)) |
| **Übersprungen** | Nie gelaufen — Tool-Budget, Limit pro Runde oder Wiederholung in einem fortgesetzten Lauf |
| **Ergebnis unbekannt** | Die Zeile war noch offen, als die Runde endete |

Eine Zeile gilt erst als erledigt, wenn das Tool tatsächlich zurückgemeldet hat; ein abgelehnter, wartender oder übersprungener Aufruf erscheint nie grün. Siehe [Anbieter — Derselbe Chat bei jedem Anbieter](/docs/de/ai/providers/#same-chat-on-every-provider).

**Ein abgelehnter Aufruf beendet eine Grok-Antwort.** Lehnt EYAS einen Tool-Aufruf von Grok ab — etwa das Lesen von Speicher außerhalb von EYAS —, beendet Grok diese Antwort: Der Chat zeigt die Zeile **Abgelehnt** und danach nichts mehr. Groks Modell sieht den Grund von EYAS nicht; frag also erneut, ohne diesen Schritt. Claude Code läuft dagegen weiter und erhält den Grund (*Memory outside EYAS … use memory_search / memory_expand from EYAS*). Beobachtet mit Grok CLI 1.0.41; siehe [Anbieter — Grok CLI und Kimi Code CLI](/docs/de/ai/providers/#grok-cli-and-kimi-code-cli).

**Eine als zu breit abgelehnte Suche.** Beginnt die eigene Suche einer CLI (Grep, Glob, ein rekursiver Shell-Befehl) in einem Ordner, der auch einen geschützten Ort enthält, wird sie abgelehnt, und die Zeile **Abgelehnt** sagt das in deiner Sprache: *Suche zu breit: Der Ordner enthält auch den Speicher eines anderen Werkzeugs, den nur EYAS lesen darf. Das Modell wurde gebeten, in einem engeren Ordner zu suchen.* — oder die eigenen Daten von EYAS, die CLI-Anmeldungen, die EYAS verwahrt, oder den Arbeitsbereich einer anderen Unterhaltung. Claude Code bekommt den Grund und kann es in einem engeren Ordner erneut versuchen; Grok beendet seine Antwort, frag also erneut und nenne einen engeren Ordner. Siehe [Sicherheit & Datenschutz — Speicher außerhalb von EYAS](/docs/de/admin/security-privacy/#memory-outside-eyas).

**EYAS-Tools auf Grok.** Die Zeile eines EYAS-Tools, das Grok aufgerufen hat, zeigt die Argumente, die das Tool tatsächlich bekommen hat, nicht Groks interne `use_tool`-Hülle (`tool_name`, `tool_input`, `variant`).

| Anzeige | Bedeutung |
|---------|-----------|
| **Diff** | Datei-Edits (`edit_file` / `write_file`) zeigen einen Unified Diff im Thread — nicht nur die Beschreibung des Modells |
| **Eingabe / Ausgabe / Fehler** | Die Rohdaten, wenn es keinen Datei-Diff gibt oder du sie brauchst |

Nichts in dieser Zeile ist eine Berechtigung. Gelbe und rote Tools warten weiterhin auf [Freigabe](/docs/de/agents/autonomy/). Lesendes `git status` / `git diff` (auch wenn das Modell es als `run_command` schickt) braucht keinen Klick — siehe [Werkzeuge](/docs/de/automation/tools/).

### Rundenergebnis {#turn-outcome}
Unter jeder Assistenten-Antwort, neben der Angabe, wer geantwortet hat, und dem Aufwand-Chip, erscheint ein Badge, wenn die Runde nicht einfach abgeschlossen wurde:

| Badge | Bedeutung |
|-------|-----------|
| **Rundenlimit erreicht** | Die Runde hat ihr Rundenbudget aufgebraucht (siehe [Agent-Fortschritt](#agent-progress)) |
| **Ausgabelimit erreicht** | Die Antwort traf das Ausgabe-Token-Limit des Modells |
| **Vom Modell abgelehnt** | Das Modell hat abgelehnt |
| **Werkzeugbudget aufgebraucht** | Das Tool-Aufruf-Budget der Runde war erschöpft |
| **Gestoppt** | Du hast Stopp gedrückt |
| **Fehlgeschlagen** | Die Runde ist gescheitert; der Tooltip nennt, was schiefging (etwa das Ratenlimit) |
| **Wartet auf Freigabe** | Ein Tool-Aufruf wartet auf eine menschliche Entscheidung |

Die bisher geschriebene Antwort bleibt immer erhalten; der Tooltip des Badges sagt das (*Die Runde endete vorzeitig; die bisherige Antwort bleibt erhalten.*). Die Antwort zeigt außerdem die Tokens als *N ein · N aus*, wobei *ein* der ganze Prompt ist, gecachte Teile eingeschlossen, und die Kosten: *$x*, wenn der Anbieter sie gemeldet hat, *~$x*, wenn EYAS sie aus den Tokenzahlen geschätzt hat (der Tooltip sagt, welches), oder *Nutzung nicht gemeldet*, wenn der Anbieter nichts gemeldet hat — nie $0. Nicht gemeldete Kosten werden nicht zur Summe des Gesprächs addiert. *Angeforderte Freigaben: N* verlinkt auf die Freigabe-Warteschlange.

Jede Assistenten-Nachricht speichert, wie ihre Runde verlief: Ergebnis und Stoppgrund; Tokens (ungecachter Input, Output, Cache-Reads und -Writes, Reasoning); Kosten und ihre Quelle (vom Anbieter gemeldet, von EYAS geschätzt oder nicht gemeldet); die Zahl der Schritte, Tool-Aufrufe und Freigaben; Anbieter und Modell; eventuelle Hinweise; und bei einer gescheiterten Runde Fehlerart und Code. Antworten aus Delegationen, Spezialisten, Pipelines und Kanälen speichern dasselbe. Es kommt als `turnMeta` an jeder Nachricht von `GET /api/v1/conversations/:id` und am `done`-Frame des Streams zurück; ältere Nachrichten haben keines.

### Fehler und Hinweise {#errors-and-notices}
Eine gescheiterte Runde zeigt eine Meldung in deiner Sprache pro Fehlerart: Der Anbieter hat die Anmeldung oder den API-Schlüssel nicht akzeptiert, Ratenlimit erreicht, Anbieter überlastet, keine rechtzeitige Antwort, Netzwerkfehler, Anfrage abgebrochen, Anfrage abgelehnt, der Lauf des Modells endete ohne fertige Antwort, die CLI wurde gestoppt, weil ihre Isolation nicht bestätigt werden konnte, oder Sonstiges. Genauere Meldungen gibt es für diese Fälle:

- CLI-Isolation verweigert, mit jeder nicht bestandenen Prüfung ([Anbieter — Isolationsprüfung](/docs/de/ai/providers/#isolation-check-before-every-turn));
- die CLI ist nicht für EYAS angemeldet;
- eine Kernel-Datei-Sandbox wird verlangt (`security.cliSandbox: required`), ist aber nicht verfügbar ([Anbieter — Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox));
- das Modell oder der Anbieter des Gesprächs ist ausgeschaltet oder nicht verfügbar;
- kein Modell ist eingerichtet;
- die Aufwandsstufe wird vom Modell nicht unterstützt.

Der rohe Text des Anbieters ist nie die Meldung; er steht unter einem aufklappbaren **Details anzeigen**. Fehler mit einer Abhilfe in den Anbietereinstellungen (Anmeldung, Isolation, Sandbox, Modellbindung, kein Modell eingerichtet, Authentifizierung) zeigen einen Knopf **Anbietereinstellungen öffnen**. Hatte die Runde vor dem Fehler schon einen Teil der Antwort geschrieben, bleibt dieser Teil im Gespräch, auch nach einem Neuladen, und der Fehler sagt *Der vor dem Fehler geschriebene Teil der Antwort wurde gespeichert.* Der Fehler selbst wird nie als Nachrichtentext gespeichert, weil er sonst dem Modell als Verlauf erneut vorgespielt würde. Auch eine gestoppte Runde behält, was sie geschrieben hat, und Tokens und Kosten gescheiterter und gestoppter Runden werden festgehalten. Lehnt der Server eine Nachricht ab, zeigt der Chat *Der Server hat die Nachricht nicht angenommen (HTTP n).*; eine abgebrochene Verbindung zeigt *Die Verbindung zum Server brach ab, bevor die Antwort ankam. Lade das Gespräch neu, um zu sehen, was gespeichert wurde.*

Hinweise erscheinen als unauffällige Zeilen unter der Runde und bleiben dort auch nach einem Neuladen:

- *Die Laufzeit des Modells hat in dieser Runde ihren Arbeitskontext verdichtet, um Platz zu schaffen.* — EYAS bewahrt weiterhin das ganze Gespräch;
- *Bilder nicht an das Modell übergeben (N): …* — das Modell kann keine Bilder sehen (siehe [Anbieter — Bilder](/docs/de/ai/providers/#images-and-models-that-cannot-see-them));
- *&lt;Anbieter&gt; führt seine eigenen Werkzeuge auf diesem Server ohne Kernel-Datei-Sandbox aus.* — erscheint, wenn eine CLI ihre eigenen Tools ohne die Sandbox ausführt (`security.cliSandbox: auto`); EYAS prüft weiterhin jeden Tool-Aufruf, den es sieht;
- *Der Ordner &lt;Pfad&gt; wurde in dieser Runde weggelassen: EYAS lässt dort kein Modell mehr arbeiten…* — ein früher gespeicherter Ordner wird jetzt abgelehnt, diese Runde lief also ohne ihn (siehe [Ordner](#working-folders)).

### Freigaben im Chat {#approvals-in-the-chat}
Braucht ein Tool-Aufruf eine menschliche Entscheidung, erscheint unter dem Gespräch eine Karte: *Freigabe nötig: &lt;Tool&gt;*, eine aufklappbare **Begründung**, **Freigeben** und **Ablehnen** (wenn der Aufruf in die Freigabe-Warteschlange gestellt wurde) und **Freigaben öffnen**, das zur Seite [Autonomie](/docs/de/agents/autonomy/) führt. Die Knöpfe nutzen dieselbe Berechtigung wie die Freigabe-Warteschlange; ein Benutzer ohne sie sieht *Du darfst nicht über Freigaben entscheiden. Ein Owner oder Admin kann in der Freigabewarteschlange darüber entscheiden.* Eine Anfrage, über die schon anderswo entschieden wurde, sagt das. Nach der Freigabe bittest du den Assistenten, es erneut zu versuchen: Genau dieser Aufruf (gleiches Tool, gleiche Argumente) ist jetzt einmal erlaubt. Die Karten verschwinden, wenn die nächste Nachricht gesendet wird.

In einem Chat, den du begleitest, läuft ein Aufruf, den das Security-Gate erlaubt; die Karte erscheint nur, wenn das Gate eskaliert, und der Chat wird nicht angehalten. Das ist bei jedem Anbieter gleich — auch für EYAS-Tools, die Grok und Kimi über die Tool-Bridge erreichen und die nicht mehr nur deshalb auf Freigabe warten, weil ein Tool als freigabepflichtig markiert ist. Die Autonomiestufen gelten für Hintergrundläufe, nicht für begleitete Chats (siehe [Autonomie](/docs/de/agents/autonomy/)).

### Agent-Fortschritt {#agent-progress}
Die Fortschrittsanzeige sitzt im **Laufzeit**-Streifen rechts, der sich von selbst öffnet, solange ein Agent läuft. Sie zeigt den Namen des Kollegen oder *Assistent* für den einfachen Assistenten.

| Anzeige | Bedeutung |
|---------|-----------|
| **Schritt N / Max** | Erscheint, wenn der Anbieter seine Schritte meldet (Claude Code); nur dann erscheint auch der Schrittbalken |
| **Werkzeugaufrufe: N** | Erscheint sonst (Grok CLI, Kimi Code CLI und API-Anbieter, die keine Schritte melden) |
| **Läuft** | Lauf in Arbeit |
| **N Tokens abgerechnet** | Eingabe plus Ausgabe des ganzen Laufs, summiert über jeden Modellaufruf, wie der Anbieter sie meldet — nicht die Größe des Gesprächs. Ein CLI-Agent sendet in jeder internen Runde erneut alles Gelesene, daher kann das weit mehr sein als das, was du geschrieben hast |
| **Abbrechen** | Den Lauf abbrechen |

**Rundenbudget.** Eine Chat-Runde darf standardmäßig bis zu **25** Modell-Rundläufe machen. Hat der Kollege des Gesprächs (oder der Standard-Agent seines Projekts) eigene **Max. Runden**, gilt stattdessen diese Zahl. Das Budget ist bei jedem Anbieter gleich; für Claude Code, Grok und Kimi ist es zugleich die interne Rundengrenze der CLI für diese Chat-Runde. Delegierte, Spezialisten- und Pipeline-Läufe (Standard 10) und Kanal-Antworten (Standard 20) behalten ihr eigenes Budget.

---

## Composer (Eingabe)

| Steuerung | Bedeutung |
|-----------|-----------|
| *Nachricht eingeben… (Shift+Enter für neue Zeile)* | Haupteingabe — Enter sendet |
| **Datei anhängen** | Anhang zur nächsten Nachricht |
| **Prompt Enhancer** | *Prompt Enhancer — hilft dir, deinen Prompt zu verfeinern*: öffnet vor dem Senden den iterativen Dialog zum Verfeinern des Prompts |
| **Zuerst planen** (Karten-Icon) | *Zuerst planen — schreibt einen Plan und wartet auf Freigabe, bevor Tools laufen*: Dieser Versand schreibt einen Plan und wartet — kein Tool läuft, bis du auf die Plankarte antwortest |
| Fehler | Eine gescheiterte Runde zeigt eine übersetzte Meldung mit **Details anzeigen** und, wo es hilft, **Anbietereinstellungen öffnen** — siehe [Fehler und Hinweise](#errors-and-notices). Etwa *Grok CLI wurde gestoppt: EYAS konnte nicht bestätigen, dass es isoliert läuft (…). Die Runde wurde nicht an ein anderes Modell übergeben.* |
| Bild-Chip | Mit angehängtem Bild und einem Modell, das keine Bilder sehen kann: *&lt;Modell&gt; kann keine Bilder sehen: Es erfährt nur, dass ein Bild angehängt ist.* Im God-Modus nicht angezeigt |
| **Nachricht nicht gesendet — Datenschutz** | Die Nachricht enthielt einen Wert, den die Datenschutzrichtlinie blockiert, und ginge an ein entferntes Modell — siehe [Abgelehnte Nachrichten](#refused-messages-privacy) |

### Abgelehnte Nachrichten (Datenschutz) {#refused-messages-privacy}
Eine **neue** Nachricht, die du im Chat oder im God-Modus sendest, wird abgelehnt, wenn sie einen Wert enthält, dessen Datenschutz-Aktion **Blockieren** ist — standardmäßig IBAN, Kontonummer, Steuernummer, Personalausweisnummer, Kartennummer oder US-Sozialversicherungsnummer, plus jedes eigene Muster auf Blockieren — **und** an ein entferntes Modell ginge. Nur deine neue Nachricht kann abgelehnt werden: Verlauf, Speicher, Tool-Ergebnisse und extrahierter Text von Anhängen werden nie abgelehnt; sie werden auf dem Weg hinaus maskiert. E-Mail-Adressen und Telefonnummern (Klasse Maskieren) und Typen der Klasse Warnen werden nie abgelehnt.

- **Wohin sie geht.** Ziel ist das Modell, auf dem die Nachricht laufen wird (eine Überschreibung für eine Runde, das feste Modell des Gesprächs oder das Modell seines Kollegen). Lokal heißt: Der Endpunkt des Modells ist Loopback (`localhost`, `127.x`, `::1`) oder steht in den lokalen Hosts der Datenschutzrichtlinie; CLI-Anbieter (Claude Code, Grok CLI, Kimi Code CLI) und unbekannte Endpunkte gelten als entfernt. Ein auf Auto gesetztes Gespräch gilt immer als entfernt, weil sein Modell erst nach der Prüfung gewählt wird — außer das automatische Routing ist global ausgeschaltet; dann wird sein gespeichertes Modell beurteilt. Im God-Modus wird jeder Teilnehmer des Kaders beurteilt: Ist einer entfernt oder ist der Kader leer, wird die Nachricht abgelehnt.
- **Nichts wird gespeichert.** Die Nachricht verschwindet aus dem Transkript, das Gespräch wird nicht umbenannt, kein Speicher wird aufgezeichnet, kein Modell aufgerufen und kein God-Modus-Rennen gestartet. Eine Karte über dem Composer, **Nachricht nicht gesendet — Datenschutz**, listet die abgelehnten Typen mit Namen (nie die Werte) und bietet **Mit maskierten Angaben senden** (sendet sie erneut, wobei nur die blockierten Werte durch Platzhalter wie `[IBAN]` ersetzt werden; der maskierte Text ist das, was gespeichert, angezeigt und gesendet wird), **Nachricht bearbeiten** (legt Text und Anhänge zurück in den Composer) und **Verwerfen**.
- Das erneute Ausführen einer gestoppten Runde (nach einem Skill-Vorschlag oder einer Plan-Freigabe) wird nicht erneut geprüft. Ist die Datenschutzrichtlinie oder das Datenschutzmodul aus, wird nichts abgelehnt.

Jede Ablehnung wird als `privacy.inbound_refused` auditiert und jedes maskierte erneute Senden als `privacy.inbound_masked`, mit den Typen, dem Gespräch und dem Benutzer — nie einem Wert. **API:** `POST /api/v1/conversations/:id/messages` nimmt ein optionales `privacy: "mask"` an (jeder andere Wert → `400`). Eine Ablehnung ist HTTP `422 {error: 'privacy_blocked', code: 'privacy_blocked', message, types, maskedContent}` und kommt, bevor ein Stream beginnt. Siehe [Sicherheit & Datenschutz](/docs/de/admin/security-privacy/#refused-messages).

### Prompt-Enhancer-Dialog {#prompt-enhancer-dialog}
Ein iterativer Coach, der vor dem Senden **den Prompt an die Modellfamilie des Gesprächs anpasst** (Claude, OpenAI, Gemini, Grok, Kimi, …). Beschreibung: *Iterativer Prompt-Coach — optimiert für die Modellfamilie der Unterhaltung. Aufgabentyp wählen, verfeinern, dann Apply.*

| Steuerung | Bedeutung |
|-----------|-----------|
| Ziel- / Entwurfsfeld | Beschreibe, was verfeinert werden soll (*Gib einen Prompt-Entwurf oder ein Ziel ein — ich helfe dir beim Verfeinern.*) |
| **Optimiert für …** | Ziel-Modellfamilie — standardmäßig das Modell, auf dem das Gespräch tatsächlich läuft |
| Aufgabentyp-Chips | **Allgemein · Coding · Research · Analyse · Schreiben · Agentisch · Dateien / Vision** — steuern Struktur und Checkliste |
| **Datei anhängen** | Kontextdateien nur für den Enhancer (oder zum Übernehmen) |
| **Senden** | Mit dem Enhancer weiter verfeinern |
| **Qualität N/10** | Heuristische Qualitätsbewertung; **Lücken: …** nennt fehlende Checklisten-Punkte; **Checkliste abgedeckt**, wenn vollständig |
| **Zwei Alternativen (knapp + gründlich)** | Varianten **Knapp** / **Gründlich** / **Empfohlen** anfordern |
| **Vorgeschlagener finaler Prompt** | Einzufügender Textvorschlag |
| **N Dateien übernehmen** | Ob die Anhänge auch in den Haupt-Chat gehen |
| **Apply** | Den finalen Prompt (oder die letzte Antwort) in den Haupt-Composer einfügen |

Für **dauerhafte** Projekt- / Agenten-Systemprompts (keine einmaligen Chat-Entwürfe) nutze den [Prompt Coach](/docs/de/ai/prompts/#prompt-coach) bei Projekten und in der Agentenkonfiguration.

---

## Kontextleiste (Chatter) {#context-rail-chatter}
Die rechte Spalte enthält oben den **Laufzeit**-Streifen, darunter — solange es offen ist — das OpenCode-Terminal, dann die Tabs:

**Verlauf · Quellen · Ordner · Als Nächstes · Dateien** (plus **God**, solange der God-Modus an ist oder nachdem es ein Rennen gab)

### Verlauf (Nachrichten / Filter)

| Steuerung | Bedeutung |
|-----------|-----------|
| **Verlauf** | Chronologische Notizen und Board-Änderungen |
| **Alle / Notizen / Änderungen** | Notizen oder Feldänderungen filtern |
| *Notiz hinzufügen…* + **Notiz** | Menschliche Notiz am Datensatz (keine Chat-Runde an das Modell) |
| Badges **Notiz** / **Update** | Art des Eintrags |
| **Heute / Gestern** | Zeitliche Gruppierung |

### Quellen (Code / Odoo-Pin)

Mehrfachauswahl, welche **indexierten Suchquellen** dieses Gespräch nutzen darf (etwa Odoo 18c + eigene Addons). So vermischen sich keine Odoo-Versionen in einem Thread.

| Steuerung | Bedeutung |
|-----------|-----------|
| Checkbox-Liste | Alle registrierten Suchquellen (Bezeichnung, Version, Status, Pfad) |
| **Alle** / **Leeren (auto)** | Jede Quelle pinnen / den Pin entfernen |
| **Auto** | Kein Pin am Gespräch — der Projekt-Standard oder die Mehrversions-Regeln `needsPin` gelten |
| **N gewählt** | Zahl der gewählten Quellen |
| **Search-Quellen verwalten →** | `/search-sources` öffnen |

**Vererbung:** Neue Gespräche in einem Projekt und die Zuweisung eines Projekts an ein bestehendes Gespräch übernehmen die **Standard-Codequellen** des Projekts. Hier kannst du sie jederzeit überschreiben.

Vollständige Einrichtung: [Suche — Multi-Version-Pin](/docs/de/daily/search/#multi-version-pin) · [Projekte](/docs/de/daily/projects/).

### Ordner (Arbeitsverzeichnisse) {#working-folders}
Benannte Wurzeln, die dieses Gespräch lesen und schreiben darf. Der erste Pfad ist das **primäre** Arbeitsverzeichnis (cwd). Datei-Tools (`read_file`, `edit_file`, `grep`, …) sind auf diese Pfade eingesperrt — einen Rückfall auf das Verzeichnis des EYAS-Prozesses gibt es nicht. Claude Code, Grok CLI, Kimi Code CLI und OpenCode starten im ersten Ordner, der die Prüfung noch besteht, sonst im eigenen EYAS-Workspace des Gesprächs — nie im eigenen Verzeichnis des EYAS-Servers.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Arbeitsordner** (Feldleiste) | Welche benannte Wurzel primär ist |
| Tab **Ordner** | **Ordner hinzufügen** (Name + absoluter Pfad), **Nach oben** / **Nach unten**, **Entfernen**; der erste Eintrag ist **Primär** |
| *Dieses Projekt hat noch keine Standardordner.* | Standards am [Projekt](/docs/de/daily/projects/) (oder seinem Typ) setzen |

Neue Gespräche kopieren die Liste des Projekts; eine leere Projektliste kopiert die Liste des **Typs**. Ein Projektwechsel ersetzt diese Liste. Die Pfade gehören zur Instanz, nicht zu den Produkt-Standards.

**Ordner, die nicht gespeichert werden können.** Speichern lehnt einen Ordner ab und sagt, warum — mit dem Namen des Ordners, in deiner Sprache:

- das Dateisystem-Root, dein Home-Ordner oder jeder Ordner darüber (etwa `/Users` oder `/home`) — von dort könnte ein Modell den Speicher jedes Werkzeugs und deine Zugangsdaten erreichen; wähle stattdessen einen Projektordner in deinem Home;
- ein Ordner im eigenen Speicher eines anderen KI-Werkzeugs (`~/.claude`, `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.cursor`, `~/.codeium`, `~/.kimi`, `~/.agents`, `~/.config/agents`, `~/.copilot`, die Config-/Daten-/Zustandsordner von OpenCode oder ein `memory`-Ordner unter `.claude`/`.grok`/… in einem Repository) oder in den CLI-Anmelde-Homes, die EYAS für Grok und Kimi führt (`data/cli-homes`);
- ein Ordner in einem Notiz-Vault oder Speicher-Store: jeder Obsidian-Vault, Obsidians App-Einstellungen, ein Ordner namens `ai-memory` oder ein Pfad aus `security.foreignMemoryPaths`;
- ein Ordner im eigenen Datenordner von EYAS (Speicher-Vault, Datenbank, Schlüssel) — außer einem einzelnen Gesprächs-Workspace, Studio-Projekten und Browser-Downloads; der Workspaces-Ordner selbst wird abgelehnt, weil er den Workspace jedes Gesprächs enthält;
- sensible Orte: `.ssh`, `.env`-Dateien, `master.key`, der Datenbank-Ordner;
- ein Pfad, der nicht absolut ist, ein Ordner, der nicht existiert oder nicht lesbar ist, und eine Datei statt eines Ordners;
- ein Ordner, der einen geschützten Ort **enthält** — die Meldung nennt, was darin gefunden wurde: das eigene Home, den Datenordner, die Datenbank oder den Ordner der Gesprächs-Workspaces von EYAS (etwa der EYAS-Source-Checkout mit `data/` oder das EYAS-Home selbst, auch wenn `EYAS_DATA_DIR` die Daten woandershin verlegt hat); den Speicher eines anderen KI-Werkzeugs oder einen CLI-Anmeldeordner von EYAS (etwa `~/.config` mit dem Ordner von OpenCode oder ein Repository mit `.claude/memory`); einen Notiz-Vault (einen Ordner mit `.obsidian` darin oder einen Vault aus Obsidians Vault-Liste — etwa `~/Documents` mit *Obsidian Vault*), einen `ai-memory`-Ordner oder einen Eintrag aus `security.foreignMemoryPaths`.

**Warum ein Ordner abgelehnt wird, der einen davon nur enthält.** Eine CLI wie Claude Code liest und sucht in ihrem Arbeitsordner, ohne zu fragen, und die Release-Prüfung hat am echten Binary bestätigt, dass solche Lesezugriffe nie beim Freigabeschritt ankommen. Ein Ordner, der einen geschützten Ort enthält, lässt sich einem Modell also nicht sicher überlassen. Wähle stattdessen einen engeren Ordner, etwa den Projektordner in `~/Documents` oder einen separaten Klon des Repositorys. Vaults und Speicherordner, die nur an ihrer Form erkennbar sind, werden durch einen begrenzten Scan gefunden — 8 Ebenen tief, höchstens 2.000 Ordner, ohne `.git` und ähnliche Ordner und ohne `node_modules`; ein Lesezugriff in einen tiefer liegenden wird weiterhin Pfad für Pfad abgelehnt, und EYAS' eigene Tools `grep` und `glob` schauen nie in einen geschützten Unterordner. Werden die Ordner eines neuen Gesprächs abgelehnt, wird das Gespräch nicht angelegt.

**Früher gespeicherte Ordner, die jetzt abgelehnt werden,** werden nicht umgeschrieben, aber jeder Lauf lässt sie aus: EYAS' eigene Datei-Tools, das Security-Gate und den Arbeitsordner von Claude Code, Grok, Kimi und OpenCode. Der System-Prompt nennt sie nicht mehr. Im Chat zeigt die Runde den Hinweis *Der Ordner &lt;Pfad&gt; wurde in dieser Runde weggelassen: EYAS lässt dort kein Modell mehr arbeiten, weil er ein geschützter Ort ist, in einem liegt oder einen enthält (die eigenen Daten von EYAS, der Speicher eines anderen KI-Tools, ein Notiz-Vault oder dein Home-Ordner). Ändere die Ordner dieser Unterhaltung oder ihres Projekts.* Ein Ordner, der lediglich fehlt, ist nicht betroffen. Bei Hintergrund-Karten-, Team- und Spezialistenläufen erscheint das Weglassen nur im Server-Log. Werden alle gespeicherten Ordner abgelehnt, haben EYAS' eigene Datei-Tools keinen Ordner, und eine CLI arbeitet im eigenen EYAS-Workspace des Gesprächs. Kimi Code CLI folgt denselben Ordnerregeln; sein Verhalten hier ist noch auf keinem Host geprüft. Jedes Speichern prüft die ganze Liste; entferne also einen jetzt abgelehnten Ordner, bevor du andere Änderungen an der Liste speicherst. Die API beantwortet einen abgelehnten Ordner mit `400 {error, code, path, found}`, wobei `code` einer von `home`, `providerHome`, `vault`, `eyasData`, `sensitive`, `containsEyasData`, `containsProviderHome`, `containsVault`, `notAbsolute`, `notFound`, `notDirectory` ist und `found` — mit den drei `contains…`-Codes gesendet — der geschützte Ort ist, der im Ordner gefunden wurde.

**Jedes Gespräch hat einen Arbeitsordner.** Ein Gespräch, das weder von dir noch vom Projekt oder dessen Typ Ordner bekommt, erhält beim Anlegen seinen eigenen **EYAS-Workspace** — in jedem Projekt, auch wenn die Anfrage eine leere Ordnerliste mitschickt. Ältere Gespräche ohne Ordner und Gespräche, deren Ordner alle entfernt wurden, bekommen ihren Workspace mit der nächsten Nachricht. Er erscheint im Tab **Ordner** wie jeder andere Ordner. Dateien, die das Modell dort schreibt, werden in die Anhänge des Gesprächs kopiert ([Dokumente](/docs/de/knowledge/documents/)), zusammen mit Medien-Jobs und Studio-Renderings — auch bei einer Runde, die ohne EYAS' Tool-Pipeline lief. **Kein Ordner** erscheint nur, wenn der Workspace-Ort nicht beschreibbar ist. Ordner, die du selbst setzt, werden nie ersetzt.

Workspaces liegen nie in einem Git-Checkout: Ein CLI-Modell (Claude Code, Grok, Kimi), das in einem Git-Repository startet, behandelt dieses Repository als sein Projekt und lädt dessen Anweisungsdateien, Git-Status, Berechtigungsregeln und projektbezogenen Speicher. Wo sie liegen und wie du sie mit `EYAS_WORKSPACES_DIR` verschiebst, steht unter [Konfiguration — Gesprächs-Workspaces](/docs/de/deploy/configuration/#conversation-workspaces).

### Geschäftsfelder (verfolgt)

| Feld | Bedeutung |
|------|-----------|
| **Phase** | Pipeline-Phase |
| **Projekt** | Projektverknüpfung |
| **Priorität** | Priorität |
| **Status** | Status |
| **Fällig** | Frist |

Änderungen erscheinen als **Update**-Einträge im Tab **Verlauf**.

### Aktivitäten

Der Tab **Als Nächstes** (*Nächste Schritte für diesen Datensatz*) listet die Aktivitäten des Gesprächs.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Planen** | Das Planungsformular öffnen |
| **Typ** | Aktivitätstyp (Aufgabe, Nachfassen, Review, …) |
| **Zusammenfassung** | Optionaler Zusammenfassungstext |
| **Frist** | Wann sie fällig ist |
| **Aktivität planen** | Bestätigen |
| **Als erledigt markieren** | Eine Aktivität abschließen |
| **Überfällig / Heute / Geplant** | Gruppierung |
| **N erledigt** | Anzahl erledigter |

### Als Nächstes / Dateien / Laufzeit

| Bereich | Bedeutung |
|---------|-----------|
| **Als Nächstes** | Aktivitäten und nächste Schritte für diesen Datensatz (oben) |
| **Dateien** | Anhänge des Gesprächs, einschließlich Dateien, die das Modell in seinem Workspace geschrieben hat |
| **Laufzeit** | Der einklappbare Streifen über den Tabs: Laufbaum, Agent-Fortschritt und Baum der Unterunterhaltungen. Er öffnet sich von selbst, solange ein Agent läuft, und ist vom Verlauf getrennt, sodass Agent-Aktivität sich nie mit Geschäftsnotizen mischt |

---

## Team-Funktionen

### Baum der Unterunterhaltungen

| Steuerung | Bedeutung |
|-----------|-----------|
| **Team / Unterunterhaltungen** | Kind-Threads für Multi-Agenten-Arbeit (im Laufzeit-Streifen) |
| **Erweitern** (*Team-Dashboard öffnen*) | Das Dashboard-Overlay öffnen |
| **Runde N** | Fortschritt eines Unter-Threads |

### Team-Dashboard

| Steuerung | Bedeutung |
|-----------|-----------|
| **Team-Dashboard** / **Einklappen** | Titel / Schließen des Overlays |
| **Phase:** | Aktuelle Orchestrierungsphase |
| **N Runde / N Tokens** | Verbrauch |
| Kategorien **Erkenntnis / Entscheidung / Blocker / Frage / Fakt** | Eintragstypen des gemeinsamen Team-Speichers |
| **Chat öffnen** | In den Unter-Chat eines Mitglieds springen |
| **Team-Speicher** | Gesammelte Erkenntnisse, Entscheidungen und Blocker |

### Team-Vorschlagskarte

Die gewöhnliche Spezialisten-Verteilung (`run_specialist`) zeigt diese Karte **nicht**. Sie erscheint bei `/team`, einer ausdrücklichen Team-Anfrage, fehlenden Spezialisten oder epischer Arbeit. Den Vorschlag schreibt das Hintergrundmodell in einem isolierten Aufruf; ohne geeignetes Hintergrundmodell schlägt die Karte einen einzelnen Agenten vor (siehe [Teams und Delegation](/docs/de/agents/teams/)).

| Steuerung | Bedeutung |
|-----------|-----------|
| **Team-Vorschlag** | Plan für die Ausführung mit mehreren Agenten |
| **~N Tokens · Kosten** | Schätzung |
| **Phasen** | Parallele oder sequenzielle Phasen |
| **Fehlende Spezialisten** | Noch nicht angelegte Vorlagen |
| **Jetzt erstellen** | Die fehlenden Agenten anlegen |
| **Annehmen / Bearbeiten / Überspringen / Überspringen (riskant)** | Den Plan annehmen, bearbeiten (wenn verfügbar) oder überspringen |

### Übergabe {#handoff}
Übernimmt ein Kollege (`handoff_to_colleague`), hat die Tool-Zeile **&lt;Name&gt; öffnen** zu seinem Home-Thread, und der Kollege **startet dort sofort**: Das Übergabe-Briefing wird Ziel des Laufs und Anfrage seines Speicherabrufs, und der Lauf ist überwacht, autonom und durch die Leiter der [Autonomie](/docs/de/agents/autonomy/) abgesichert, wie ein Board-Karten-Lauf. Eine Übergabe an einen Kollegen, der in seinem Home-Thread beschäftigt ist (eine Chat-Runde oder ein früherer Lauf arbeitet noch, oder ein Lauf wartet auf Freigabe), wird mit einer *busy*-Meldung abgelehnt — versuche es später erneut oder nutze `assign_task`. Übergaben an dich selbst oder an einen Spezialisten werden abgelehnt, und eine wiederholte Übergabe startet nie einen zweiten Lauf.

<h3 id="run-tree--workflow">Laufbaum / Workflow</h3>
Zeigt im Laufzeit-Streifen die Laufstruktur der aktuellen Runde (Beschriftung **Workflow**), bei jedem Anbieter — API-Anbieter (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, lokale Modelle, …) ebenso wie Claude Code, Grok CLI und Kimi Code CLI.

- Der Knoten des Gesprächs zeigt live das aktuelle Tool, den Rundenzähler (bei einer CLI ihre eigenen internen Schritte), die bisher verbrauchten Tokens und einen Status: **Ausstehend**, **Läuft**, **Abgeschlossen**, **Fehlgeschlagen**, **Abgebrochen** oder **Pausiert**. Ein Lauf, der auf eine menschliche Freigabe wartet, erscheint als **Pausiert**.
- Jede neue Nachricht beginnt einen frischen Baum: Der Baum der vorigen Runde wird ersetzt, nicht ergänzt.
- Endet ein Lauf, zeigt der Kopf seine Kosten in US-Dollar: die eigenen Kosten des Anbieters, wo gemeldet (Claude Code, auch bei einem gescheiterten Lauf), sonst aus der Token-Nutzung mit den konfigurierten Preisen berechnet (`model.pricing`-Overrides gelten). Hat ein Anbieter seine Nutzung nicht gemeldet, zeigen die Kosten *—*, und der Tooltip sagt *Kosten unbekannt — der Anbieter hat seine Nutzung nicht gemeldet* — nie erfundene $0.
- **Pläne von Grok und Kimi.** Führt das Modell eine To-do-Liste, erscheint jeder Eintrag unter dem Gespräch als **Planschritt** mit Checklisten-Symbol und Status (ausstehend, läuft, abgeschlossen).
- Spezialisten erscheinen bei jedem Anbieter gleich; Claude-Code-Läufe zeigen keine eigenen Knoten. In Team-Läufen zeigt jedes Mitglied live sein aktuelles Tool, egal auf welchem Anbieter.
- Ältere gespeicherte Bäume werden weiterhin abgespielt.

---

## God-Modus

Der God-Modus lässt **dieselbe Aufgabe** parallel auf mehreren Modellen laufen und vergleicht dann die Ergebnisse. Er ist kein vierter Orchestrierungsstil: Solo / Automatisch / Tief beschreiben weiterhin, wie jeder Worker die Arbeit zerlegt. Der God-Modus entscheidet nur, dass mehrere Modelle konkurrieren (kein Spezialisten-Team). Kombinieren geht: God-Modus + Tief heißt, jedes konkurrierende Modell darf für sich weiter aufteilen.

Es gibt **keinen automatischen Merge**. Ein Workspace gewinnt; einzigartige Ideen der anderen werden aufgelistet, und du wendest sie an.

| Thema | Bedeutung |
|-------|-----------|
| **Kader** | **Einstellungen → God-Modus** (Karte unter Modellzuweisungen). 2–5 aktive Anbieter/Modell-Paare wählen. Eine gerade Anzahl braucht einen Stichentscheid-Vorsitz. |
| **Menü** | Letzter Eintrag der Orchestrierungs-Steuerung des Gesprächs (nach einem Trenner): Solo, Automatisch, Tief, dann **God-Modus**. Einschalten lässt Solo/Automatisch/Tief **unverändert** (die Worker erben diesen Stil). Solo/Automatisch/Tief zu wählen schaltet den God-Modus aus. Ohne gültigen Kader sagt der Eintrag *Mindestens 2 Modelle unter Einstellungen → God-Modus hinzufügen*. |
| **Kosten** | Der erste Versand nach dem Einschalten fragt nach Bestätigung (*God-Modus-Lauf starten?* — Kader, Schätzung, Obergrenze). Spätere Versände im selben Gespräch zeigen nur das Banner. Liegt die Schätzung über der Obergrenze, ist Senden gesperrt, bis du die Grenze hebst oder den God-Modus ausschaltest. |
| **Ordner** | Worker laufen in isolierten Kopien der Arbeitsordner des Gesprächs (wenn möglich als Git-Worktree). Ohne Ordner startet der Lauf trotzdem, ohne Datei-Isolation. |
| **Gewinner + Erkenntnisse** | Nur die geänderten Dateien des Gewinners landen in den Ordnern des Gesprächs. Einzigartige Erkenntnisse der anderen stehen im Tab **God** — du wendest sie an; nichts wird automatisch zusammengeführt. |

### Kader in den Einstellungen

Auf [Einstellungen](/docs/de/admin/settings/), unter Modellzuweisungen, ist die Karte **God-Modus** der globale Kader, den jedes God-Modus-Gespräch nutzt.

| Feld | Bedeutung |
|------|-----------|
| **Modell hinzufügen** | 2–5 aktive Anbieter/Modell-Paare. Duplikate sind nicht erlaubt. |
| **Stichentscheid-Vorsitz** | Eines dieser Modelle. **Pflicht bei gerader Anzahl**; immer empfohlen (ein gescheiterter Worker kann eine gerade Restzahl hinterlassen). Der Vorsitz ist Mitbewerber, kein separater Richter. |
| **Kostenobergrenze (USD)** | Optional. Liegt die Vorabschätzung darüber, startet der Lauf nicht. Überschreiten die Ausgaben die Grenze während des Laufs, werden unfertige Worker abgebrochen, und der Sieger wird unter den fertigen bestimmt. |
| **Arbeitsordner behalten (Stunden)** | Isolierte Bäume werden nach so vielen Stunden gelöscht (Standard 72). |

Das Speichern des Kaders ändert keine schon gestarteten Läufe: Jeder Versand hält einen Schnappschuss des Kaders fest.

Die Modellauswahl des Gesprächs ist bei einem God-Modus-Versand abgeblendet und wird ignoriert — der Einstellungen-Kader läuft, und jeder Worker läuft immer auf seinem Kader-Modell. Ein am Gespräch gesetzter Aufwand wird auf jeden Teilnehmer kopiert, und Tief wird als Modus der Teilnehmer weitergegeben; die Stufe jedes Teilnehmers wird dann an sein eigenes Modell angepasst. Auch die Stimmen der Gegenbewertung nutzen den Aufwand des Gesprächs.

### God-Modus einschalten

1. Öffne das Orchestrierungsmenü des Gesprächs und wähle **God-Modus**.
2. Sende eine Nachricht. Der erste Versand zeigt eine Kostenbestätigung (wie viele Modelle antreten, geschätzte USD, Obergrenze). Klicke **Senden**, um zu starten.
3. Solange er an ist, bleibt ein Banner **God-Modus · N · ~$x** am Gespräch. Rechts erscheint der Tab **God**.
4. **Stopp** bricht das ganze Rennen ab, nicht nur einen Worker.

### Isolation und Sieger

Jeder Worker bekommt einen eigenen Ordner (Git-Worktree, wenn das Arbeitsverzeichnis ein Repository ist; sonst eine Kopie). Während der Arbeit sehen die Worker die Dateien der anderen nicht.

Ist ein Sieger gewählt, werden **nur die geänderten Dateien des Siegers** in die Ordner des Gesprächs kopiert. Die Dateien der anderen Worker bleiben in ihren isolierten Bäumen bis zur Aufbewahrungsfrist. Hat das Gespräch keine Arbeitsordner, gibt es nichts zu übernehmen; der Sieger wird trotzdem aus den geschriebenen Antworten gewählt.

### Der God-Tab

Der Tab **God** in der Leiste erscheint, solange der God-Modus an ist, **oder** sobald das Gespräch mindestens einen God-Modus-Lauf hatte (er bleibt, wenn du den God-Modus später ausschaltest).

#### Kopfzeile

Die aktuelle Phase plus Tokens, USD und Dauer insgesamt.

| Phase | Bedeutung |
|-------|-----------|
| **Vorbereitung** | Kader-Schnappschuss, isolierte Ordner |
| **Rennen** | Die Worker führen dieselbe Nutzernachricht parallel aus |
| **Bewertung** | Die Fertigen bewerten die Arbeit der anderen und stimmen ab |
| **Entscheidung** | Sieger festgehalten |
| **Übernahme** | Die Dateien des Siegers werden in die Ordner des Gesprächs kopiert |
| **Abgeschlossen / Fehlgeschlagen / Abgebrochen** | Endzustand |

Ein gescheiterter Worker zeigt auch den Anbieterfehler (etwa eine überlastete API).

#### Schritte

Ein zeitgestempeltes Protokoll dessen, was tatsächlich passiert ist:

| Schritt | Bedeutung |
|---------|-----------|
| Lauf gestartet | Rennen aus dem aktuellen Kader angelegt |
| Worker parallel gestartet | Jedes aktive Modell beginnt dieselbe Aufgabe |
| *Modell* fertig / fehlgeschlagen | Der eigene Versuch dieses Workers ist beendet |
| Gegenbewertung gestartet | Die Fertigen lesen die Zusammenfassungen der anderen und stimmen ab |
| Sieger: *Modell* | Entscheidung festgehalten |
| Sieger-Arbeitsbereich übernommen | Die Dateien des Siegers werden in die Ordner des Gesprächs kopiert |
| Lauf abgeschlossen / fehlgeschlagen / abgebrochen | Endzustand |

Ältere Läufe aus der Zeit vor diesem Protokoll zeigen eine aus den Endzeiten rekonstruierte Zeitleiste.

#### Wie der Sieger gewählt wurde

Dieser Block nennt die angewandte Regel, die Stimmenzahlen und **wer für wen stimmte**.

| Regel | Wann |
|-------|------|
| **Mehrheit** | Ein Modell hat mehr gültige Stimmen als jedes andere. Ein Modell **darf nicht für sich selbst stimmen**; Selbststimmen fallen weg. |
| **Gleichstand — der Vorsitz wählte** | Zwei oder mehr Modelle liegen gleichauf, und der Vorsitz ist darunter. |
| **Gleichstand — früher fertig** | Zwei oder mehr Modelle liegen gleichauf, und der Vorsitz fehlt oder ist nicht darunter. Unter den Gleichauf liegenden gewinnt, wer zuerst fertig war. |
| **Nur einer fertig** | Alle anderen Worker sind gescheitert oder wurden abgebrochen; der einzige Überlebende gewinnt, ohne Abstimmung in der Gegenbewertung. |

Scheitert ein Bewertungsaufruf, hat dieser Worker einfach keine Stimme. Die Entscheidung läuft mit den abgegebenen Stimmen weiter.

#### Gegenbewertung

Nach dem Rennen machen die Fertigen **eine** strukturierte Gegenbewertung (keine Live-Debatte). Jeder Bewerter stimmt in einem isolierten Aufruf auf seinem eigenen Kader-Modell ab, ohne Tools. Die Antworten und Dateiänderungen der anderen bekommt er als klar markierte Daten, nie als Anweisungen — Text in der Ausgabe eines anderen kann einem Bewerter also nicht vorschreiben, wie er stimmt. Pro Bewerter zeigt der Tab ohne Extra-Klick:

- für wen er stimmte
- Punkte 1–5: **Qualität**, **Vollständigkeit**, **Risiko**
- seinen schriftlichen Kommentar zur Arbeit der anderen
- einzigartige Erkenntnisse, die die anderen seiner Meinung nach übersehen haben
- gemeldete Risiken

Das Aufklappen einer Modellkarte zeigt die **eigene** Arbeit dieses Modells (vor der Bewertung erstellt) und einen eventuellen Worker-Fehler.

#### Einzigartige Erkenntnisse

Eine entduplizierte Liste von Erkenntnissen der **Nicht-Sieger**, die nicht schon in der eigenen Liste des Siegers stehen. Wenn du sie im übernommenen Workspace haben willst, wendest du sie selbst an — nichts wird automatisch zusammengeführt.

### Kind-Unterhaltungen

Jeder Worker ist eine Kind-Unterhaltung mit einem Titel wie `God <Modell>`. Sie können in der Liste als Unterunterhaltungen erscheinen. Der God-Modus ist dort **aus**, damit sie kein weiteres Rennen starten.

Der globale Vergleich (Gewinnrate je Modell, durchschnittliches Kostenvielfaches gegenüber einem Einzelmodell) steht unter [Beobachtbarkeit](/docs/de/admin/observability/). Ein Klick auf einen Lauf dort öffnet den God-Tab dieses Gesprächs.

---

## Skill-Vorschläge

Ein passender Skill ist ein **Vorschlag, auf den die Runde wartet** — nichts davon läuft, bis du antwortest. Die Karte zeigt den Namen des Skills, das passende Muster und eine Bewertung.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Eine Fähigkeit passt — verwenden?** | Überschrift |
| **Verwenden** | Für dieses Gespräch annehmen; die Runde läuft mit dem Skill weiter |
| **Diesmal nicht** | Nur für dieses Gespräch ablehnen |
| **Abschalten** | Hier ablehnen **und** den Skill global deaktivieren (nur Owner/Admin). Er passt nicht mehr, bis ihn jemand unter [Fähigkeiten](/docs/de/automation/skills/) wieder einschaltet |

Deine Antwort gilt für dieses Gespräch. Wer chatten, aber Skills nicht verwalten darf, sieht trotzdem **Verwenden** und **Diesmal nicht**.

---

## Zuerst planen {#plan-mode}
Das Karten-Icon im Composer ist **Zuerst planen** (*Zuerst planen — schreibt einen Plan und wartet auf Freigabe, bevor Tools laufen*). Dieser Versand führt **keine** Tools aus, und der Thread-Status wird **Wartet auf Plan**. Den Plan schreibt das eigene Modell des Gesprächs in einem isolierten Aufruf — keine Tools, eine einzige Runde, nie ein anderer Anbieter. Scheitert dieser Aufruf, läuft die Runde ohne Plan.

Die Karte **Plan für diese Runde** zeigt das Ziel, die nummerierten Schritte (mit ihren Erfolgskriterien) und, wenn der Plan eine nennt, eine Zeile *Rücknahme: …*, wie er rückgängig zu machen wäre.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Freigeben** | Diesen Plan ausführen |
| **Plan überspringen** | Die Runde ohne den Plan ausführen |
| **Ablehnen** | Stoppen — nichts ist gelaufen |

Solange die Karte wartet, ist nichts gelaufen. Gelbe und rote Tools im späteren Lauf gehen weiterhin wie gewohnt über die [Autonomie](/docs/de/agents/autonomy/).

---

## Angehängte Designs {#attached-designs}
Das Formen-Symbol in der oberen Leiste des Gesprächs ist **Designs**. Angehängte Canvas reisen mit jeder Runde dieses Threads (der Agent kann Teile mit `design_read` holen). Die Designs eines Projekts werden auf ein neues Gespräch kopiert, wenn du es in diesem Projekt anlegst; danach gehören die Verknüpfungen dem Gespräch.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Angehängte Designs** | Dropdown aller Canvas, mit Haken bei den hier verknüpften |
| Zähler | Wie viele angehängt sind |
| **Design öffnen** | Sprung nach `/design` |
| *Noch keine Entwürfe.* | Leere Liste — zuerst ein Canvas anlegen |

---

## Verwandt

- [Suchquellen & Multi-Version-Pin](/docs/de/daily/search/)
- [Projekte — Arbeitsverzeichnisse und Wiki](/docs/de/daily/projects/)
- [Agenten — Überblick](/docs/de/agents/overview/)
- [Teams und Delegation](/docs/de/agents/teams/)
- [Anbieter](/docs/de/ai/providers/)
- [Board](/docs/de/daily/board/)
- [Stimmprofile](/docs/de/agents/voice/)
- [Speicher](/docs/de/knowledge/memory/)
- [Design-Canvas](/docs/de/knowledge/design/)
- [Fähigkeiten](/docs/de/automation/skills/)
- [OpenCode](/docs/de/automation/opencode/)
- [Beobachtbarkeit — God-Mode-Tab](/docs/de/admin/observability/)
