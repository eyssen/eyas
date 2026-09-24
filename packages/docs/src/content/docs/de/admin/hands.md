---
title: Hände
description: Kople eine lokale „Hand“, damit EYAS CLIs und Desktop-Automatisierung auf einer Maschine nutzen kann, die du kontrollierst.
---

**Wozu das dient.** Hände ist der Kopplungshub für EYAS-Hand-Clients — Maschinen, die du kontrollierst und die diesem Server CLI-Tools, OS-Automatisierung und/oder Computer-Use bereitstellen. Ein kurzlebiger Kopplungscode bindet das Gerät; verbundene Hands melden Plattform, Architektur, OS, Fähigkeiten und wie viele CLI-/App-Tools sie gefunden haben. Das ist kein Remote-SSH-Knoten und keine Observability.

## Wann du es nutzt

- Der Agent soll eine CLI- oder Desktop-Aktion auf *deinem* Mac, Windows oder Linux ausführen, nicht nur im Serverprozess.
- Du koppelst einen neuen Hand-Client und brauchst einen Code, der in fünf Minuten abläuft.
- Du willst sehen, ob eine Hand verbunden ist, was sie kann (**CLI**, **OS-Automatisierung**, **Computernutzung**) und wie viele Tools sie fand.
- Du willst ein Gerät trennen, dem du nicht mehr vertraust.

## Typischer Ablauf

1. Öffne in der Seitenleiste **Einstellungen** → Gruppe **Infrastruktur** → **Hände** (`/hands`).
2. **Kopplungscode generieren**. Ein großer **Kopplungscode** erscheint; er **läuft in 5 Minuten ab — gib diesen Code auf deinem Hand-Gerät ein**.
3. Code auf dem Hand-Client eingeben. Der Code verschwindet von dieser Seite, wenn er abläuft.
4. **Aktualisieren**, falls die neue Karte noch nicht sichtbar ist.
5. Plattform · Arch · OS, Fähigkeits-Badges und Tool-Zahl prüfen, dann behalten oder **Trennen**.

Leer: *Keine Hands verbunden* / *Generiere einen Kopplungscode und verbinde einen EYAS-Hand-Client*. Nach der Kopplung grüner Punkt und kurze Hand-ID.

## Funktionen

Kopplungscodes gelten **300 Sekunden** (fünf Minuten) und verschwinden dann. Fehler beim Generieren zeigen ein Fehlerbanner.

Jede verbundene Hand zeigt: Name, kurze ID, `platform · arch · osVersion`, **N Tools**, Protokollversion, relatives **Zuletzt gesehen**, Fähigkeits-Badges. Plattform-Icons: Darwin, Windows, Linux (sonst generisch).

Vom Client gemeldete Fähigkeiten:

| Badge | Bedeutung |
|-------|-----------|
| **CLI** | Kommandozeilen-Tools auf dieser Maschine |
| **OS-Automatisierung** | OS-Automatisierung |
| **Computernutzung** | Desktop / Computer-Use |

Gefundene Tools sind **cli** oder **app** (ID, Name, Pfad, optionale Version). Diese Seite zeigt die **Anzahl**, keine Tool-Liste.

**Trennen** deregistriert die Hand (und reißt einen MCP-Transport ab, falls so verbunden). **Aktualisieren** lädt die Liste neu.

## Felder und Steuerelemente

<h2 id="pairing">Kopplungscode</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Kopplungscode generieren** / **Wird generiert…** | Code für den aktuellen Benutzer |
| **Kopplungscode** | Großer Monospace-Code für die Hand |
| Läuft in *n* Minuten ab | TTL-Text; die Karte verschwindet nach Ablauf |
| **Aktualisieren** | Verbundene Hands neu laden |

<h2 id="connected-hands">Verbundene Hands</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| Name + kurze ID | Label und die ersten acht Zeichen von `handId` |
| platform · arch · osVersion | Maschinenidentität |
| **N Tools** | Wie viele CLI-/App-Tools die Hand gemeldet hat |
| Protokoll v*n* | Hand-Protokollversion |
| **Zuletzt gesehen** | Relative Zeit (*gerade eben*, *vor N Min.*, *vor N Std.*, *vor N T.*) |
| **CLI** / **OS-Automatisierung** / **Computernutzung** | Fähigkeits-Badges |
| Verbunden-Punkt | Grün, solange in der Liste |
| **Trennen** / **Wird getrennt…** | Diese Hand deregistrieren |

## Verwandt

- [Einstellungen-Übersicht](/docs/de/admin/settings/)
- [Remote-Knoten](/docs/de/admin/nodes/)
- [Benachrichtigungen](/docs/de/admin/notifications/)
- [Erweiterungen](/docs/de/admin/extensions/)
- [Werkzeuge](/docs/de/automation/tools/)
- [MCP-Server](/docs/de/ai/mcp/)
