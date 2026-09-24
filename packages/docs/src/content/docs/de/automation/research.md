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

**Welches Modell die Arbeit macht.** Query-Expansion, Quellenbewertung, das Schreiben der Abschnitte und die Gegenprüfung laufen auf EYAS' Hintergrundmodell: zuerst die **Standard**-Routing-Stufe, dann das Default-Modell, dann API-Anbieter, dann CLIs, die isolierte Aufrufe können — nie der Anbieter, den das Gateway gerade wählt. Jeder Aufruf ist ein isolierter One-Shot (keine Werkzeuge, kein Anbieter- oder Host-Speicher, ein Zug), erscheint im Tracing und zählt gegen das Budget. Siehe [Routing & Budget — Das Hintergrundmodell](/docs/de/ai/routing-budget/#background-model).

**Web-Inhalt ist Daten, keine Anweisung.** Suchtitel, Snippets, URLs, Seitenauszüge und die daraus vom Modell geschriebenen Abschnitte gehen an das Modell in einem abgegrenzten Block mit eigener Zufallsmarke pro Aufruf. Das Modell erfährt, dass Inhalt darin Daten sind, nie Anweisungen — eine feindliche Seite kann den Block also weder schließen noch Befehle geben.

**Berichte ohne Modell.** Ein Bericht wird auch fertig, wenn kein Hintergrundmodell ihn schreiben kann: kein Anbieter kann isolierte Hintergrundaufrufe (etwa eine reine Grok- oder Kimi-Installation, bevor deren Isolation verifiziert ist), das Budget ist gestoppt, oder der Modellaufruf scheiterte bzw. lieferte eine unbrauchbare Antwort. Dann wird nur das ursprüngliche Thema gesucht; Quellen werden nach Suchreihenfolge gereiht (die obersten bleiben); der Rumpf hat einen Abschnitt pro Top-Quelle mit Titel, Snippet und URL; es gibt keine Gegenprüfung; und ohne verfügbares Modell werden keine Seiten heruntergeladen. Ein solcher Bericht zeigt über den Abschnitten ein Banner: *Ohne Modell zusammengestellt: Kein Hintergrundmodell konnte diesen Bericht zusammenfassen (keines kann isolierte Hintergrundaufrufe ausführen, das Budget ist gestoppt oder der Aufruf ist fehlgeschlagen), daher werden die wichtigsten Quellen mit ihren Auszügen aufgelistet.* Das Agent-Tool `research` liefert für solche Berichte `degraded: true`. Vorher beendete ein Modellfehler den Job als **Fehler**. Bestehende Berichte bleiben unverändert.

**Oberflächlich** expandiert weniger verwandte Queries und behält weniger Treffer; **Tiefgehend** expandiert mehr, holt mehr Ergebnisse pro Query und behält mehr Quellen mit Relevanz mindestens 0,5.

Suche nutzt Brave, wenn das Secret `brave-search-api-key` existiert; sonst einen Mock (gut für UI-Checks, nicht fürs echte Web). Den Schlüssel unter [Geheimnisse](/docs/de/admin/secrets/) ablegen.

Ein fertiger Bericht zeigt die Query als Titel, **Fertig**, Tiefe (*oberflächlich* / *tiefgehend*), Quellenanzahl und Abschlusszeit. Der Rumpf sind modellgeschriebene **Abschnitte** (Titel + Text). **Quellen** listet `[n]` Titel (Link) und **N % relevant**.

Fehlgeschlagene Jobs — bei Fehlern außerhalb des Modells, etwa der Suche selbst — zeigen **Recherche fehlgeschlagen** und den Fehlerstring. Auf dieser Seite gibt es kein Löschen und keinen Export.

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
| **Fehler** | Workflow fehlgeschlagen (ein Modellfehler beendet den Job nicht mehr so — der Bericht wird stattdessen ohne Modell fertig) |

<h2 id="report">Berichtsbereich</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Recherche läuft…** | Platzhalter mit aktuellem Status-Badge |
| **Recherche fehlgeschlagen** | Fehlertitel; Rumpf ist der Fehlertext |
| Tiefe / Quellenanzahl / abgeschlossen | Kopf-Meta eines fertigen Berichts |
| Abschnittstitel + Inhalt | Generierte Briefing-Blöcke |
| Banner *Ohne Modell zusammengestellt: …* | Der Bericht entstand ohne Hintergrundmodell — ein Abschnitt pro Top-Quelle, keine Gegenprüfung |
| **Quellen** | Nummerierte Links mit **N % relevant** |

## Verwandt

- [Gedächtnis](/docs/de/knowledge/memory/)
- [Dokumente](/docs/de/knowledge/documents/)
- [Suche](/docs/de/daily/search/)
- [Geheimnisse](/docs/de/admin/secrets/)
- [Einstellungen-Übersicht](/docs/de/admin/settings/)
