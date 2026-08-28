---
title: Läufe & Mission Control
description: Historie und Live-Runs.
---

**/agent-runs** — Historie (Status, Tokens, Kosten, Gesprächslink).  
**/mission-control** — Live-Karten (Running, Waiting approval, Paused…).  
Im Gespräch: Progress, Run-Tree, Tools.

## Markenkonformität

Wenn ein Hintergrundlauf in einem Projekt mit Marke arbeitet und etwas
produziert, worauf eine Marke zutrifft — eine gerenderte Seite, einen
E-Mail-Entwurf, ein Dokument, ein Design-Canvas —, prüft eine Kontrolle das
Ergebnis gegen die Marke und gibt konkrete Abweichungen einmal an den Agenten
zurück. „Die Überschrift nutzt #ff0000; die Markenfarbe ist #1f4ed8" ist die Art
Hinweis, nicht „mach es hübscher".

Sie läuft erst, wenn die Vollständigkeitsprüfung bestanden ist. Ein Lauf, der
seine Arbeit nicht beendet hat, wird nicht auf seine Farben angesprochen.

Sie ist bewusst weich. Ein Lauf, der nicht geprüft werden konnte — kein Modell,
keine Marke, nichts Markenförmiges im Ergebnis —, scheitert nie daran: die Arbeit
ist getan, und eine Farbe ist es nicht wert, sie zurückzunehmen. **Hart**
durchgesetzt wird die Marke am Rahmen: E-Mail-Hülle, Benachrichtigungsvorlagen
und das Branded-HTML-Tool bauen ihre Chrome deterministisch aus der Marke.

Sie teilt sich mit der Vollständigkeitsprüfung eine Rückgabe pro Lauf-Linie.
Abschalten mit `agent.brandCriticEnabled: false`.
