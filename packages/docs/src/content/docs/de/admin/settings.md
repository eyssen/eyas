---
title: Einstellungen-Übersicht
description: System-Zentrale — Darstellung, Sprache, Karten, Links.
---

**Wozu das da ist.** Die Seite **System** (`/settings`) ist die Zentrale der Einstellungen: Kennzahlen, Systeminformationen, Darstellung und Sprache, Modellzuweisungen, die God-Modus-Besetzung und die Gruppen der Seitenleiste, die jede weitere Admin-Oberfläche öffnen. [Benachrichtigungen](/docs/de/admin/notifications/), [Erweiterungen](/docs/de/admin/extensions/), [Remote-Knoten](/docs/de/admin/nodes/) und [Hände](/docs/de/admin/hands/) sind eigene Seiten, verlinkt aus der Seitenleiste — sie liegen nicht hier.

**Route:** `/settings` (Seitenleiste **System**).

## Kennzahlen

**Provider** (aktiv / gesamt) · **Modelle** (aktiviert / gesamt) · **Secrets** (verschlüsselt) · **Benutzer** (registriert).

## Anbieter-Übersicht

Die Liste der Anbieter mit Aktiv-Anzeige und der Zahl aktivierter / aller Modelle. Die Anbieternamen sind dieselben Produktnamen wie auf der Anbieter-Seite (dort die vollständige Konfiguration).

## Systeminformationen

| Feld | Bedeutung |
|------|-----------|
| **Version** | EYAS-Version |
| **Status** | Zustand |
| **Laufzeitumgebung** | Bun |
| **Datenbank** | SQLite (WAL) |

## Karten auf dieser Seite

| Karte | Zweck |
|-------|-------|
| **Updates** | Updates von GitHub suchen und einspielen |
| **Datenportabilität** | Import-Assistent ([Datenimport & -export](/docs/de/admin/data-port/)) |
| **Darstellung** | **Design** (hell/dunkel), **Sprache** (en / hu / de / es / fr / tlh) und **Vorlage** |
| **Modellzuweisungen** | Auswahl pro Agent, jeweils als *Anbieter / Modell* angezeigt und gespeichert, sodass eine Modell-ID, die zwei Anbieter führen, nie mehrdeutig ist. Siehe [Routing & Budget — Modellzuweisungen](/docs/de/ai/routing-budget/#model-assignments). Der Schritt KI-Modelle des Setup-Assistenten folgt denselben Regeln |
| **God-Modus** | Besetzung aus 2–5 Modellen, die an derselben Aufgabe um die Wette laufen, plus Vorsitz, Kostenobergrenze und Aufbewahrung der Arbeitsordner. Siehe [Gespräche — God-Modus](/docs/de/daily/conversations/). |
| **Team-Agenten** | Auswahl der Spezialisten |
| **Autonomie & Selbstverbesserung** | Die Selbstverbesserungs-Schleifen im Hintergrund, alle standardmäßig aus — siehe [Autonomie](/docs/de/agents/autonomy/) |

## Gruppen der Seitenleiste

| Gruppe | Links |
|--------|-------|
| **Allgemein** | System, Benutzer, API-Schlüssel, Geheimnisse, [Verbindungen](/docs/de/admin/connections/) (`/connections`) |
| **KI & Modell** | Anbieter, Medien, Prompts, Speicher, MCP-Server |
| **Module** | Projekte, Dokumente, Suchquellen, [Benachrichtigungen](/docs/de/admin/notifications/) (`/notifications-settings`), Proaktiv, Selbstlernen, [Erweiterungen](/docs/de/admin/extensions/) (`/extensions`) |
| **Infrastruktur** | [Hände](/docs/de/admin/hands/) (`/hands`), [Ingress](/docs/de/admin/ingress/), [Knoten](/docs/de/admin/nodes/) (`/nodes`), Sicherung, Besprechungen |

## Siehe auch

- [Anbieter](/docs/de/ai/providers/)
- [Autonomie](/docs/de/agents/autonomy/)
- [Verbindungen](/docs/de/admin/connections/)
- [Benachrichtigungen](/docs/de/admin/notifications/)
- [Erweiterungen](/docs/de/admin/extensions/)
- [Remote-Knoten](/docs/de/admin/nodes/)
- [Hände](/docs/de/admin/hands/)
