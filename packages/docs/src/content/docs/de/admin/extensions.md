---
title: Erweiterungen
description: Drittanbieter-Skill-Pakete installieren, aktivieren und prüfen, ohne MIT-kompatible Lizenzen zu verlassen.
---

**Wozu das dient.** Erweiterungen ist der Katalog der Skill-Pakete und Tools, die aus Lizenzgründen nicht mit EYAS gebündelt werden konnten. EYAS selbst bleibt MIT. GPL, LGPL, AGPL und SSPL (und ähnliches Copyleft) liegen nicht im Produkt; du stimmst hier pro Paket nach dem Lizenzhinweis zu. So fügst du optionale Skills oder Begleittools hinzu, ohne verbotene Lizenzen in den Kernbaum zu mischen.

## Wann du es nutzt

- Du willst ein Skill-Paket, das nicht im gebündelten Katalog steht.
- Du brauchst ein Begleit-CLI oder einen Dienst (Dokumentkonvertierung, Antivirus, SAST), mit dem EYAS als separater Prozess spricht.
- Du musst vor der Installation prüfen, ob ein Paket MIT-kompatibel, Copyleft oder proprietär ist.
- Du willst ein Paket deaktivieren, ohne es zu deinstallieren, oder es ganz entfernen.

## Typischer Ablauf

1. Öffne in der Seitenleiste **Einstellungen** → Gruppe **Module** → **Erweiterungen** (`/extensions`).
2. Lies **Automatisch installierbare Pakete** und **Kompatible Drittanbieter-Tools**. Jede Karte zeigt Name, Lizenz-Badge, Version, Autor und Skill-Zahl.
3. Bei einem Auto-Paket **Installieren**. **Lizenzhinweis** lesen, dann **Akzeptieren & installieren** (oder **Abbrechen**).
4. Nach der Installation Power für **Aktivieren** / **Deaktivieren**, Papierkorb zum Deinstallieren.
5. Bei einem Drittanbieter-Paket **GitHub** öffnen, **Einrichtungsanleitung** folgen und selbst unter dessen Lizenz installieren. EYAS lädt es nicht für dich.

Du solltest ein Badge **Installiert** und die Kopfzeilen-Zahl der installierten Pakete sehen.

## Funktionen

Der Untertitel nennt die Regel: manche Tools und Skill-Pakete konnten nicht gebündelt werden; Auto-Pakete lädt EYAS mit deiner Zustimmung; Drittanbieter-Tools musst du von der Originalquelle unter deren Lizenz holen.

Lizenz-Badges:

| Klasse | Bedeutung |
|--------|-----------|
| MIT-kompatibel | MIT, Apache-2.0, BSD, ISC, Unlicense und ähnliche — grundsätzlich bündelbar |
| Copyleft | GPL, LGPL, AGPL, MPL, CC-BY-SA und ähnliche — nicht gebündelt; Installation ist opt-in. Copyleft-Pakete, die EYAS holen kann, laufen als **separater Prozess**, nicht in EYAS gelinkt |
| Proprietär | EYAS verteilt sie nicht; du lädst selbst |
| Unknown | Lizenzstring nicht klassifiziert |

**Automatisch installierbare Pakete** kommen als Archiv (SHA-256, falls veröffentlicht), landen unter dem Datenverzeichnis, mit der akzeptierten Lizenz. **Installieren** wird abgelehnt, solange du den Hinweis nicht akzeptierst. Manuelle Pakete sind nicht auto-installierbar.

Aktivierte Pakete speisen ihre Skill-Dateien in den [Skills](/docs/de/automation/skills/)-Katalog. Die Skill-Zahl auf der Karte ist die deklarierte Menge (bei den meisten Begleittools null). Deaktivieren stoppt das Laden; Deinstallieren löscht Verzeichnis und DB-Zeile.

Installiere kein Paket, dessen Lizenz du nicht einhalten kannst. Dass EYAS MIT bleibt, hebt die Paketbedingungen nicht auf.

## Felder und Steuerelemente

<h2 id="catalogue">Katalog</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| Installiert-Zähler | Kopfzeile: wie viele Pakete installiert sind |
| **Automatisch installierbare Pakete** | EYAS kann sie nach Zustimmung laden |
| **Kompatible Drittanbieter-Tools** | Du lädst von der Originalquelle |
| Name / Beschreibung / Version / **von** Autor | Paketidentität |
| Lizenz-Badge | SPDX, nach Kompatibilitätsklasse gefärbt |
| **Installiert** | Paket liegt auf der Platte |
| Skill-Zahl | Wie viele Skills das Paket deklariert |
| Tags | Filter-Chips, falls vorhanden |

<h2 id="install">Installieren, aktivieren, deaktivieren</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Installieren** | Zustimmung für ein Auto-Paket starten |
| **Lizenzhinweis** | Voller Text, den du akzeptieren musst |
| **Akzeptieren & installieren** | Lizenz akzeptiert, Download |
| **Abbrechen** | Hinweis schließen ohne Installation |
| **Wird installiert…** | Download läuft |
| Power | Installiertes Auto-Paket **Aktivieren** / **Deaktivieren** |
| Papierkorb | Installiertes Auto-Paket deinstallieren |
| **GitHub** | Upstream-Seite für ein manuelles Paket |
| **Einrichtungsanleitung** / **Details ausblenden** | Manual-Setup auf- oder zuklappen |

<h2 id="recordly">Recordly (AGPL-Begleiter)</h2>

Recordly ist ein Desktop-Screenrecorder (Zooms, Cursor, Webcam). **AGPL-3.0** — EYAS liefert und installiert es nicht. Die Karte steht unter **Drittanbieter-Tools**. App von GitHub holen, in Recordly **MP4/GIF** exportieren, Datei in [Dokumente](/docs/de/knowledge/documents/) hängen. Kein `recordly_*`-Agent-Tool. Weiter schneiden auf dieser Maschine: [Video Use](/docs/de/studio/videouse/). Das ist **keine** [Studio](/docs/de/studio/)-Engine.

## Verwandt

- [Einstellungen-Übersicht](/docs/de/admin/settings/)
- [Benachrichtigungen](/docs/de/admin/notifications/)
- [Remote-Knoten](/docs/de/admin/nodes/)
- [Hände](/docs/de/admin/hands/)
- [Skills](/docs/de/automation/skills/)
- [Werkzeuge](/docs/de/automation/tools/)
- [Studio](/docs/de/studio/)
- [Dokumente](/docs/de/knowledge/documents/)
