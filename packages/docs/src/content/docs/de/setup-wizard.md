---
title: Setup-Assistent
description: Erster Start — alle Schritte und Felder erklärt.
---

Der Assistent läuft **einmal**, solange Pflichtschritte offen sind. Browser → `/setup`. Optionale Schritte können übersprungen und später in den Einstellungen nachgeholt werden.

Chrome auf jedem Schritt:

| Steuerung | Bedeutung |
|-----------|-----------|
| **Sprache** | UI-Sprache (`en` / `hu` / `de` / `es`) |
| **Erscheinungsbild** | Theme-Vorlage + hell/dunkel |
| **Schritt N von M** | Fortschritt |
| **Weiter / Setup abschließen** | Schritt speichern und fortfahren |

## Typische Reihenfolge

| # | Schritt | Pflicht |
|---|---------|---------|
| 1 | **Master-Passwort** | Ja |
| 2 | **Root-Owner** | Ja |
| 3 | **Primäre Agenten** | Ja |
| 4 | **Team-Agenten** | Nein |
| 5 | **AI-Provider** | Meist |
| 6 | **AI-Modelle** | Meist |

## Master-Passwort

Verschlüsselt Secrets im Ruhezustand.

| Feld | Pflicht | Bedeutung |
|------|---------|-----------|
| **Master-Passwort** | Ja | Passphrase für die Secret-Verschlüsselung — stark wählen |
| **Passwort bestätigen** | Ja | Muss übereinstimmen |

## Root-Owner

Haupt-Admin (`role: owner`, `is_root_owner`).

| Feld | Pflicht | Bedeutung |
|------|---------|-----------|
| **Benutzername** | Ja | Login (z. B. `admin`), eindeutig |
| **Passwort** | Ja | Konto-Passwort (gehasht) |
| **Anzeigename** | Nein | UI-Name (Default = Benutzername) |

Owner-Credentials bleiben für optionale Schritte **im Speicher** der Wizard-Session. Nach Reload mit nur optionalen Schritten: Login, dann zurück zu `/setup`.

## Primäre Agenten

| Feld | Pflicht | Bedeutung |
|------|---------|-----------|
| **Personal Assistant** | Ja | Täglicher Agent (Tier primary, Typ assistant) → Projekttyp **general** |
| **System Engineer** | Ja | EYAS-Betrieb (Tier primary, Typ engineer) → Projekttyp **eyas** |

Pro Agent: DB-Zeile, Workspace `data/agents/<id>/`, Agent-User-Datensatz.

## Team-Agenten (optional)

| Steuerung | Bedeutung |
|-----------|-----------|
| **Empfohlen / Spezialisten** | Vorlagenkatalog |
| **Alle auswählen / Auswahl aufheben** | Bulk |
| **N ausgewählt** | Zähler |
| **Überspringen / Weiter** | Ohne Spezialisten oder mit Auswahl |

## AI-Provider

### Host-CLIs (falls erkannt)

| Steuerung | Bedeutung |
|-----------|-----------|
| Badge Claude/Grok/Kimi | Lokales CLI bereit — **kein API-Key** |
| **Primary CLI** | Default für Agenten und Routing |
| **Anderen Provider nutzen** | Cloud/lokale API |

### API-Provider

| Steuerung | Bedeutung |
|-----------|-----------|
| Providerliste | Anthropic, OpenAI, Gemini, xAI, Ollama, … |
| **Aktiv / Inaktiv** | Für Routing nutzbar |
| **Konfigurieren / Key ändern** | API-Key-Eingabe |
| **API-Key** | Verschlüsselt in Secrets |
| **Speichern / Erneut prüfen** | Persistenz / Endpoint-Check |
| **Weiter** | Auch ohne aktiven Provider möglich (Warnhinweis) |

## AI-Modelle

| Steuerung | Bedeutung |
|-----------|-----------|
| **Agent** | Name |
| **Modell** | Dropdown (Best-Fit vorausgewählt) |
| **Anwenden** | Speichern |
| **Zu Providers** | Wenn nichts konfiguriert |
| **Setup abschließen** | Haupt-App |

## Danach

[Dashboard](/docs/de/daily/dashboard/) · [Provider](/docs/de/ai/providers/) · [Agenten](/docs/de/agents/overview/)

## Sicherheit

Master-Passwort ≠ Owner-Passwort. Agent-User sind keine menschlichen Logins.
