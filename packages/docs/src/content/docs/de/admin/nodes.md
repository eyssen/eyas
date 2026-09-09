---
title: Remote-Knoten
description: Andere Maschinen, die EYAS erreicht (SSH, WebSocket, Tailscale), damit Agenten nicht nur auf dieser Box arbeiten.
---

**Wozu das dient.** Remote-Knoten ist das Inventar anderer Maschinen, die diese EYAS-Instanz erreichen kann. Du registrierst Name, Host und Verbindungstyp, damit Agenten Arbeit von dieser Box weg ausführen — typischerweise per SSH. Gesundheit ist **online**, **offline** oder **unknown**. Diese Seite ist das Register; sie ist keine Observability-Telemetrie und keine Hand (Desktop/CLI-Kopplung).

## Wann du es nutzt

- Ein Agent soll einen Befehl auf einem anderen Host ausführen, nicht nur auf dieser Instanz.
- Du fügst eine Maschine hinzu, die du per **SSH**, **WebSocket** oder **Tailscale** erreichst.
- Du willst sehen, wann ein Knoten zuletzt gesehen wurde, oder ihn umbenennen / umzielen / entfernen.
- Du brauchst ein bewachtes SSH-Invoke (destruktive Muster ohne Force blockiert) — das ist eine API auf SSH-Knoten, kein Button auf dieser Seite.

## Typischer Ablauf

1. Öffne in der Seitenleiste **Einstellungen** → Gruppe **Infrastruktur** → **Knoten** (`/nodes`).
2. **Knoten hinzufügen**.
3. **Name** (Platzhalter `my-node`), **Host** (Platzhalter `192.168.1.100:3100`) und **Typ** (**SSH**, **WebSocket** oder **Tailscale**).
4. **Speichern**. Die Karte erscheint mit Statuspunkt und Typ-Badge.
5. Stift bearbeitet Name, Host und Typ. Papierkorb entfernt den Knoten.

Leer: *Keine Remote-Knoten konfiguriert*. Nach dem Speichern Host in Monospace und, wenn bekannt, **Zuletzt gesehen**.

## Funktionen

Jede Karte zeigt **Name**, Statuspunkt, **Typ**-Badge, **Host** und **Zuletzt gesehen**, wenn ein Zeitstempel da ist.

Farben: **online** (grün), **offline** (rot), **unknown** (bernstein). Neue Knoten starten **offline**, bis etwas sie als gesehen markiert.

**Typ** im Dialog: **SSH**, **WebSocket** oder **Tailscale**. Der Dialog sammelt keine Capability-Liste; der Datensatz kann Capabilities für Agenten trotzdem speichern.

SSH-Knoten können über einen bewachten Executor aufgerufen werden (`POST` invoke). Muster wie `rm -f` / `rm -r`, `mkfs`, `dd if=` und Forkbombs werden verweigert, außer `forceDestructive` ist wahr. Nicht-SSH-Typen liefern für Invoke „nicht implementiert“. Zugangsdaten (Benutzername, Passwort oder privater Schlüssel) kommen aus dem Invoke-Body oder der gespeicherten Config — nie geloggt.

WebSocket und Tailscale sind auf dieser Seite Inventar + Gesundheit; sie bekommen hier keinen Invoke-Button.

## Felder und Steuerelemente

<h2 id="add-node">Knoten hinzufügen / bearbeiten</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Knoten hinzufügen** | Erstellungsdialog |
| Knotenzahl | Kopfzeilen-Badge, wenn mindestens ein Knoten existiert |
| **Name** | Menschenlesbares Label. Platzhalter `my-node` |
| **Host** | Adresse. Platzhalter `192.168.1.100:3100` |
| **Typ** | **SSH**, **WebSocket** oder **Tailscale** |
| **Speichern** / **Wird gespeichert…** | Persistieren (deaktiviert, bis Name und Host nicht leer sind) |
| Stift | **Knoten bearbeiten** — dieselben Felder |
| Papierkorb | Knoten löschen |

<h2 id="health">Gesundheit</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| Statuspunkt | **online** / **offline** / **unknown** |
| Typ-Badge | Verbindungstyp auf der Karte |
| **Zuletzt gesehen** | Zeitstempel, als das Register den Knoten zuletzt als gesehen markierte |

## Verwandt

- [Einstellungen-Übersicht](/docs/de/admin/settings/)
- [Hände](/docs/de/admin/hands/)
- [Benachrichtigungen](/docs/de/admin/notifications/)
- [Erweiterungen](/docs/de/admin/extensions/)
- [Ingress](/docs/de/admin/ingress/)
- [Observability & Ops](/docs/de/admin/observability/)
- [Geheimnisse](/docs/de/admin/secrets/)
