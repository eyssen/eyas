---
title: Recherche
description: Oberflächliche oder tiefgehende Recherche starten, Status verfolgen, Bericht und Quellen lesen.
---

**Wozu das dient.** Recherche startet einen Websuche-Job aus einer Frage oder einem Thema, bewertet Quellen und schreibt einen strukturierten Bericht, den du später öffnest. Agenten können das Ergebnis wiederverwenden. Du nutzt das, wenn du ein Quellen-Briefing willst statt einer einzelnen Chat-Runde. Oberflächlich ist schneller; tiefgehend expandiert mehr Queries und behält mehr Quellen.

## Wann du es nutzt

- Du willst einen Bericht mit zitierten URLs, nicht nur eine Modellantwort.
- Du brauchst einen schnellen Lauf (**Oberflächlich (schneller)**) oder einen breiteren (**Tiefgehend (gründlich)**).
- Du willst einen Job durch **Ausstehend** → **Suche** → **Auswertung** → **Synthese** → **Fertig** verfolgen.
- Ein Job ist fehlgeschlagen und du brauchst den Fehlertext rechts.

## Typischer Ablauf

1. Öffne **Recherche** in der Seitenleiste (`/research`).
2. Unter **Neue Recherche** ein Thema eingeben (Platzhalter *Recherchethema eingeben…*).
3. **Oberflächlich (schneller)** oder **Tiefgehend (gründlich)** wählen.
4. **Recherchieren**. Der Job erscheint in der linken Liste und ist ausgewählt.
5. Warten, bis rechts **Recherche läuft…** und der aktuelle Status steht. Aktive Jobs aktualisieren etwa alle zwei Sekunden.
6. Bei **Fertig** Abschnitte und **Quellen** lesen. Klick auf den Quelltitel öffnet die URL.

Leere Liste: *Noch keine Rechercheberichte*. Nichts ausgewählt: *Wähle einen Bericht oder starte eine neue Recherche*.

## Funktionen

Jobs starten **Ausstehend**, dann **Suche** (Query-Expansion + Websuche), **Auswertung** (Relevanz), **Synthese** (Abschnitte + Gegenprüfung), dann **Fertig** oder **Fehler**.

**Oberflächlich** expandiert weniger verwandte Queries und behält weniger Treffer; **Tiefgehend** expandiert mehr, holt mehr Ergebnisse pro Query und behält mehr Quellen mit Relevanz mindestens 0,5.

Suche nutzt Brave, wenn das Secret `brave-search-api-key` existiert; sonst einen Mock (gut für UI-Checks, nicht fürs echte Web). Den Schlüssel unter [Geheimnisse](/docs/de/admin/secrets/) ablegen.

Ein fertiger Bericht zeigt die Query als Titel, **Fertig**, Tiefe (*oberflächlich* / *tiefgehend*), Quellenanzahl und Abschlusszeit. Der Rumpf sind modellgeschriebene **Abschnitte** (Titel + Text). **Quellen** listet `[n]` Titel (Link) und **N % relevant**.

Fehlgeschlagene Jobs zeigen **Recherche fehlgeschlagen** und den Fehlerstring. Auf dieser Seite gibt es kein Löschen und keinen Export.

## Felder und Steuerelemente

<h2 id="new-job">Neue Recherche</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Neue Recherche** | Formularüberschrift |
| Themenfeld | Platzhalter *Recherchethema eingeben…* |
| Tiefe | **Oberflächlich (schneller)** oder **Tiefgehend (gründlich)** |
| **Recherchieren** | Job starten (deaktiviert bei leerem Feld oder während des Sendens) |

<h2 id="statuses">Liste und Status</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| Linke Liste | Query, Status-Badge, Erstelldatum. Klick lädt den Bericht |
| **Ausstehend** | In der Warteschlange, sucht noch nicht |
| **Suche** | Query-Expansion und Websuche |
| **Auswertung** | Quellen bewerten und filtern |
| **Synthese** | Abschnitte schreiben und gegenprüfen |
| **Fertig** | Bericht bereit |
| **Fehler** | Workflow fehlgeschlagen |

<h2 id="report">Berichtsbereich</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Recherche läuft…** | Platzhalter mit aktuellem Status-Badge |
| **Recherche fehlgeschlagen** | Fehlertitel; Rumpf ist der Fehlertext |
| Tiefe / Quellenanzahl / abgeschlossen | Kopf-Meta eines fertigen Berichts |
| Abschnittstitel + Inhalt | Generierte Briefing-Blöcke |
| **Quellen** | Nummerierte Links mit **N % relevant** |

## Verwandt

- [Gedächtnis](/docs/de/knowledge/memory/)
- [Dokumente](/docs/de/knowledge/documents/)
- [Suche](/docs/de/daily/search/)
- [Geheimnisse](/docs/de/admin/secrets/)
- [Einstellungen-Übersicht](/docs/de/admin/settings/)
