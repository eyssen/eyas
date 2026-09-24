---
title: Prompt-System
description: Geschichtete Prompts — Master → Projekttyp → Projekt → Gespräch — auf das antwortende Modell zugeschnitten, plus Coaches.
---

**Wozu das da ist.** Jeder Zug wird aus gestapelten Prompt-Schichten zusammengesetzt, nicht aus einem Block. **Master** ist die globale Identität (einige Abschnitte gesperrt). **Projekttyp** und **Projekt** verfeinern sie für eine Art von Arbeit und für ein einzelnes Projekt. **Gespräch** ergänzt threadspezifischen Text. Agenten haben außerdem einen **System-Prompt**. Dieses Kapitel ist der Editor für diese dauerhaften Schichten; der **Prompt Enhancer** im Gespräch ist nur für einmalige Entwürfe.

**Routen:** `/prompts` (Sidebar **Prompts** — **Prompt-Vorlagen**), `/prompt-settings` (die Master-Abschnitte des **System-Prompt**). Außerdem: der **Prompt Enhancer** im Gespräch und der **Prompt-Coach** bei Projekten / Agenten.

## Wann du es brauchst

- Du willst den Hauston ändern (den bearbeitbaren Abschnitt **personality**), ohne gesperrte Plattformregeln anzufassen.
- Ein Projekttyp soll ein wiederverwendbares Briefing tragen, das jedes Projekt dieses Typs erbt.
- Ein Projekt braucht Domänen-Konventionen, die nicht in andere Projekte durchsickern sollen.
- Ein Entwurf im Eingabefeld ist schwach, und du willst den Prompt Enhancer, keine dauerhafte Änderung einer Schicht.

## Typischer Ablauf

1. Öffne **Prompts** (`/prompts`). Wähle eine Ebene: **Master / Projekttyp / Projekt / Unterhaltung**.
2. Wähle eine Vorlage. Gesperrte sind **Schreibgeschützt**. Bei den anderen: Inhalt bearbeiten, **Aktivieren / Deaktivieren** oder löschen.
3. Öffne `/prompt-settings` (über die Brotkrume **Prompts**), um die Master-Abschnitte zu sehen. Dort ist nur **personality** bearbeitbar; der Rest ist **Gesperrt**.
4. Für ein dauerhaftes Projekt- oder Agenten-Briefing nutze den **Prompt-Coach** im Projekt- / Agentenformular, dann **Übernehmen**.
5. Für einen einmaligen Benutzer-Prompt öffne den **Prompt Enhancer** aus dem Eingabefeld des Gesprächs.

## Funktionen

| Schicht | Umfang |
|---------|--------|
| **Master** | Globale Systemidentität und Kernregeln (einige Abschnitte gesperrt) |
| **Projekttyp** | Standards für eine Art von Arbeit (das Feld **Prompt** des Typs, auch als `AGENTS.md` unter diesem Typ gespeichert) |
| **Projekt** | Überschreibungen für ein Projekt. Leer erbt den Typ. Ein führendes `+` erweitert den Typ. Alles andere ersetzt ihn. Das Formular ist der Editor; ein nicht leerer Wert gewinnt gegenüber einer benachbarten `AGENTS.md`; Speichern schreibt die Datei, ein leerer Prompt löscht sie. |
| **Gespräch** | Threadspezifische Ergänzungen / einmalige Benutzer-Prompts |
| **Agenten-System-Prompt** | Betriebsprotokoll auf Agentenebene ([Konfiguration](/docs/de/agents/configure/)) |

| Begriff | Bedeutung |
|---------|-----------|
| Gesperrter Abschnitt | In der Oberfläche nicht bearbeitbar (Plattformintegrität) |
| Bearbeitbarer Abschnitt | Ton/Regeln lassen sich anpassen |
| Vererbung | Untere Schichten verfeinern obere |

<h3 id="the-memory-contract-in-the-master-prompt">Der Speicher-Vertrag im Master-Prompt</h3>

Die gesperrten Master-Abschnitte sagen jedem Agenten bei jedem Anbieter, wie Speicher funktioniert:

- **Kernregel 8 (MEMORY).** Der eigene Speicher von EYAS ist der einzige Speicher, den ein Agent hat. EYAS zeichnet Speicher automatisch auf; Agenten schreiben nie selbst Speicher. Von EYAS abgerufener Speicher kommt im `<eyas-memory>`-Block jeder Nachricht und ist Daten, keine Anweisung. Um weiterzusuchen, rufen Agenten `memory_search` auf und öffnen dann mit `memory_expand` einen Treffer — unter dem Namen, unter dem ihr Host diese EYAS-Tools listet (siehe [MCP — Tool-Namen pro Host](/docs/de/ai/mcp/#tool-names-per-host)). Agenten dürfen nie anderen Speicher lesen oder schreiben (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, die Datenordner von OpenCode, `ai-memory`-Ordner, Obsidian-Vaults) und nie Speicherdateien in ihren Arbeitsordnern oder im Datenordner von EYAS anlegen. Projekt-Anweisungsdateien wie `AGENTS.md` oder `CLAUDE.md` in den Arbeitsordnern sind in Ordnung.
- **Kernregel 7 (Grounding)** nennt `memory_search` als den Weg, eine Aussage im Speicher zu belegen.
- **System identity** sagt, dass EYAS Speicher hält und aufzeichnet, dass abgerufener Speicher im `<eyas-memory>`-Block jeder Nachricht kommt, nennt dasselbe Paar `memory_search` → `memory_expand` und bittet Agenten, Genutztes als `[source:<id>]` zu zitieren. Sie fordert Agenten nicht auf, eine `MEMORY.md` oder Tagesnotizen in `memory/YYYY-MM-DD.md` zu führen.

Das ist Prompt-Anleitung **und** Durchsetzung. Das Security-Gate verweigert Lese- wie Schreibzugriffe auf jeden Speicher der Liste, auf `security.foreignMemoryPaths` und auf den eigenen Datenordner von EYAS — für jedes Modell und jeden Tool-Aufruf, den es prüft, auch für die eigenen Werkzeuge von Claude Code. Siehe [Sicherheit & Datenschutz — Speicher außerhalb von EYAS](/docs/de/admin/security-privacy/#memory-outside-eyas).

**Modelle, die keine Tools aufrufen können, bekommen einen passenden Text.** Ist ein Modell in der Modellliste als ohne Tool-Unterstützung markiert (etwa ein Ollama-Modell, dessen Server keine Tool-Fähigkeit meldet, oder ein Modell, bei dem du die Tool-Unterstützung abgeschaltet hast), schickt EYAS ihm schon keine Tools und keine Tool-Liste. Auch seine **System identity** und seine **Core rules** fordern es dann nicht mehr auf, Tools aufzurufen:

- der Speicher-Punkt der System identity und Kernregel 8 sagen, dass das, was EYAS für die Nachricht abgerufen hat, im `<eyas-memory>`-Block ankommt, dass das der ganze Speicher ist, den es bekommt, und dass es nicht weitersuchen kann — sie verweisen es nicht mehr auf `memory_search` / `memory_expand`;
- Kernregel 7 und der Grounding-Punkt sagen ihm, Aussagen nur auf das Gespräch und den `<eyas-memory>`-Block zu stützen (zitiert als `[source:<id>]`) und sonst zu sagen, dass es sie nicht prüfen konnte — sie nennen `list_search_sources`, `search_indexed` und `search_knowledge` nicht mehr;
- der Punkt „du hast Tools“ wird zu: Dieses Modell kann keine Tools aufrufen, behaupte nie, du hättest es getan — sag stattdessen, was getan werden sollte;
- der Übergabe-Punkt sagt, dass es nicht übergeben und keine Spezialisten starten kann;
- es bekommt keine Skill-Liste (Skills werden über ein Tool geladen) und keine Agentenliste (Übergaben sind Tool-Aufrufe).

Der Wortlaut ohne Tools wird beim Bauen des Prompts eingesetzt. Die gespeicherten Abschnitte System identity und Core rules werden nie umgeschrieben, die Seite **System-Prompt** (`/prompt-settings`) zeigt also weiter den normalen Text. Ersetzt werden nur Absätze, die noch Wort für Wort den von EYAS ausgelieferten Text tragen; ein Absatz, den du bearbeitet hast, wird genau so gesendet, wie du ihn geschrieben hast, auch an Modelle ohne Tools. Das Panel **Kontext-Zusammenstellung** eines Zugs zeigt, was tatsächlich gesendet wurde. Modelle, die Tools aufrufen können, merken keine Änderung: Sie bekommen den Text genau wie gespeichert, mit einfachen Tool-Namen, und bei einem CLI-Anbieter sagt die letzte Zeile der Tool-Liste weiterhin, wie dieser Host EYAS-Tools benennt. Migriert wird nichts; bei Modellen ohne Tools ändert sich der gecachte Prompt-Präfix einmal.

**Upgrade.** Beim ersten Start nach dem Upgrade werden die gesperrten Abschnitte **System identity** und **Core rules** automatisch auf den neuen Text gebracht, wenn sie noch einen früher von EYAS ausgelieferten Text enthalten — auch auf Installationen, die noch die Regel aus 0.8.16–0.8.23 tragen, die Agenten `save_memory` vorschrieb, die alte Ausnahme für „eine MEMORY.md im Workspace“ oder die frühere Formulierung, die auf den Speicher-Abschnitt des Prompts verwies. Abschnitte, die der Owner bearbeitet oder entsperrt hat, bleiben unverändert; hast du sie angepasst, übernimm den neuen Text von Regel 8 von Hand. Der gecachte Prompt-Präfix ändert sich nach dem Upgrade einmal.

<h2 id="prompt-size">Auf das Modell zugeschnitten</h2>

EYAS baut den Prompt jedes Zugs für das Modell, das ihn beantwortet, statt einer festen Größe für jedes Modell.

- **Das Fenster kommt aus der Modellliste** (Anbieter → das Kontextgrößen-Badge des Modells), auch für CLI-Modelle: Ein Claude-Code-Modell, das mit 1M-Fenster gelistet ist, wird für 1M bemessen. Claude Code listet 1M nur für die eigenen 1M-Varianten der Laufzeit (zum Beispiel *Opus (1M context)*); seine Einträge Fable, Opus, Sonnet und Haiku werden für 200k bemessen, auch beim ersten Start, bevor die Laufzeit ihre Modelle gemeldet hat. Die bekannten Fenster der CLIs — Claude Code 200k, Grok 500k, Kimi 256k — gelten nur, wenn die Modellliste für dieses Modell kein Fenster hat. Ein Modell, über das EYAS nichts weiß, bekommt die Standardgrößen. Eine andere Fenstereinstellung pro Modell gibt es nicht.
- **Bei einem 100k-Token-Fenster** behält jeder Prompt-Abschnitt seine Standardgröße.
- **Größere Fenster** geben den anpassbaren Abschnitten mehr Platz, bis 2,5× ab 250k Tokens: Projektkontext, die Identitäts-, Stimm- und Notizdateien des Agenten, die Skill-, Tool- und Agentenlisten, Teamkontext und Arbeitsspeicher. Lange Agentennotizen, die nicht in die Standardgröße passen, kommen auf Modellen mit großem Fenster (etwa Groks 500k) vollständig an.
- **Unter etwa 29k Tokens** (typische kleine lokale Modelle) bleibt der ganze Prompt innerhalb von 35 % des Fensters, sodass das Gespräch noch hineinpasst. Bekannte Grenze: Dieses Budget umfasst nur den System-Prompt und den abgerufenen Speicher — Tool-Definitionen reisen daneben und werden nicht mitgezählt —, bei einem Fenster von etwa 4k–32k Tokens kann ein Modell mit Tools und großem Werkzeugsatz sein Fenster also trotzdem füllen.
- **Nie gekürzt:** die eigene Identität von EYAS, die Kernregeln, die Standardpersönlichkeit, der Laufzeitabschnitt und die Stimmzeile. Der Identitätsabschnitt kommt immer vollständig an.

Das Panel [Kontext-Zusammenstellung](/docs/de/daily/conversations/#context-composition) zeigt pro Abschnitt, ob er gekürzt wurde; das hängt vom gewählten Modell ab.

**Tools.** Ein Modell, das in der Modellliste als ohne Tool-Unterstützung markiert ist, bekommt keine Tools, keine Tool-Liste, keine Skill-Liste und keine Agentenliste in seinem Prompt, dazu einen Wortlaut der Speicher- und Grounding-Regeln ohne Tools (siehe [oben](#the-memory-contract-in-the-master-prompt)). Die Tool-Liste nennt nur die Tools, die dem Lauf tatsächlich angeboten werden (die **Tools**-Liste des Agenten plus die Speicher-Tools — siehe [Agenten — Tools](/docs/de/agents/configure/#tools--constraints)), nicht jedes registrierte Tool. Bei einem CLI-Anbieter nennt die Liste die EYAS-Tools nicht, die die gewährten eigenen Werkzeuge der CLI ersetzen (`read_file`, `grep`, `glob`; `write_file`, `edit_file`, solange sie schreiben darf; `run_command`, `git_status`, `git_diff`, solange sie ihre Shell nutzen darf), und endet mit einer Zeile, die dem Modell sagt, wie sein Host EYAS-Tools benennt (Claude Code: `mcp__eyas__<name>` vom EYAS-MCP-Server; Grok: über `use_tool` mit `eyas__<name>`; Kimi: auf dem MCP-Server `eyas`). Modelle bei API-Anbietern sehen die einfachen Namen.

**Für welches Modell der Prompt bemessen wird:**

| Pfad | Bemessen für |
|------|--------------|
| Chat-Züge | Das Modell, auf dem der Zug läuft, fest angeheftet oder automatisch geroutet |
| Hintergrund-Gesprächsläufe, Board-Bot, Teammitglieder, delegierte Spezialisten, Kanalantworten | Das Modell, das der Lauf aufruft. Ein Modell, das ohne seinen Anbieter angeheftet ist, wird dem Anbieter zugeordnet, in dessen Modellliste es steht; ein Modell, das kein Anbieter listet, bekommt die Standardgrößen und einfache Tool-Namen |
| Läufe, die kein Modell nennen | Das Standardmodell der Installation (Standard-Stufe, dann der Default-Anbieter, dann der erste aktive Anbieter) — das Modell, auf dem sie dann laufen |

**Abruf und Uhr reisen mit der Nachricht.** Was EYAS für einen Zug abgerufen hat und das aktuelle Datum samt Uhrzeit gehören nicht zum System-Prompt: Sie kommen in einem einzigen `<turn-context>`-Block, der an die aktuelle Nachricht gehängt wird, sodass der System-Prompt von Zug zu Zug gleich bleibt und cachebar ist. Die Größe des Abrufblocks bestimmt `memory.index.budgetChars` (2.400 Zeichen bei einem 100k-Token-Fenster), skaliert mit dem Fenster des antwortenden Modells wie die anderen Abschnitte. Siehe [Speicher — Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model).

**Die Uhr.** Datum und Uhrzeit kommen in der Zone, die `i18n.timezone` setzt (sonst die Zone des Servers), mit Name der Zone und UTC-Versatz — siehe [Konfiguration](/docs/de/deploy/configuration/#time-zone-of-the-models-clock).

---

<h2 id="prompt-enhancer">Prompt Enhancer (Gesprächsentwürfe)</h2>

Öffnet sich aus dem **Eingabefeld** des Gesprächs. Optimiert einen **einmaligen** Benutzer-Prompt für die **Modellfamilie** des Threads, mit Aufgabentyp-Chips, Qualitätsbewertung und knappen/gründlichen Alternativen. Er läuft auf der Routing-Stufe **Prompt-Optimierung** ([Routing & Budget](/docs/de/ai/routing-budget/#tiers)).

Vollständige Feldtabelle: [Gespräche — Prompt Enhancer](/docs/de/daily/conversations/#prompt-enhancer-dialog).

---

<h2 id="prompt-coach">Prompt-Coach (dauerhafte Schichten)</h2>

Die Schaltflächen **Prompt-Coach** öffnen einen rollenbewussten Coach für **dauerhaften** Text — nicht mit Gesprächsentwürfen vermischt. Auch der Coach läuft auf der Routing-Stufe **Prompt-Optimierung**.

| Umfang | Wo | Was er optimiert |
|--------|----|------------------|
| **Projekttyp** | Projekte → Projekttypen → Prompt | Wiederverwendbare Standards, die Projekte dieses Typs erben |
| **Projekt** | Projekte → Projekt → Prompt | Betriebs-Briefing für alle Gespräche des Projekts (Domäne, Konventionen, Erfolgskriterien) |
| **Agentensystem** | Agenten → **Konfiguration** → **System-Prompt** | Betriebsprotokoll des Agenten (nicht Stimme, nicht Projektdomäne, keine einmaligen Aufgaben) |

<h3 id="coach-dialog-controls">Bedienelemente des Coach-Dialogs</h3>

| Bedienelement | Bedeutung |
|---------------|-----------|
| Umfangs-Badge | **Projekt-Schicht** / **Projekttyp-Schicht** / **Agent systemPrompt** |
| Entwurf / Antwort | Ziel beschreiben oder einen Entwurf einfügen; mit **Senden** iterieren |
| **Qualität N/10** | Checklisten-Bewertung; **Lücken: …** listet Fehlendes, **Checkliste abgedeckt**, wenn nichts fehlt |
| **Zwei Alternativen (knapp + gründlich)** | Knappe + gründliche Variante |
| **Vorgeschlagenes Briefing** | Kandidat zum Einfügen |
| **Übernehmen** | Das Briefing ins Formularfeld schreiben |

## Felder und Bedienelemente

<h2 id="prompts-list">`/prompts` — Prompt-Vorlagen</h2>

Untertitel: *Konfiguriere System-Prompt-Vorlagen für die Prompt-Vererbungskette.*

| Bedienelement | Bedeutung |
|---------------|-----------|
| Ebenen-Tabs | **Master / Projekttyp / Projekt / Unterhaltung** |
| Vorlagenliste | Name, Aktiv-Kennzeichen, Badge **Gesperrt** |
| **Vorlage ansehen / Vorlage bearbeiten** | Editorbereich |
| **Aktivieren / Deaktivieren** | `isActive` umschalten |
| **Inhalt** | Text der Vorlage |

<h2 id="prompt-settings">`/prompt-settings` — System-Prompt</h2>

Untertitel: *Diese Abschnitte bilden die Grundlage jeder KI-Unterhaltung. Gesperrte Abschnitte können nicht geändert werden.*

**Gesperrte** Abschnitte werden schreibgeschützt angezeigt. Der Abschnitt **personality** ist **Bearbeitbar** — Speichern sendet `PATCH /prompts/master/personality`.

## Verwandt

- [Projekte — Prompt-Felder](/docs/de/daily/projects/)
- [Agenten — System-Prompt](/docs/de/agents/configure/)
- [Gespräche](/docs/de/daily/conversations/)
- [Speicher](/docs/de/knowledge/memory/)
- [MCP — Tool-Namen pro Host](/docs/de/ai/mcp/#tool-names-per-host)
- [Routing & Budget](/docs/de/ai/routing-budget/)
