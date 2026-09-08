---
title: Die erste Stunde
description: Geführte erste Stunde in der laufenden UI — Start, ein Gespräch, eine Board-Karte und wo der Speicher lebt.
---

**Wozu das gut ist.** Installation und [Setup-Assistent](/docs/de/setup-wizard/) sind fertig. Diese Stunde führt dich durch das laufende Produkt: wo Arbeit beginnt, wo du sie verfolgst, und wie Fakten haften. Keine Feldliste.

## Wann du es nutzt

- Du kannst dich anmelden und die Haupt-App ist offen
- Du willst ein nützliches Gespräch, keine Tour durch jeden Bildschirm
- Du willst sehen, wie **Start**, **Board**, **Speicher** und **Agenten** zusammenpassen

## Anmelden und auf Start landen

Öffne die UI (Standard **http://localhost:3100**). Gib **Benutzername** und **Passwort** des Root-Owners aus dem Assistenten ein und klicke **Anmelden**.

Du landest auf **Start** (`/`). Jeder beginnt mit demselben Fabrik-Raster, bis du es anpasst.

Sieh dir zuerst drei Kacheln an:

- **Puls** — braucht dich, läuft, wartend, Kosten heute, fehlgeschlagene Jobs
- **Braucht Aufmerksamkeit** — Freigaben, feststeckende Arbeit, wartende Agenten, überfällige Punkte; du kannst von der Kachel aus handeln
- **Laufende Agenten** — Live-Aktivität; **Pausieren**, **Fortsetzen** oder **Stoppen**

Über dem Raster kann ein Empfehlungsstreifen für optionales Setup stehen. Ignoriere ihn in dieser Stunde.

## Starte ein Gespräch

Klicke in der Seitenleiste auf **Neue Unterhaltung**. Der Leerzustand sagt **Starte eine Unterhaltung…**.

Schreib eine Anfrage, die dir wirklich nützt — wie mit dir gearbeitet werden soll, eine Entscheidung, oder eine Aufgabe, die du verfolgen willst. Composer: **Nachricht eingeben… (Shift+Enter für neue Zeile)**. Senden.

Beobachte den Stream: **Denkt nach** oder **Denkt nach…**, dann **Antwort wird verfasst…** oder **Werkzeuge laufen…**. Tool-Zeilen zeigen Id, kurze Args und Ergebnis — Datei-Edits als **Diff**. **Stopp** bricht den Lauf ab. Das Karten-Icon im Composer ist **Zuerst planen**.

Lass den Thread offen. Als Nächstes kommt er aufs Board.

## Aufs Board legen

Öffne **Board** in der Seitenleiste (`/board`). Gespräche sind Karten. Deins ist oft schon da, mit dem Titel des Threads (oder **Ohne Titel**).

- Hefte es an, damit es auf dem Pin-Streifen bleibt (**Angeheftet**).
- Oder klicke **Neu**, tippe einen **Titel der Unterhaltung…**, und lege eine Karte an, die mit einem Thread verknüpft ist.

Du hast jetzt einen Ort zum Reden und einen Ort, um dieselbe Arbeit zu verfolgen.

## Wo der Speicher lebt

Öffne **Speicher** (`/memory`). Beginne mit **Übersicht**, dann **Vault-Dateien**.

Seit 0.8.16-beta kann eine dauerhafte Tatsache, die du in einem Gespräch nennst, eine Vault-Notiz werden — **ohne dass du danach fragst**. Capture ist global und standardmäßig an. Es läuft, nachdem die Antwort zugestellt ist — nie im kritischen Pfad der Antwort. Kurze Turns und Smalltalk erzeugen meist nichts; das ist richtig.

In der ersten Minute siehst du vielleicht keine neue Datei. Komm nach einem längeren, faktenreichen Austausch zu **Vault-Dateien** zurück, oder schreib eine Notiz von Hand. Agenten können Speicher weiterhin bewusst speichern.

## Deine primären Agenten

Öffne **Agenten** (`/agents`). Filter **Primär**. Das sind die zwei Teamkollegen, die du im Assistenten benannt hast: **Personal Assistant** (Alltag) und **System Engineer** (EYAS selbst). Sie bleiben; Gespräche kommen und gehen.

In dieser Stunde musst du keine weiteren Agenten anlegen.

## Was als Nächstes

- [Gespräche](/docs/de/daily/conversations/) — Composer, Rails, Effort, Orchestrierung
- [Board](/docs/de/daily/board/) — Karten, Stages, Ansichten
- [Agenten-Übersicht](/docs/de/agents/overview/) — Tiers, Typen, Liste
- [Speicher](/docs/de/knowledge/memory/) — fünf Stufen und Vault-Notizen
- [Skills](/docs/de/automation/skills/) — wiederverwendbare Verfahren, die Agenten laden können
- [Werkzeuge](/docs/de/automation/tools/) — Live-Katalog; suche `browser_` für Headless-Playwright
- [Browser Use](/docs/de/automation/browser-use/) — öffentlich vs eingeloggtes Chrome vs Hände
- [Grundkonzepte](/docs/de/concepts/) — das mentale Modell, sobald du dich umgeklickt hast
