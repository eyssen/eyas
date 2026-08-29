---
title: Gespräche
description: Mit Agenten sprechen — Arbeit senden, Designs anhängen, Orchestrierung steuern.
---

**Wozu das da ist.** Ein Gespräch ist der Ort, an dem du mit einem Agenten sprichst. Nachrichten im Hauptbereich; Projekt, Stage, Quellen, Dateien und Runtime in der rechten Leiste. Derselbe Thread ist eine Board-Karte — Chat und Pipeline sind ein Datensatz.

## Wann du es brauchst

- Ein Agent soll eine Aufgabe erledigen, und du willst Antwort, Tool-Aufrufe und Fortschritt an einem Ort.
- Du musst festlegen, welchen indexierten Codebaum (Odoo-Version, Addons) dieser Thread durchsuchen darf.
- Ein Skill-Vorschlag wartet — annehmen, nur für diesen Thread ablehnen oder global abschalten.
- Mehrere Modelle sollen dieselbe Aufgabe wettrennen (**God Mode**), oder ein Team von Spezialisten soll aufteilen.
- Ein Design-Canvas soll mit jeder Runde mitreisen, oder der **Prompt Enhancer** soll den Entwurf vor dem Senden formen.

## Typischer Ablauf

1. Klicke **Neue Unterhaltung** in der Sidebar (**Haupt**), oder öffne eine Karte vom **Board** / von Start **Letzte Unterhaltungen**. Route `/conversations/:id`.
2. Setze **Project**, **Stage** und **Agent** vor der ersten Nachricht (der Agent sperrt danach). Pinne **Sources**, wenn mehrere Odoo-Bäume indexiert sind.
3. Tippe im Composer. Nutze den **Prompt Enhancer**, wenn der Entwurf Form braucht; hänge Dateien oder **Designs** in der Top-Leiste an.
4. Erscheint eine Skill-Karte, wähle **Verwenden**, **Diesmal nicht** oder **Abschalten**. Senden. Die Antwort sollte streamen; die dünne Kontextleiste zeigt, was wirklich in diese Runde ging.

## Funktionen

**Einstieg:** Sidebar **Neue Unterhaltung** oder Board/Recent.

## Status

Idle · Working… · Waiting · Waiting approval · Archived.

## Header

| Steuerung | Bedeutung |
|-----------|-----------|
| **Provider… / Model…** | Thread-Override |
| **Auto-routing** | Router wählt |

Der dünne Streifen über dem Header ist klickbar: Er öffnet die **Kontext-Zusammenstellung** für die aktuelle Runde — jeden Abschnitt, der in den Prompt dieser Runde eingeflossen ist, in der Reihenfolge des Zusammenbaus, mit Größe, Kürzungsstatus und Rohinhalt. Das gilt pro Runde, nicht kumulativ für die ganze Unterhaltung. Auch die Zahl auf dem Streifen hat ihre Bedeutung geändert: Sie zeigt jetzt, wie viel Kontext für diese Runde tatsächlich zusammengestellt wurde, statt der kumulierten Summe aus Ein- und Ausgabe-Tokens der ganzen Unterhaltung — was die Auslastung überzeichnete und bei langen Unterhaltungen bei 100 % stehen blieb. Wenn Sie sich daran erinnern, ist die kleinere Zahl heute die Korrektur, kein Fehler.

## Priority

Low · Normal · High · Urgent.

## Gesprächsfelder

| Feld | Bedeutung |
|------|-----------|
| **Project / Stage** | Projektbindung |
| **Agent** | Nach 1. Nachricht **gesperrt** |
| **Effort** | Off / Low / Medium / High / Max |
| **Orchestration** | **Solo** = keine Sub-Agenten · **Auto** · **Deep** = aggressiver Fan-out. Letzter Eintrag: **God-Modus** — siehe [God-Modus](#god-modus). |

## Stream

Thinking / Composing · **Stop** · Background working · Tool Input/Output/Error · Progress Turn N/Max, Tokens, Cancel · Complexity Simple/Managed/Autonomous/Wizard · Voice INTERNAL/EXTERNAL/AUTO (+ Force).

## Composer

Nachricht (`Shift+Enter` = Zeile) · Attach · **Prompt Enhancer**.

### Prompt Enhancer

Iterativer Coach, der den Prompt an die **Modellfamilie** des Threads anpasst (Claude, OpenAI, Gemini, Grok, Kimi, …).

| Steuerung | Bedeutung |
|-----------|-----------|
| Draft / Ziel | Prompt-Entwurf oder Zielbeschreibung |
| **Optimized for …** | Ziel-Modellfamilie |
| Task-Typ-Chips | **General · Coding · Research · Analysis · Writing · Agentic · Files / vision** |
| **Quality N/10** | Score; **Gaps** = fehlende Checklist-Punkte |
| **Propose two alternatives** | Concise / Thorough / Recommended |
| **Suggested final prompt** · **carry N files** · **Apply** | Einfügen in den Composer |

Für **dauerhafte** Projekt-/Agent-Systemprompts: [Prompt Coach](/docs/de/ai/prompts/).

## Context rail (Chatter)

Tabs rechts: **Verlauf · Quellen · Als Nächstes · Dateien**

| Bereich | Inhalt |
|---------|--------|
| **Verlauf** | Notizen, Filter All/Notes/Changes |
| **Quellen** | Multi-Checkbox der Search Sources (Odoo-Versionen etc.). Projekt-Defaults werden bei neuer Conversation / Projektwechsel übernommen. Details: [Suche](/docs/de/daily/search/) |
| **Als Nächstes** | Activities |
| **Dateien** | Anhänge |
| **Runtime** | Ausführungs-Meta (separat von Verlauf) |

**Projekt-Feld:** Wechsel setzt die Standard-Codequellen des neuen Projekts (sofern kein expliziter `searchContext` mitgeschickt wird).

## Team

Sub-conversations · Team Dashboard · Team proposal · Run tree.

## God-Modus

Der God-Modus lässt **dieselbe Aufgabe** parallel von mehreren Modellen laufen und vergleicht die Ergebnisse. Kein vierter Orchestrationsstil: Solo / Auto / Deep bleiben die Zerlegung; God-Modus bedeutet nur, dass mehrere Modelle konkurrieren (kein Spezialisten-Team). Kombination möglich: God-Modus + Deep heißt, jedes konkurrierende Modell darf intern weiter aufteilen.

Es gibt **keinen automatischen Merge**. Ein Workspace gewinnt; einzigartige Ideen der anderen werden aufgelistet, du wendest sie an.

| Thema | Bedeutung |
|-------|-----------|
| **Kader** | **Einstellungen → God-Modus** (Karte unter Model assignments). 2–5 lebende Anbieter/Modell-Paare. Gerade Anzahl braucht einen Stichentscheid-Vorsitz. |
| **Menü** | Letzter Eintrag der **Orchestration**-Steuerung (nach Trenner): Solo, Auto, Deep, dann **God-Modus**. Einschalten lässt Solo/Auto/Deep **unverändert** (Worker erben diesen Stil). Solo/Auto/Deep schaltet den God-Modus aus. |
| **Kosten** | Der erste Versand nach dem Einschalten fragt nach Bestätigung (Kader, Schätzung, Obergrenze). Spätere Sends nur Banner. Liegt die Schätzung über der Obergrenze, ist Senden gesperrt, bis du die Grenze hebst oder den God-Modus ausschaltest. |
| **Ordner** | Worker laufen in isolierten Kopien der Arbeitsordner (wenn möglich Git-Worktree). Ohne Ordner startet der Lauf trotzdem, ohne Datei-Isolation. |
| **Gewinner + Insights** | Nur die geänderten Dateien des Gewinners landen auf den Conversation-Ordnern. Einzigartige Insights der anderen stehen im Tab **God** — du wendest sie an, nichts wird automatisch gemerged. |

### Kader in den Einstellungen

Auf [Einstellungen](/docs/de/admin/settings/), unter Model assignments, ist die Karte **God-Modus** der globale Kader für jede God-Modus-Conversation.

| Feld | Bedeutung |
|------|-----------|
| **Modelle** | 2–5 lebende Anbieter/Modell-Paare. Duplikate sind unzulässig. |
| **Stichentscheid-Vorsitz** | Eines dieser Modelle. **Pflicht bei gerader Anzahl**; immer empfohlen (ein ausgefallener Worker kann eine gerade Restzahl hinterlassen). Der Vorsitz ist Mitbewerber, kein extra Richter. |
| **Kostenobergrenze (USD)** | Optional. Liegt die Vorabschätzung darüber, startet der Lauf nicht. Wird die Grenze während des Laufs überschritten, werden unfertige Worker abgebrochen und unter den Fertigen entschieden. |
| **Worker-Ordner behalten (Stunden)** | Isolierte Bäume werden nach so vielen Stunden gelöscht (Standard 72). |

Speichern ändert keine schon gestarteten Läufe: jeder Send speichert einen Snapshot.

Die Provider/Modell-Leiste der Conversation wird beim God-Modus-Send ignoriert — der Einstellungs-Kader läuft.

### God-Modus einschalten

1. **Orchestration**-Menü der Conversation öffnen und **God-Modus** wählen.
2. Nachricht senden. Der erste Versand fragt nach Kostenbestätigung (wer läuft, geschätzte USD, Obergrenze). Bestätigen.
3. Solange an, bleibt ein **God-Modus**-Banner. Rechts erscheint der Tab **God**.
4. **Stop** bricht den ganzen Lauf ab, nicht nur einen Worker.

### Isolation und Gewinner

Jeder Worker bekommt einen eigenen Ordner (Git-Worktree, wenn das Arbeitsverzeichnis ein Repo ist; sonst Kopie). Während der Arbeit sehen sie die Dateien der anderen nicht.

Nach der Wahl werden **nur die geänderten Dateien des Gewinners** auf die Conversation-Ordner kopiert. Die Dateien der anderen bleiben in ihren Bäumen bis zur Aufbewahrungsfrist. Ohne Arbeitsordner gibt es nichts zu übernehmen; der Gewinner wird trotzdem aus den geschriebenen Antworten gewählt.

### Der God-Tab

Der Tab **God** im Chatter-Rail erscheint, solange der God-Modus an ist, **oder** sobald die Conversation mindestens einen God-Modus-Lauf hatte (er bleibt, wenn du später ausschaltest).

#### Kopfzeile

Aktuelle Phase plus Token, USD und Dauer insgesamt.

| Phase | Bedeutung |
|-------|-----------|
| **Vorbereitung** | Kader-Snapshot, isolierte Ordner |
| **Rennen** | Worker führen dieselbe Nutzer-Nachricht parallel aus |
| **Bewertung** | Fertige bewerten einander und stimmen |
| **Entscheidung** | Gewinner festgehalten |
| **Übernahme** | Gewinner-Dateien auf die Conversation-Ordner |
| **Fertig / Fehlgeschlagen / Abgebrochen** | Endzustand |

Ein fehlgeschlagener Worker zeigt auch den Anbieterfehler (z. B. überlastete API).

#### Schritte

Zeitgestempeltes Protokoll:

| Schritt | Bedeutung |
|---------|-----------|
| Lauf gestartet | Rennen aus dem aktuellen Kader |
| Worker parallel gestartet | Jedes lebende Modell beginnt dieselbe Aufgabe |
| *Modell* fertig / fehlgeschlagen | Eigener Versuch dieses Workers beendet |
| Gegenbewertung | Fertige lesen einander und stimmen |
| Sieger: *Modell* | Entscheidung festgehalten |
| Sieger-Arbeitsbereich übernommen | Dateien auf die Conversation-Ordner |
| Lauf abgeschlossen / fehlgeschlagen / abgebrochen | Endzustand |

Ältere Läufe ohne dieses Protokoll zeigen eine aus den Endzeiten rekonstruierte Zeitleiste.

#### Wie der Sieger gewählt wurde

Dieser Block nennt die Regel, die Stimmenzahlen und **wer für wen stimmte**.

| Regel | Wann |
|-------|------|
| **Mehrheit** | Ein Modell hat mehr gültige Stimmen als jedes andere. Ein Modell **darf nicht für sich selbst stimmen**; Selbststimmen fallen weg. |
| **Gleichstand — der Vorsitz wählte** | Zwei oder mehr Modelle gleichauf, und der Vorsitz ist unter den Gleichauf. |
| **Gleichstand — früher fertig** | Gleichstand, und der Vorsitz fehlt oder ist nicht unter den Gleichauf. Unter den Gleichauf gewinnt, wer zuerst fertig war. |
| **Nur einer fertig** | Alle anderen Worker fehlgeschlagen oder abgebrochen; der Überlebende gewinnt, ohne Gegenbewertungs-Abstimmung. |

Scheitert ein Review-Aufruf, hat dieser Worker einfach keine Stimme. Die Entscheidung läuft mit den abgegebenen Stimmen weiter.

#### Was sie über die anderen sagten

Nach dem Rennen machen die Fertigen **eine** strukturierte Gegenbewertung (keine Live-Debatte). Pro Bewerter, ohne Extra-Klick:

- für wen sie stimmten
- Punkte 1–5: **Qualität**, **Vollständigkeit**, **Risiko**
- schriftlicher Kommentar zur Arbeit der anderen
- einzigartige Insights, die die anderen ihrer Meinung nach verpasst haben
- gemeldete Risiken

Die Modellkarte aufklappen zeigt die **eigene** Arbeit dieses Modells (vor dem Review) und eventuelle Fehler.

#### Einzigartige Insights

Eine entduplizierte Liste von Insights der **Nicht-Gewinner**, die nicht schon in der Gewinner-Liste stehen. Wenn du sie im übernommenen Workspace willst, überträgst du sie selbst — nichts wird automatisch gemerged.

### Unter-Conversations

Jeder Worker ist eine Kind-Conversation mit Titel wie `God <Modell>`. Sie können in der Liste als Unter-Conversations erscheinen. God-Modus ist dort **aus**, damit sie kein weiteres Rennen starten.

Globaler Vergleich (Gewinnrate je Modell, durchschnittliches Kostenvielfaches gegenüber einem Einzelmodell): [Observability](/docs/de/admin/observability/). Klick auf einen Lauf öffnet den God-Tab der Conversation.

## Skill-Vorschläge

Ein passender Skill ist ein **Vorschlag, auf den die Runde wartet** — nichts davon läuft, bis du antwortest. Die Karte zeigt Name, passendes Muster und Score.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Eine Fähigkeit passt — verwenden?** | Überschrift |
| **Verwenden** | Für dieses Gespräch annehmen; die Runde läuft mit dem Skill weiter |
| **Diesmal nicht** | Nur für dieses Gespräch ablehnen |
| **Abschalten** | Ablehnen **und** den Skill global deaktivieren (nur Owner/Admin). Unter [Fähigkeiten](/docs/de/automation/skills/) wieder einschaltbar |

Deine Antwort gilt für dieses Gespräch. Wer sprechen, aber Skills nicht verwalten darf, sieht **Verwenden** und **Diesmal nicht**.

## Angehängte Designs

Das Formen-Icon in der Top-Leiste ist **Designs**. Angehängte Canvas reisen mit jeder Runde (der Agent holt Teile mit `design_read`). Projekt-Designs werden auf ein neues Gespräch kopiert, das du in dem Projekt anlegst; danach besitzt das Gespräch die Links.

| Steuerung | Bedeutung |
|-----------|-----------|
| **Angehängte Designs** | Liste aller Canvas, Haken bei den hier verknüpften |
| Zähler | Wie viele angehängt sind |
| **Design öffnen** | Sprung nach `/design` |
| **Noch keine Entwürfe.** | Leere Liste — zuerst ein Canvas anlegen |

## Verwandt

[Suche — Multi-Version-Pin](/docs/de/daily/search/) · [Projekte](/docs/de/daily/projects/) · [Agenten](/docs/de/agents/overview/) · [Board](/docs/de/daily/board/) · [Speicher](/docs/de/knowledge/memory/) · [Design-Canvas](/docs/de/knowledge/design/) · [Fähigkeiten](/docs/de/automation/skills/) · [Observability — God-Mode-Tab](/docs/de/admin/observability/)
