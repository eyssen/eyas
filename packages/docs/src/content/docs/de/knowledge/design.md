---
title: "Design-Canvas"
description: "Canvas mit mehreren Zeichenflächen — von Hand, direkt auf dem Canvas oder per KI bearbeitet und von Ihren Agenten genutzt."
---

**Route:** `/design`.

Ein Design ist eine Menge von Zeichenflächen auf einem schwenk- und zoombaren
Canvas. Jede Zeichenfläche ist eine `.dc.html`-Datei; `canvas.json` hält fest, wo
sie liegt, zu welcher Seite sie gehört und in welcher Ansicht ein frisches Öffnen
landet. Bilder liegen im Canvas unter ihrem eigenen Dateinamen.

Das Dateiformat ist das von Claude Design: ein dort erstelltes Canvas lässt sich
hier importieren und rendern, ein hier exportiertes dort wieder aufsetzen. EYAS
rendert es mit einer eigenen Laufzeit — die beiden Werkzeuge teilen ein
Dateiformat, keinen Code.

## Ein Design anlegen

Auf `/design` einen Namen eintippen und **Neu** drücken. Sie erhalten eine
Startfläche zum Ersetzen.

**Import** nimmt das vollständige HTML einer veröffentlichten Design-Canvas-Seite
an. Eine Seite, deren Inhalt im Speicher der Hosting-Plattform statt in der Seite
selbst liegt, wird abgelehnt: die eingebettete Kopie ist nur ein veralteter
Erstöffnungs-Schnappschuss, und der Import gäbe Ihnen stillschweigend eine alte
Fassung.

Auch ein Agent kann eines anlegen. Alles, was ein Agent erzeugt, durchläuft
dieselben Prüfungen wie Ihre eigenen Änderungen.

## Bewegen auf dem Canvas

Ziehen Sie den Hintergrund. Das Rad schwenkt, **Umschalt**+Rad seitwärts,
**Strg/⌘**+Rad zoomt — der Zoom bleibt am Zeiger verankert, was unter dem Cursor
liegt, bleibt dort. **Fit** rahmt alles auf der Seite.

Geschwenkt wird im Raum *um* die Zeichenflächen, nicht auf ihnen. Eine
Zeichenfläche ist ein isolierter Rahmen und behält ihre eigenen Mausereignisse —
genau das lässt einen interaktiven Prototyp funktionieren.

Hat ein Canvas mehrere Seiten, erscheinen die Seitenschalter in der Kopfzeile.

## Eine Zeichenfläche öffnen

Neben jedem Namen steht ein Öffnen-Symbol — oder doppelklicken Sie den Namen. Die
Zeichenfläche füllt die Ansicht allein, **Esc** bringt Sie zurück.

Wie sie sich öffnet, ist ihre eigene Eigenschaft: standardmäßig wird das Ganze
eingepasst; eine auf Füllen gestellte Fläche wird in natürlicher Größe auf die
Ansichtsbreite gebracht und scrollt — was ein Entwurf mit fließender Breite
braucht.

## Drei Wege zu bearbeiten

**Auf dem Canvas.** **Bearbeiten** öffnen und ein Element anklicken. Das
Eigenschaftenfeld ändert Typografie, Farbe, Box, Rahmen und Layout; ein Raster mit
lauter gleichen Spalten wird als schlichte Spaltenzahl bearbeitet. Text ist an Ort
und Stelle änderbar, außer er stammt aus der Logik der Zeichenfläche — dann sagt
das Feld es, statt die Bindung zu überschreiben.

Cmd/Strg+Z macht rückgängig, mit Umschalt wieder her, und nichts wird gespeichert
bis Sie speichern: eine Version pro Speicherung, nicht pro Tastendruck.

Eine als interaktiv markierte Fläche behält ihre eigenen Bedienelemente und wird
stattdessen im Quelltext-Feld bearbeitet — das Auswählen würde die Klicks
schlucken, die ihr Prototyp braucht.

**Im Quelltext.** Das Quelltext-Feld listet jede Datei des Canvas und bearbeitet
sie direkt.

**Per KI.** Das KI-Feld öffnen, die Änderung beschreiben, anwenden.

Was immer dabei herauskommt und woher es auch kam: vor dem Speichern wird es gegen
die Canvas-Regeln geprüft. Eine Zeichenfläche ohne Wurzelelement, ein Layout-Eintrag
auf eine nicht vorhandene Datei, ein Bildverweis ohne Inhalt dahinter oder ein
Style-Attribut mit einer Bedingung außerhalb der Klammern — all das wird abgelehnt,
und die vorige Version bleibt exakt wie sie war. Scheitert der erste Versuch des
Modells, zeigt EYAS ihm die konkreten Probleme und fragt genau einmal nach.

Das funktioniert mit jedem konfigurierten Anbieter gleich. EYAS übergibt die
Aufgabe nicht dem Werkzeug eines Herstellers, nur weil dieser gerade konfiguriert
ist; Prompt, Prüfungen und gespeichertes Ergebnis sind in beiden Fällen identisch.

Eine KI-Bearbeitung kann auf einem CLI-Anbieter und einem großen Canvas mehrere
Minuten dauern. Das Panel zählt die verstrichene Zeit mit, und die Seite zu
verlassen bricht nichts ab. Jeder Versuch wird festgehalten, sodass das Panel
den letzten auch nachträglich meldet — angewendet, fehlgeschlagen mit dem Grund,
oder durch einen Server-Neustart unterbrochen — selbst wenn die Seite neu
geladen wurde oder die Verbindung mittendrin abriss. Solange eine Bearbeitung
läuft, lässt sich auf demselben Canvas keine zweite starten.

## Feineinstellungen

Die Chips stammen aus den selbst deklarierten Optionen der Zeichenfläche. Eine
Änderung rendert sofort neu; das Anheften schreibt den Wert als neue Vorgabe der
Zeichenfläche zurück.

## Versionen

Jede Änderung ist eine Version — mit wem, was, und ob sie von einem Menschen,
einem Import oder der KI stammt. Das Wiederherstellen einer älteren Version
kopiert sie als neue nach vorn, es geht also nie etwas verloren.

## Zeichenflächen so benennen, dass sie gefunden werden

Ihre Agenten lesen kein ganzes Canvas — siehe den nächsten Abschnitt. Sie lesen
einen Index, der jede Fläche nach ihrer Rolle einordnet, und eine gut benannte
Fläche finden sie. Das Vokabular:

| Rolle | Was hineingehört |
|---|---|
| **tokens** | Palette, Abstände, Radien — die Werte, auf die sich alles andere bezieht |
| **typography** | Größenskala, Schnitte, Schriften |
| **components** | Schaltflächen, Eingaben, Badges: die Teile, in ihren Zuständen |
| **patterns** | Diese Teile zusammengesetzt: Karten, Listen, Werkzeugleisten |
| **page** | Ein ganzer Bildschirm oder eine gedruckte Seite |

Die Rolle wird aus dem Titel in `canvas.json` gelesen, dann aus dem Dateinamen.
Ein Design mit *Tokens*, *Typografie* und *Komponenten* lässt sich navigieren;
fünf Flächen namens *Frame 1* bis *Frame 5* muss man aufs Geratewohl öffnen. Von
der KI erzeugte Designs sind bereits so benannt.

Ein Designsystem-Canvas sollte mindestens eine tokens- und eine
typography-Zeichenfläche tragen.

## Ein Design anhängen

**An ein Gespräch.** Das **Designs**-Symbol in der Kopfzeile hängt ein Canvas an.
Die Zahl am Symbol zeigt, wie viele im Spiel sind; das Menü listet alle Designs,
die angehängten mit Haken. Agenten können selbst an- und abhängen.

**An ein Projekt.** Unter **Projekte → bearbeiten**. Ein im Projekt angelegtes
Gespräch startet mit dessen Designs und besitzt sie von da an — sie dort
abzuhängen betrifft nur dieses Gespräch. Am Projekt gesetzt, bekommen neue
Gespräche sie; nicht gesetzt, dann nicht. Spätere Änderungen am Projekt erreichen
bestehende Gespräche nicht.

Das ist dasselbe Verhalten wie bei Codequellen und Arbeitsordnern des Projekts.

## Was ein Agent von einem angehängten Design sieht

Nicht das Canvas — das wären Zehntausende Zeichen pro Runde. Und auch nicht
seine Werte: eine **Anmeldung**. Das Design meldet, dass es angehängt ist, und
welche ART von Daten jeder seiner Teile enthält — Tokens (Farben, Abstände,
Radien), Typografie, Bauteile, Muster. Für das fünfteilige, 46 KB große
Odoo-Design sind das **652 Zeichen**, und es bleibt bei dieser Größe.

Der Agent holt dann nur, was er braucht: `design_read` mit `part` liefert die
abgeleiteten Werte eines Teils, `design_read` mit `file` das vollständige Markup
einer Zeichenfläche.

**Warum nicht einfach die Palette mitschicken?** Sie war eine Weile drin. Der
Block wird in **jeder Runde** bezahlt, ein Abruf **einmal**. Ab zwei Runden ist
der Abruf billiger, und nur seine Kosten wachsen nicht mit dem Canvas — deshalb
wird auch ein kleines Design angemeldet statt eingebettet.

Der Block weist den Agenten außerdem an, dem Design zu folgen, statt nur zu
vermerken, dass eines angehängt ist.

## Exportieren und Drucken

Das Exportmenü bietet zweierlei.

**Dateien** liefert das Canvas selbst: eine eigenständige HTML-Seite für jeden
Browser oder ein portables Canvas-Dokument, aus dem ein anderes Werkzeug neu
aufsetzen kann.

**Druck** rendert den Entwurf durch einen echten Browser: PNG der gewählten
Zeichenfläche in normaler oder doppelter Auflösung, PDF dieser Fläche oder ein
PDF des gesamten Canvas.

Wie eine Fläche druckt, ist ihre eigene Eigenschaft. Eine **feste** Fläche — die
Voreinstellung, und das, was ein Plakat, ein Flyer oder eine Broschürenseite ist —
kommt als genau eine Seite in genau ihrer Canvas-Größe heraus. Eine **fließende**
Fläche — ein Memo, ein Bericht — wird auf A4 oder Letter umbrochen, je nach
Auswahl; eine Spalte breiter als die Seite wird verkleinert, eine schmalere bleibt
bei ihrer Entwurfsbreite, statt vergrößert zu werden.

Ein Canvas-PDF setzt jede Fläche auf eine eigene Seite, in der Lesereihenfolge:
Seite für Seite, dann von oben nach unten, dann von links nach rechts. Die Seiten
behalten ihre Größen, sodass eine Broschüre aus unterschiedlich großen Flächen
korrekt exportiert wird, statt auf ein Papierformat gezwungen zu werden.

Drucken setzt einen neben EYAS installierten Browser voraus. Fehlt er, sind die
Druckeinträge deaktiviert und das Menü nennt, was zu installieren ist. Alles unter
**Dateien** funktioniert in beiden Fällen.

## Umbenennen und löschen

Auf den Titel in der Kopfzeile klicken, tippen, Eingabe. Esc bricht ab.

Das Papierkorb-Symbol rechts in der Kopfzeile löscht das ganze Design. Es fragt
vorher nach, und die Frage benennt, was mitgeht: jede gespeicherte Version und
jede Unterhaltung oder jedes Projekt, an dem das Design hängt. Es gibt kein
Rückgängig und keinen Papierkorb, aus dem es zurückzuholen wäre.
