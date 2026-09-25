---
title: Planer
description: Wiederkehrende Jobs, Agent-Routinen, Kalender und Gantt, und Jobs, die nicht laufen können.
---

**Wozu das da ist.** Der Planer ist die Uhr: wiederkehrende System-Handler (Backup, Wartung) und Agent-Routinen (ein Agent mit einem Prompt auf einem Cron). Du legst Jobs an, siehst, wann sie zuletzt liefen, und erkennst die, die nie auslösen werden. Es ist nicht das Board — das Board verfolgt Arbeitspakete, diese Seite Zeitgeber.

**Route:** `/scheduler`. Titel: **Zeitplan**. Untertitel: *Wiederkehrende Jobs, Agent-Routinen und Ausführungshistorie.* Sidebar: **Planer**.

## Wann du es brauchst

- Ein Agent soll jeden Morgen einen Prompt ausführen, ohne dass du ein Gespräch öffnest.
- Ein Backup oder ein anderer System-Handler soll auf einem Cron laufen, und du willst die letzte/nächste Ausführung sehen.
- Ein Job steht still, und du brauchst das Badge **Kein Handler / Startet nie / Nicht eingeplant** statt eines stillen Aussetzers.
- Eine Routine soll gründlicher (oder günstiger) nachdenken, als ihr Agent es sonst tut — setze ihren **Aufwand**.
- Du prüfst auf einer Installation mit mehreren Instanzen Cluster-Führung, überfällige Jobs oder Dead-Letter.

## Typischer Ablauf

1. Öffne **Planer** in der Sidebar (`/scheduler`).
2. Wähle **Liste**, **Gantt** oder **Kalender**. Auf den Zeitleisten-Ansichten zoomst du mit **Tag / Woche / Monat**.
3. **Job erstellen** — wähle **System-Handler** oder **Agent-Routine**, fülle **Name** und **Zeitplan (Cron)** aus, dann den **Handler**, bei einer Agent-Routine die **Agent-ID**, den **Prompt** und optional den **Aufwand** — dann **Erstellen**.
4. Beobachte die Health-Leiste. Ein **nicht lauffähig**-Badge bedeutet, dass der Job so, wie er konfiguriert ist, nicht ausgeführt wird; fahre für den Grund mit der Maus darüber.
5. **Jetzt ausführen** löst sofort aus (für einen Ereignis-Job der einzige Weg). **Pause / Fortsetzen** ändern den laufenden Job; klicke einen Job an, um ihn **Neu planen** oder seinen **Aufwand** zu ändern.

## Funktionen

Drei Ansichten zeigen dieselben Jobs: eine Tabelle, ein Gantt mit vergangenen/nächsten Balken und einen Kalender. **Infrastruktur-Jobs anzeigen** nimmt interne Infrastruktur-Jobs dazu, blendet aber nie einen Job aus, der nicht laufen kann — ein kaputter System-Job bleibt auch mit ausgeschaltetem Filter sichtbar.

**Zeitpläne.** Ein Job löst auf einen Cron-Ausdruck, ein festes Intervall oder ein Bus-Ereignis aus. Das Formular nimmt einen Cron-Ausdruck oder eine der Kurzformen `hourly`, `daily` (09:00), `weekdays` (Montag–Freitag 09:00), `weekly` (Montag 09:00) und `monthly` (der 1., 09:00). Ein Intervall- oder Ereignis-Trigger wird über die API oder das Tool `schedule_create` gesetzt; **Neu planen** macht einen Job zum Intervall-Job, wenn du eine ganze Zahl Millisekunden eingibst. Das Zeilensymbol zeigt den Trigger-Typ.

<h3 id="agent-routines-run-in-a-conversation">Agent-Routinen laufen in einem Gespräch</h3>

Jede Ausführung einer Agent-Routine (Typ **Agent-Routine** oder ein mit dem Tool `schedule_create` angelegter Job) erstellt ein Gespräch und führt den gewählten Agenten darin als überwachten, autonomen Hintergrundlauf aus — derselbe Runner, den Board-Karten und Wiederholungen nutzen: das eigene Modell des Agenten, voller EYAS-Speicherabruf zum Prompt des Jobs, angehängte Designs, Dokumente, dauerhafte Speichererfassung und die Vollständigkeitsprüfung. Sensible Tools laufen über die [Autonomie](/docs/de/agents/autonomy/)-Stufen.

- Das Gespräch gehört dem Benutzer, der den Job angelegt hat; hat ein Agent oder das System ihn angelegt, dem Owner. Sein Titel ist der Jobname oder *Scheduled: &lt;Prompt&gt;*.
- **Letzte Ausführungen** im Detailbereich des Jobs zeigt für jeden Lauf einen Link **Unterhaltung öffnen**, auch für fehlgeschlagene.
- Ein Lauf, der nicht starten kann, lässt diese Ausführung mit einem Grund fehlschlagen, der mit einem Code beginnt: `agent_unavailable` (Agent fehlt oder ist deaktiviert), `over_budget`, `invalid_config`, `conversation_busy`, `conversation_forbidden`, `runner_unavailable`, `owner_unavailable`. Fehlschläge zählen zum Limit für aufeinanderfolgende Fehler / Dead-Letter des Jobs.
- **Aufwand.** Eine Agent-Routine kann ihren eigenen **Aufwand** haben (siehe [Job erstellen](#create-job)). Jeder Lauf schreibt den Aufwand des Jobs in sein Laufgespräch, daher zeigt der Aufwands-Chip der Antwort die Stufe des Jobs mit der Quelle *Unterhaltung*. Ein Job auf **Automatisch** schreibt nichts: Der Lauf übernimmt den Aufwand des Agenten (Quelle *Kollege*), sonst den Modellstandard. Die Stufe wird an das Modell angepasst, auf dem der Lauf landet.

**Upgrade-Hinweis.** Agent-Routinen, die angelegt wurden, als geplante Agent-Läufe noch nicht funktionierten, schlugen bei jeder Ausführung fehl. Nach dem Upgrade laufen sie beim nächsten Auslöser los — und verbrauchen Tokens. Prüfe oder pausiere sie vorher.

**Fortgeschritten (nur API).** Eine `handlerConfig` mit `conversationPolicy: 'reuse'` und einer `conversationId` führt den Job erneut in diesem Gespräch aus, mit dem neuen Prompt als Ziel; das Gespräch muss demselben Benutzer gehören und darf nicht gerade laufen. Mit `reuse` setzt der Job bei jedem Lauf den Aufwand dieses Gesprächs; mit Automatisch wird eine dort von Hand oder von einem früheren Lauf hinterlassene Stufe gelöscht. Das Anlegen oder Bearbeiten einer Agent-Routine, deren `handlerConfig` `agentId` oder `prompt` fehlt, die kein gültiges JSON ist oder ein ungültiges `effort` enthält, wird mit `400` abgelehnt. `effort` ist `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` oder `auto`/null (der Aufwand des Agenten). Ersteller des Jobs ist immer der angemeldete Benutzer; ein `createdBy` im Request-Body wird ignoriert.

Ein ungültiger Cron-Ausdruck oder ein Intervall unter einer Sekunde wird abgelehnt — bei **Erstellen**, bei **Neu planen** und über die API — mit dem Grund im Formular: *„Dieser Zeitplan ist ungültig, der Job würde nie laufen. Prüfen Sie den Cron-Ausdruck oder das Intervall.“* Ein **Ereignis**-Trigger wird angenommen, aber ein solcher Job kann noch nicht von selbst auslösen — er bekommt das Badge **Startet nie**.

## Felder und Bedienelemente

<h2 id="views">Ansichten</h2>

| Ansicht | Bedeutung |
|---------|-----------|
| **Liste** | Job-Tabelle |
| **Gantt** | Zeitleisten-Balken |
| **Kalender** | Kalenderansicht |
| Zoom **Tag / Woche / Monat** | Maßstab für Gantt/Kalender |

<h2 id="create-job">Job erstellen</h2>

**Job erstellen** öffnet das Formular **Neuer geplanter Job**:

| Feld | Bedeutung |
|------|-----------|
| **System-Handler** / **Agent-Routine** | Der Typ des Jobs |
| **Name** | Anzeigename; die Laufgespräche einer Agent-Routine tragen ihn als Titel |
| **Zeitplan (Cron)** | Cron-Ausdruck oder Kurzform (`hourly`, `daily`, `weekdays`, `weekly`, `monthly`); Default `0 9 * * *` |
| **Handler** | Nur System-Handler: einen registrierten Handler über **Handler wählen…** auswählen |
| **Agent-ID** | Nur Agent-Routinen: der Agent, der laufen soll |
| **Prompt** | Nur Agent-Routinen: was der Agent tun soll — es wird das Ziel des Laufs und seine Abfrage für den Speicherabruf |
| **Aufwand** | Optional, nur Agent-Routinen. Dieselbe **Aufwand**-Auswahl wie bei Gesprächen; sie erscheint, sobald **Agent-ID** die Id eines vorhandenen, aktivierten Agenten enthält, und listet nur die Stufen, die das Modell dieses Agenten anbietet. **Automatisch** (Default) zeigt, was ein Lauf nutzen wird — den eigenen Aufwand des Agenten, z. B. *Automatisch · Niedrig (Kollege)*, sonst den Modellstandard, z. B. *Automatisch · Modellstandard (Mittel)*. Eine gewählte Stufe gilt für jeden Lauf des Jobs, angepasst an die nächstgelegene Stufe, die das Modell anbietet |
| **Erstellen** / **Abbrechen** | Job speichern / Formular schließen |

<h2 id="job-kinds">Job-Typen</h2>

| Typ | Bedeutung |
|-----|-----------|
| **System-Handler** | Eingebauter Wartungs-/Automatisierungs-Handler |
| **Agent-Routine** | Führt einen Agenten mit einem Prompt nach Zeitplan aus |

<h2 id="row-actions">Job-Zeilen und Detailbereich</h2>

| Bedienelement | Bedeutung |
|---------------|-----------|
| **Pausiert / Läuft** | Aktivierungszustand des Jobs |
| **Nicht-lauffähig-Badge** | In der Zeile als **Kein Handler**, **Startet nie** oder **Nicht eingeplant** — kein Handler registriert (sein Modul ist wahrscheinlich deaktiviert), ein Trigger-Typ, der nie von selbst auslöst (Ereignis), oder ein Zeitplan, der nicht scharf geschaltet werden konnte (ungültiger Cron oder Intervall unter einer Sekunde). Für den Grund mit der Maus darüberfahren. |
| **Zuletzt: … / Nächste: …** | Letzter und nächster Auslösezeitpunkt |
| **N Läufe / N Fehler** | Zähler |
| **Agent:** &lt;Name&gt; | Der Agent, den eine Agent-Routine ausführt |
| **Jetzt ausführen** | Sofort auslösen; nur deaktiviert, wenn der Job keinen registrierten Handler hat oder deaktiviert/Dead-Letter ist, mit dem Grund im Tooltip. Ein Job mit dem Badge **Startet nie** oder **Nicht eingeplant** lässt sich so trotzdem ausführen — für einen Ereignis-Job ist das der einzige Weg |
| **Pause / Fortsetzen** | Umschalten |
| **Löschen** | Job + Historie entfernen (nach *Diesen Job und die Historie löschen?*) |
| **Neu planen** + **Anwenden** (Detailbereich) | Ein neuer Cron-Ausdruck oder eine Kurzform, oder eine ganze Zahl Millisekunden für ein Intervall; ein ungültiger Zeitplan wird abgelehnt und der Grund erscheint unter dem Feld |
| **Aufwand** (Detailbereich) | Nur Agent-Routinen. Eine Änderung wird sofort gespeichert; schlägt das Speichern fehl, erscheint *Speichern fehlgeschlagen* und nichts ändert sich |
| **Suchen…** | Liste filtern |
| **Alle Quellen** / **Alle Status** | Liste auf eine Quelle oder einen Status einschränken |
| **Infrastruktur-Jobs anzeigen** | Interne Infrastruktur-Jobs einbeziehen |
| **Nur die nicht lauffähigen Jobs anzeigen** | Filter der Health-Leiste; **Alle Jobs erneut anzeigen** stellt deine vorherigen Filter wieder her |

<h2 id="recent-executions">Letzte Ausführungen</h2>

**Letzte Ausführungen** im Detailbereich des Jobs listet vergangene Läufe — Startzeit, Dauer und wer sie ausgelöst hat (*Ausgelöst von:* `system`, wenn ein Timer auslöste, ein Agent oder eine Benutzer-Id), bei einer Agent-Routine außerdem einen Link **Unterhaltung öffnen** zum Gespräch des Laufs (auch für fehlgeschlagene Läufe). Leer: *Noch keine Ausführungen.*

<h2 id="health">Health-Leiste</h2>

| Kennzahl | Bedeutung |
|----------|-----------|
| **Leader / Follower** | Cluster-Führung (mehrere Instanzen) |
| **N aktiv** | Aktive Jobs |
| **N läuft** | Gerade in Ausführung |
| **N Fehler (24h)** | Fehlschläge am letzten Tag |
| **N Dead-Letter** | Erschöpfte Wiederholungen |
| **N überfällig** | Verpasster Zeitplan |
| **N nicht lauffähig** | Jobs, die so, wie sie konfiguriert sind, nicht laufen |

<h2 id="legend">Legende (Zeitleiste)</h2>

vergangen · läuft · nächste · zukünftig · Läufe · fällig

## Verwandt

- [CLI / Konfiguration](/docs/de/deploy/configuration/)
- [Agenten](/docs/de/agents/overview/)
- [Autonomie](/docs/de/agents/autonomy/)
- [Anbieter — Reasoning-Effort](/docs/de/ai/providers/#reasoning-effort)
- [Backup](/docs/de/admin/backup/)
- [Startseite](/docs/de/daily/home/)
