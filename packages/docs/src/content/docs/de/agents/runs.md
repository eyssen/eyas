---
title: Läufe & Mission Control
description: Laufende Agentenläufe überwachen — abbrechen, fortsetzen, wiederholen — und das Live-Ops-Board beobachten.
---

**Wozu das da ist.** **Agent-Ausführungen** ist die Tabelle der Läufe: laufende und beendete, mit Status, Prüfung, Runden, Tokens und Aktionen. **Mission Control** (in der Seitenleiste **Leitstand**) ist das Live-Ops-Board der Agentenkarten — wer läuft, wer auf dich wartet, wer fertig ist. Die Tabelle dient Verlauf und Wiederherstellung, Mission Control dem schnellen Blick auf das Jetzt.

## Wann du es brauchst

- Ein Lauf hängt, hat das Rundenlimit erreicht oder ist fehlgeschlagen — du willst **Fortsetzen** (Checkpoint) oder **Wiederholen** (vom Ziel aus).
- Etwas läuft, und du brauchst **Abbrechen**, ohne die Unterhaltung zu öffnen.
- Du willst sehen, ob der Vollständigkeitskritiker **Ziel erreicht** / **Ziel nicht erreicht** vergeben hat.
- Du brauchst Summen: läuft, wartet auf Freigabe, heute abgeschlossen, Kosten heute.
- Du willst von einer Live-Karte aus einen Lauf unterbrechen oder seine Unterhaltung öffnen.

## Typischer Ablauf

1. Öffne **Agent-Läufe** in der Seitenleiste (Bereich **KI**) — Route `/agent-runs`. Oder **Leitstand** unter **Überwachung** — Route `/mission-control`.
2. Prüfe auf Agent-Ausführungen **Status** und **Prüfung**. Bei einer aktiven Zeile **Abbrechen**; bei einer fehlgeschlagenen, hängenden, abgebrochenen oder am Rundenlimit gestoppten Zeile **Fortsetzen** oder **Wiederholen**.
3. Lies in Mission Control die Summenleiste und handle dann auf einer Karte (**Unterbrechen**, **Unterhaltung öffnen**).
4. Zeile oder Karte ändern ihren Status live (WebSocket). Öffnest du die Unterhaltung, siehst du Fortschritt, Laufbaum und Tool-Aufrufe desselben Laufs.

## Agent-Ausführungen

**Route:** `/agent-runs`. Untertitel: *Live-Überwachung der Agent-Ausführungen — hängende Ausführungen werden erkannt und lassen sich abbrechen.* Leer: *Noch keine Agent-Ausführungen.*

| Spalte | Bedeutung |
|--------|-----------|
| **Status** | Siehe Status unten |
| **Prüfung** | Vollständigkeitskritiker: **Ziel erreicht** / **Ziel nicht erreicht** / **Ungeprüft** (oder —, wenn nie geprüft) |
| **Agent** | Agenten-ID |
| **Art** | Art des Laufs (oder —) |
| **Runden** | Verbrauchte Runden |
| **Tokens** | Verbrauchte Tokens |
| **Letzter Fortschritt** | Zeit seit dem letzten Lebenszeichen |
| **Aktionen** | **Abbrechen** (läuft, hängt, wird aktualisiert) · **Fortsetzen** · **Wiederholen** (fehlgeschlagen, hängt, abgebrochen, Rundenlimit) |

### Status

| Status | Bedeutung |
|--------|-----------|
| **Läuft** | In Arbeit |
| **Hängt** | Kein Fortschritt — abbrechbar / wiederholbar |
| **Wird aktualisiert** | Warmes Fortsetzen läuft |
| **Wartet auf Freigabe** | Wartet auf eine Autonomie-Freigabe |
| **Abgeschlossen** | Fertig |
| **Rundenlimit** | Rundenbudget erreicht, ohne fertig zu werden — fortsetzen oder wiederholen |
| **Fehlgeschlagen** | Fehler |
| **Abgebrochen** | Gestoppt |

### Prüfung

| Badge | Bedeutung |
|-------|-----------|
| **Ziel erreicht** | Ein Prüfmodell hat das Ergebnis mit dem Ziel abgeglichen und es als erreicht bewertet |
| **Ziel nicht erreicht** | Das Ziel wurde nicht erreicht; die Lücken gingen einmal an den Agenten zurück |
| **Ungeprüft** | Konnte nicht geprüft werden (kein Prüfmodell oder nichts aufgezeichnet) |

**Ungeprüft** erscheint auch, wenn kein Hintergrundmodell die Prüfung ausführen konnte (zum Beispiel auf einer reinen Grok-Installation, deren Isolation noch nicht geprüft ist), wenn das Modellbudget gestoppt ist oder wenn jeder Versuch scheiterte; der Lauf selbst endet trotzdem normal.

**Welche Belege der Kritiker akzeptiert.** Braucht das Ziel eines Laufs Quellen (recherchieren, nachschlagen, zitieren, implementieren, fixen, refaktorieren …), sucht der Kritiker nach Belegen und beurteilt dabei jedes Modell gleich:

- **Speicher, den EYAS dem Lauf geliefert hat, zählt als Beleg**, egal welcher Anbieter oder welches Modell lief. Dem Prüfmodell wird gesagt, welche Speicher-Elemente geliefert wurden, und es beurteilt, ob die Antwort belegt ist.
- **Tool-Belege kommen aus EYAS' eigenem Tool-Ausführungsprotokoll**, nicht nur aus den Namen, die der Anbieter meldet — ein `memory_search` über die Bridge von Claude Code oder Grok/Kimi zählt genauso wie ein nativer Aufruf.
- `memory_expand` zählt ebenfalls als Abruf-Beleg.

Ein Lauf ohne gelieferten Speicher, ohne Abruf-Tool-Aufruf und ohne `[source:…]`-Zitat wird mit **Ziel nicht erreicht** markiert, wenn sein Ziel Quellen braucht. Der Vollständigkeitskritiker und der Bewertungsplan für komplexe Hintergrundziele laufen als ein kurzer isolierter Aufruf auf dem Hintergrundmodell von EYAS — ohne Tools, ohne Gesprächsverlauf (siehe [Routing & Budget — Das Hintergrundmodell](/docs/de/ai/routing-budget/#background-model)). Ohne ein solches Modell wird kein Bewertungsplan geschrieben.

### Fortsetzen und Wiederholen bei jedem Anbieter

**Fortsetzen** macht am letzten Checkpoint weiter (Nicht-Wiederholen-Schutz). **Wiederholen** plant vom Ziel aus neu; bereits ausgeführte destruktive Aufrufe bleiben geschützt. Beides funktioniert für Läufe auf Claude Code, Grok CLI und Kimi CLI genauso wie für API-Anbieter:

- EYAS zeichnet die Tools, die eine CLI selbst ausgeführt hat (Shell-Befehle, Datei-Schreib- und -Bearbeitungsvorgänge, aufgerufene EYAS-Tools), im Verlauf des Laufs und in seinem Tool-Ausführungsprotokoll auf, unter den Namen, die EYAS verwendet (Bash erscheint als `run_command` usw.).
- Nach einem Zug, in dem die CLI Tools ausgeführt hat, und immer wenn ein Lauf anhält, um auf eine Freigabe zu warten, speichert EYAS einen Checkpoint: die bisherige Unterhaltung plus die Antwort des Modells.
- Fortsetzen oder Wiederholen macht an diesem Checkpoint weiter, und das Modell bekommt eine Zusammenfassung der bereits ausgeführten Tools.
- Versucht das Modell, einen destruktiven Aufruf zu wiederholen, den der ursprüngliche Lauf bereits erfolgreich ausgeführt hat, lehnt EYAS ihn ab, bevor die CLI ihn ausführt: *already executed on the original run — duplicate side effect prevented*. Derselbe Aufruf mit anderen Argumenten oder ein Aufruf, der beim ersten Mal scheiterte, ist erlaubt. Dateibearbeitungen und -verschiebungen einer CLI sind ebenfalls abgedeckt.
- Derselbe Schutz gilt für EYAS-Tools, die Grok und Kimi über die Tool-Bridge aufrufen: Ein fortgesetzter oder erneut versuchter Lauf, der einen EYAS-Tool-Aufruf wiederholt, den der ursprüngliche Lauf bereits abgeschlossen hat (zum Beispiel dieselbe E-Mail oder Rechnung senden), wird abgelehnt, bevor er läuft, und die Tool-Zeile zeigt **Übersprungen** mit diesem Grund. Dasselbe Tool mit anderen Argumenten läuft weiterhin. Bewiesen mit der installierten Grok CLI; wie ein echtes Kimi-Binary diese Aufrufe meldet, ist noch auf keinem Host geprüft.
- In einem Hintergrundlauf auf Grok oder Kimi wartet ein EYAS-Tool-Aufruf in einer Kategorie auf **Hinweis** oder **Freigeben**, oder einer, den das Security-Gate eskaliert (auch auf **Auto**), auf Freigabe; der überwachte Lauf pausiert als **Wartet auf Freigabe**, sobald der Zug der CLI endet, und die Freigabe lässt genau diesen Aufruf einmal laufen. Siehe [Autonomie](/docs/de/agents/autonomy/).

### Wie ein Lauf endet

- Ein Lauf, der sein Rundenlimit erreicht, endet normal mit dem Status **Rundenlimit**, und die Teilantwort bleibt erhalten.
- Ein Lauf, der sein Tool-Aufruf-Budget aufbraucht, endet ebenfalls normal; sein Status bleibt **Abgeschlossen**.
- Ein eigener Stopp des Modells wegen Rundenlimit, Länge oder Ablehnung ist ein Ergebnis, kein Fehler.
- Ein Tool-Aufruf, der nie lief, wird nicht als Erfolg gemeldet. Der Grund ist einer von: wegen des Limits pro Zug übersprungen, wegen des Tool-Budgets des Laufs übersprungen, beim Fortsetzen als Duplikat übersprungen, vom Security-Gate abgelehnt oder wartet auf Freigabe. Der Chat zeigt jeden als eigenen Status in der Tool-Zeile, ein Badge unter der Antwort zeigt, wie der Zug endete, und ein Aufruf, der auf Freigabe wartet, öffnet eine Freigabekarte in der Unterhaltung sowie einen Eintrag in der Warteschlange [Freigaben](/docs/de/agents/autonomy/) — siehe [Unterhaltungen — Ergebnis eines Zugs](/docs/de/daily/conversations/#turn-outcome).
- Endet ein Lauf mit einer Antwort, läuft die Erfassung dauerhafter Erinnerungen darauf — für Hintergrund-, Spezialisten-, delegierte, Pipeline-, A2A- und Teammitglied-Läufe wie für Chat-Züge, unter denselben `memory.capture.*`-Einstellungen. Ein Lauf, der nichts geantwortet hat, schreibt keine Capture-Zeile, und das Capture-Ledger hält fest, von welchem Weg eine Zeile kam (`entry_path`). Siehe [Speicher — Capture ist standardmäßig an](/docs/de/knowledge/memory/#capture-is-on-by-default).

## Mission Control

**Route:** `/mission-control`. Untertitel: *Live-Ansicht aller laufenden Agenten.* Leer: *Es laufen keine Agenten.* Banner **Verbindung getrennt — neuer Verbindungsversuch…**, wenn der Socket weg ist.

### Summen

| Kennzahl | Bedeutung |
|----------|-----------|
| **Läuft** | Jetzt live |
| **Wartet auf Freigabe** | Wartet auf dich |
| **Heute abgeschlossen** | Durchsatz heute |
| **Kosten heute** | Ausgaben heute |

Die Karten sortieren wartend auf Freigabe zuerst, dann laufend, pausiert, inaktiv, fehlgeschlagen, abgeschlossen, abgebrochen; innerhalb eines Status die zuletzt aktualisierte zuerst.

| Kartenelement | Bedeutung |
|---------------|-----------|
| Status | **Inaktiv · Läuft · Wartet auf Freigabe · Pausiert · Abgeschlossen · Fehlgeschlagen · Abgebrochen** |
| **Runde / Tokens / Kosten** | Verbrauch |
| ↳ *übergeordnet* | Der Lauf wurde von einem anderen Lauf gestartet |
| *N ausstehende Freigabe(n)* | Warteschlange dieser Session |
| **Unterbrechen** | Stoppt den Lauf nach einer Bestätigung (*Diesen Agenten unterbrechen?*). Nur solange er läuft, und nur für den Benutzer, der ihn gestartet hat, oder einen Owner oder Admin |
| **Unterhaltung öffnen** | Zum Thread springen |

Die Karte hat keine Pause- oder Fortsetzen-Steuerung. Um einen gestoppten Lauf fortzuführen, nutze **Fortsetzen** oder **Wiederholen** auf Agent-Ausführungen.

## In einer Unterhaltung

Während ein Lauf aktiv ist, siehst du außerdem:

- Agenten-Fortschritt (*Schritt N / Max*, wo der Anbieter Schritte meldet, sonst *Werkzeugaufrufe: N*; über den Lauf summierte Tokens; Abbrechen)
- Laufbaum / Workflow — bei jedem Anbieter, mit Status und den Kosten des Laufs
- Aufklappbare Tool-Aufrufe, Badges zum Ergebnis des Zugs und Freigabekarten

Beschrieben unter [Unterhaltungen](/docs/de/daily/conversations/).

Ein Lauf arbeitet in den Arbeitsordnern seiner Unterhaltung. Eine Unterhaltung ohne eigene Ordner hat ihren eigenen EYAS-Workspace, den sie beim Anlegen bekommt oder, bei älteren Unterhaltungen, mit der nächsten Nachricht — ein Lauf wählt nie selbst einen Ordner. Siehe [Unterhaltungen — Ordner](/docs/de/daily/conversations/#working-folders).

## Siehe auch

- [Unterhaltungen](/docs/de/daily/conversations/)
- [Start — Läuft gerade](/docs/de/daily/home/)
- [Autonomie](/docs/de/agents/autonomy/)
