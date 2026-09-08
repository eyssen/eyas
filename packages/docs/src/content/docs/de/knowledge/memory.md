---
title: Speicher
description: Was EYAS behält — automatische Vault-Notizen, fünf Stufen, die Rohaufzeichnung jeder Nachricht, und welchen Store du wann nutzt.
---

**Wozu das da ist.** Speicher ist EYAS' eigener Langzeitspeicher. Ein dauerhafter Fakt aus einem Gespräch wird ohne Nachfrage zur Vault-Notiz, und dieselbe Notiz liest jedes spätere Gespräch zurück. Hier prüfst du Working-Blöcke, episodische Fakten, Vault-Dateien und die Review-Queue — du kuratierst kein Wiki. Seit 0.8.23 führt EYAS zusätzlich eine Rohaufzeichnung jeder Nachricht, die es speichert; die wird geschrieben, ist aber noch nirgends lesbar — **Die Rohaufzeichnung** weiter unten ist alles, was es dazu zu wissen gibt.

## Wann du es brauchst

- Der Assistent soll sich merken, wer du bist, wie du arbeitest, oder welche Constraints ein Projekt hat.
- Ein Fakt stand im Chat, und du willst sehen, ob er in der Vault gelandet ist (oder warum Capture übersprungen wurde).
- Review, Tags, Graph oder Konsolidierung — oder **Today's note**.
- Du wählst zwischen Speicher, Wissens-Wiki, Dokumenten und handgeschriebenen Vault-Dateien (siehe unten).
- Capture für diese Instanz aus (`memory.capture.enabled: false`) — oder auch die Rohaufzeichnung aus (`memory.l0.enabled: false`).

## Typischer Ablauf

1. Öffne **Speicher** in der Sidebar (**Inhalt**) — Route `/memory`. (Auch unter **Einstellungen → KI & Modell**.)
2. **Overview** (Zähler, Salience, jüngste Episoden), dann **Vault Files** für dauerhafte Notizen.
3. Führe ein Gespräch länger als ~40 Zeichen, das einen bleibenden Fakt nennt. Nach der Antwort hierher — eine neue Vault-Notiz (`user`, `feedback`, `domain`, `project` oder `reference`).
4. Wenn nichts erscheint: zu kurz, Capture aus, oder God-Mode-Runde (die schreiben keine Vault-Notiz). Schreib die Notiz sonst von Hand in die Vault. Die siegreiche Antwort einer God-Mode-Runde landet trotzdem in der Rohaufzeichnung — siehe **Die Rohaufzeichnung** unten.

## Welchen Store

| Store | Job |
|-------|-----|
| **Speicher** (diese Seite) | Automatische + agentengeschriebene Fakten. EYAS injiziert einen Einzeilen-Index in spätere Prompts. |
| **Wissen** Wiki | Kuratierte Seiten, **die du** editierst. Capture schreibt hier nicht. |
| **Dokumente** | Hochgeladene Dateien zur Retrieval — keine Identitätsnotizen. |
| **Vault-Dateien** (handgeschrieben) | Dieselbe Vault wie Capture (`data/vault/…`). Nicht `~/.claude` / `~/.grok`. |
| **Projekt-Wiki** | Ticket- und Entscheidungsseiten eines Projekts, nicht globaler Speicher. |
| **Rohaufzeichnung** | Jede Nachricht, die EYAS speichert, ein zweites Mal wörtlich und komprimiert. Wird seit 0.8.23 automatisch geschrieben; gelesen oder angezeigt wird sie noch nirgends. |

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

Ein zweiter Block pro Zug holt **verwandte frühere Arbeit** aus dem Vault,
dem episodischen Speicher und früheren Gesprächsnachrichten — die aktuelle
Nachricht ist die Abfrage. Das Modell muss `search_memory` nicht aufrufen,
damit diese Treffer erscheinen. Die vollständigen Texte lädt weiterhin
`search_memory`. Frühere Nachrichten sind durchsuchbar, weil sie schon
gespeichert sind — dieser Block legt keine zusätzliche Kopie an. (Die
Rohaufzeichnung unten ist eine eigene, absichtliche Zweitkopie; gelesen wird sie
noch nicht.)

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
überschreibt nichts. Bereinigt wird vor dem Schreiben, nicht beim Lesen. Das gilt für Vault-Notizen;
die Rohaufzeichnung unten wird wörtlich gespeichert, ohne diesen Durchlauf.

**Projektgedächtnis.** Was in den Unterhaltungen eines Projekts gelernt wurde,
liegt unter `projects/<projekt-id>/`, steht in diesem Projekt vor den
allgemeinen `reference`-Notizen und taucht sonst nirgends auf — Notizen fremder
Projekte erreichen den Prompt nie. Das Sammelprojekt **General**, in dem jede
Unterhaltung startet, zählt dabei nicht als Projekt: dort Gelerntes bleibt ein
Fakt über dich oder über die Arbeitsweise und begleitet dich überall hin.

Agenten erinnern mit `search_memory`. Default-**`scope` ist `current`**: dieses Projekt, sein Typ, globale user/feedback/reference-Notizen. `scope: all` für den ganzen Vault. Die Memory-Seite (`/memory`) sucht ungefiltert.

### Projektnotizen ohne Projekt

Eine Notiz mit `kind: project` oder `kind: domain`, die kein `project:` /
`projectType:` trägt, ist **global**: sie steht im Dauerindex, in
`search_memory` und in der verwandten Arbeit jeder Unterhaltung, gerankt als
Projektnotiz. Verschiebst du sie nach `projects/<id>/` — oder trägst `project:`
ins Frontmatter ein —, gilt sie nur noch für dieses Projekt. Importierte Notizen
bleiben so, bis du die passenden Projekte anlegst.

Der Dauerindex hat ein Zeichenbudget: `memory.index.budgetChars`, Standard 2400.
Erhöhe es, wenn deine `user`- und `feedback`-Zeilen nicht mehr hineinpassen.

### Importierte Geheimnisse bleiben aus dem Recall

Der Importer verwirft nie eine Datei, weil sie Zugangsdaten enthält. Sie wird wörtlich gespeichert, und das Element trägt den Tag `contains-secrets` — als Notiz-Tag, als Skill-Fähigkeit oder als episodischen Tag, je nachdem, wozu es geworden ist.

Standardmäßig bleibt ein solches Element aus allem heraus, was das Modell von sich aus erreicht: dem Dauerindex, `search_memory`, verwandter Arbeit, dem Reflexions-Job, dem nächtlichen Konsolidierer und dem Skill-Matcher. Es wird nie eingebettet und nie dem optionalen Anreicherungsmodell übergeben. Die Speicher-Seite zeigt es dir weiterhin vollständig. Mit `memory.recall.includeSecrets: true` in `config/local.yaml` und einem Neustart öffnest du es dem Modell.

Dieses Tor verhindert die automatische Aufnahme; ein Dateisystem-Sandkasten ist es nicht. Ein Agent mit Dateilese-Werkzeugen kann die ursprüngliche Datei auf der Platte weiterhin lesen. Eine importierte Agenten-Persona und eine freigegebene Workspace-Regeldatei sind gar nicht abgeschirmt — dort ist der Inhalt *der* Prompt —, prüfe diese Zeilen also vor der Freigabe.

Die Tags `legacy` (ein alter Speicherordner) und `third-party` (fremde Produktdokumentation) bezeichnen ganz normale, voll abrufbare Notizen; sie sagen nur, woher eine Notiz kommt. Jedes importierte Element trägt außerdem `source:<adapter>` und nennt damit den Adapter, der es gelesen hat. Eine selbst geschriebene Notiz darf `contains-secrets` in ihrem eigenen Frontmatter deklarieren und wird genauso behandelt. Siehe [Datenimport & -export](/docs/de/admin/data-port/).

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

Jedes Ergebnis, das das Gate erreicht, schreibt eine `memory_capture_runs`-Zeile: Skips mit Grund, Extraktionen mit Kinds, plus Spalte `provider` (`provider/model`, oder null). Zwei Absichten: Capture aus schreibt nichts; ein Hintergrundlauf ohne Assistant-Text erreicht das Gate nicht. **God Mode**-Runden kehren vor dem Post-Turn-Block mit eigenem Stream zurück — sie schreiben also weder eine Vault-Notiz noch eine Zeile hier. Die Rohaufzeichnung unten ist ein eigenes Ledger und erfasst sie sehr wohl.

---

## Die Rohaufzeichnung

**Nichts Gesagtes geht verloren.** Jede Nachricht, die EYAS festhält — deine, die
des Assistenten und die Ausgaben von Agentenläufen im Hintergrund — wird jetzt
ein zweites Mal wörtlich aufbewahrt, in einer Rohaufzeichnung neben dem Gespräch
selbst. Sie wird beim Schreiben komprimiert (auf echtem Text rund 2,7× kleiner)
und unter einem Hash ihrer eigenen Bytes abgelegt; derselbe Satz, innerhalb eines
Gesprächs wiederholt, liegt also einmal da und zählt zweimal.

**Vor allem anderen: Zu sehen ist davon noch nichts.** Diese Version startet nur
die Aufzeichnung. Es gibt keine Seite, kein Suchfeld und keinen Befehl, der die
Rohaufzeichnung zurückliest, und nichts davon wird dem Assistenten vorgelegt. In
deine Prompts kommt heute genau das, was vorher hineinkam — der einzeilige
Vault-Index und der oben beschriebene Block verwandter Arbeit. Der Abruf kommt in
einer späteren Version.

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
Stempel wird nie vererbt: Was **du** geschrieben hast, gilt als Text des Owners,
was das Modell geschrieben hat, nur als daraus abgeleitet, und Tool-Ausgaben als
von außen übernommen. Eine Zusammenfassung kann nie mehr Vertrauen genießen als
die Worte, aus denen sie gemacht ist.

### Was EYAS daraus ableitet — ohne Modellaufruf

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

Wie oben: Auch davon ist noch nichts lesbar.

### Was es kostet, und wie du es abschaltest

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
| `memory.engine` | `legacy` | Welche Engine den Speicher bedient. `v2` zu setzen ändert heute nichts Beobachtbares |

`memory.capture.enabled: false` schaltet die Rohaufzeichnung **nicht** ab. Dieser
Schalter regelt Vault-Notizen und den kleinen Modellaufruf dahinter; die beiden
sind unabhängig, und eines abzuschalten lässt das andere laufen.

`eyas doctor` meldet, ob Kompression verfügbar ist und welche Implementierung
benutzt wird. Ist keine da, sagt EYAS das im Log und zeichnet nichts auf, statt
still einen Puffer zu füllen.

### Tool-Ergebnisse werden nicht aufgezeichnet — und warum das so bleiben sollte

`memory.l0.captureToolResults` ist **default aus**. Lies das, bevor du es
einschaltest.

Eingeschaltet behält die Rohaufzeichnung die **gesamte Ausgabe jedes
Tool-Aufrufs, wörtlich und unbearbeitet**, plus die ersten 2.048 Zeichen der
Argumente, mit denen er aufgerufen wurde. Also die vollständige Ausgabe eines
Befehls, den Inhalt jeder Datei, die der Assistent liest, und jeden Einmalcode
und jedes Token, das ein Tool zufällig zurückgibt — alles als gewöhnlicher Text
in der Datenbank. Nichts maskiert es, nichts prüft es, und Kompression ist keine
Verschlüsselung. Vault-Notizen laufen vor dem Schreiben durch das Datenschutz-Modul;
aufgezeichnete Tool-Ergebnisse nicht.

Jedes aufgezeichnete Ergebnis ist bei `memory.l0.toolResultMaxBytes` (8 KB)
gedeckelt und wird an einer Zeichengrenze geschnitten, sichtbar als gekürzt
markiert. Bei eingeschaltetem Flag gibt EYAS bei jedem Start genau diese Warnung
aus.

### Warum manche Sätze abgelehnt werden

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
ebenfalls als nicht vertrauenswürdig markiert. Da diese Schichten bisher niemand
liest, ist der einzige Effekt heute eine Zahl im Lauf-Ledger.

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
- [Konfiguration](/docs/de/deploy/configuration/) (`memory.l0.*`-Keys)
- [Tools](/docs/de/automation/tools/)
