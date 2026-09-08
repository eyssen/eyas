---
title: Läufe & Mission Control
description: Live-Läufe überwachen — abbrechen, fortsetzen, wiederholen — und das Ops-Board im Blick behalten.
---

**Wozu das da ist.** **Agent-Läufe** ist die Tabelle der Ausführungen: live und fertig, mit Status, Prüfung, Runden, Tokens und Aktionen. Der **Leitstand** ist das Live-Kartenboard — wer läuft, auf dich wartet oder pausiert. Die Tabelle für Historie und Recovery; der Leitstand für den Blick auf jetzt.

## Wann du es brauchst

- Ein Lauf hängt, hat das Rundenlimit, oder ist fehlgeschlagen — **Fortsetzen** (Checkpoint) oder **Wiederholen** (vom Ziel).
- Etwas läuft und du brauchst Abbrechen, ohne das Gespräch zu öffnen.
- Ob der Critic **Ziel erreicht** / **Ziel nicht erreicht** gesetzt hat.
- Summen: läuft, wartet auf Freigabe, heute abgeschlossen, Kosten heute.
- Pause, Unterbrechen oder Gespräch öffnen von einer Live-Karte.

## Typischer Ablauf

1. Öffne **Agent-Läufe** in der Sidebar (**KI**) — Route `/agent-runs`. Oder **Leitstand** unter **Überwachung** — Route `/mission-control`.
2. Bei Agent-Läufen **Status** und **Prüfung**. Aktiv: abbrechen; **Fehlgeschlagen / Hängt / Abgebrochen / Rundenlimit**: **Fortsetzen** oder **Wiederholen**.
3. Am Leitstand die Summenleiste, dann auf der Karte **Pause / Fortsetzen / Unterbrechen / Gespräch öffnen**.
4. Zeile/Karte sollte live den Status ändern. Das Gespräch zeigt denselben Lauf (Progress, Run-Tree, Tools).

## Funktionen

**Route:** `/agent-runs`. Untertitel: *Live-Überwachung der Agent-Ausführungen — hängende Ausführungen werden erkannt und lassen sich abbrechen.* Leer: *Noch keine Agent-Ausführungen.* Spalten: Status, Prüfung, Agent, Art, Runden, Tokens, Letzter Fortschritt, Aktionen. Status: **Läuft · Hängt · Wird aktualisiert · Wartet auf Freigabe · Abgeschlossen · Rundenlimit · Fehlgeschlagen · Abgebrochen**. Prüfung: **Ziel erreicht · Ziel nicht erreicht · Ungeprüft**.

**Route:** `/mission-control` (**Leitstand**). Summen: Running, Waiting approval, Completed today, Cost today. Kartenaktionen: Pause, Resume, Interrupt, Open conversation.

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
