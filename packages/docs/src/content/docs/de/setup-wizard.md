---
title: Setup-Assistent
description: Assistent beim ersten Start — jeder Schritt, jedes Feld und jedes Steuerelement erklärt.
---

**Wozu das da ist.** Nur beim ersten Start. Der Assistent legt das Master-Passwort, den Hauptinhaber, deine zwei primären Agenten und ein erstes Modell-Backend an, damit sich die Haupt-App öffnet. Danach änderst du diese Dinge unter **Einstellungen**, **Anbieter** und **Agenten** — rechne nicht damit, den Assistenten erneut auszuführen.

## Wann du es brauchst

- Der Browser hat dich nach `/setup` geschickt, weil die Einrichtung unvollständig ist
- Du hast einen optionalen Schritt übersprungen und willst die Feldliste
- Du stellst eine frische Instanz wieder her

Nicht für alltägliche Änderungen, sobald die App offen ist.

## Typischer Ablauf

Der Assistent läuft **einmal**, solange die Einrichtung unvollständig ist. Der Browser wird nach `/setup` umgeleitet, bis die Pflichtschritte fertig sind. Optionale Schritte kannst du überspringen und später in den Einstellungen nachholen.

Steuerelemente auf jedem Schritt:

| Element | Bedeutung |
|---------|-----------|
| **Sprache** | Sprache der Oberfläche (`en` / `hu` / `de` / `es` / `fr` / `tlh`). Wird in der Spracheinstellung des Browsers gespeichert. |
| **Darstellung** | Design-Vorlage (z. B. Halo, Nebula) + Hell/Dunkel-Schalter. |
| *Schritt N von M* | Fortschritt durch die offenen Schritte. |
| **Weiter / Einrichtung abschließen** | Aktuellen Schritt absenden und weitergehen. |

## Reihenfolge der Schritte (typisch)

| Reihenfolge | Schritt | Pflicht | Modul |
|------------:|---------|---------|-------|
| — | Darstellung / Sprache (Rahmen der Oberfläche) | — | frontend |
| 1 | **Master-Passwort** | Ja | secrets |
| 2 | **Hauptinhaber** | Ja | auth |
| 3 | Primäre Agenten (*Deine zwei ständigen KI-Teamkollegen*) | Ja | auth |
| 4 | **Team-Agenten** | Nein | auth |
| 5 | **KI-Anbieter** | Meist | model |
| 6 | **KI-Modelle** | Meist | model |

Die Schritte sind modular — Module registrieren ihre Schritte beim Start. Die Pflichtschritte müssen fertig sein, bevor sich die Haupt-App öffnet.

## Master-Passwort

**Zweck:** alle gespeicherten Geheimnisse (API-Schlüssel, Tokens) im Ruhezustand verschlüsseln.

| Feld | Pflicht | Beschreibung |
|------|---------|--------------|
| **Master-Passwort** | Ja | Passphrase für das Schlüsselmaterial der Geheimnis-Verschlüsselung. Wähle etwas Starkes; geht es verloren, musst du die Anbieterschlüssel neu eingeben. |
| **Passwort bestätigen** | Ja | Muss mit dem Master-Passwort übereinstimmen. |

Nach diesem Schritt landen in der Oberfläche eingegebene Geheimnisse im verschlüsselten Secrets-Speicher.

## Hauptinhaber

**Zweck:** den menschlichen Hauptadministrator anlegen (`role: owner`, `is_root_owner`).

| Feld | Pflicht | Beschreibung |
|------|---------|--------------|
| **Benutzername** | Ja | Anmeldename (Platzhalter: `admin`). Muss eindeutig sein. |
| **Passwort** | Ja | Kontopasswort (gehasht; nie im Klartext gespeichert). |
| **Anzeigename** | Nein | Freundlicher Name in der Oberfläche (leer = Benutzername). |

Der Assistent hält die Owner-Zugangsdaten für den Rest der Sitzung **im Speicher**, damit optionale Schritte, die einen angemeldeten Owner brauchen, ohne neue Anmeldung laufen können. Lädst du mitten im Assistenten neu und sind nur noch optionale Schritte offen, landest du eventuell bei **Anmelden** und dann wieder auf `/setup`.

## Primäre Agenten

**Zweck:** die zwei ständig verfügbaren **Kollegen** anlegen, mit denen du sprichst (Seitenleiste **Kollegen**, je ein Home-Thread). Auf dem Bildschirm: *Deine zwei ständigen KI-Teamkollegen*.

| Feld | Pflicht | Beschreibung |
|------|---------|--------------|
| **Persönlicher Assistent — dein täglicher KI-Teamkollege** | Ja | Anzeigename deines Alltags-Agenten (z. B. Jarvis). Stufe: primär, Typ: Assistent. An den Projekttyp **general** gebunden. |
| **Systemingenieur — hält EYAS selbst gesund** | Ja | Anzeigename des Agenten, der EYAS selbst pflegt (z. B. R2D2). Stufe: primär, Typ: Ingenieur. An den Projekttyp **eyas** gebunden. |

Für beide wird angelegt:

- eine Zeile in `agent_definitions` (Modell, Tools, Workspace-Pfad, …)
- ein Workspace-Baum unter `data/agents/<id>/` (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- ein verknüpfter **Agent-Benutzer**-Datensatz (`is_agent = 1`) für Berechtigungen und Adressierung

Später kannst du sie unter **Agenten** umbenennen und neu konfigurieren. Nach dem Assistenten öffnest du sie über die Liste **Kollegen** in der Seitenleiste. Der Assistent koordiniert und bearbeitet keinen Quellcode; der Ingenieur verantwortet Plattform und Code. Siehe [Teams und Delegation](/docs/de/agents/teams/).

## Team-Agenten (optional)

**Zweck:** zusätzliche **Kollegen** (Stufe Team) und **Spezialisten** (gemeinsamer Pool, den jeder Kollege starten kann) aktivieren. Primäre Agenten brauchen keine Vorschlagskarte, um einen aktivierten Spezialisten aufzurufen.

| Element | Beschreibung |
|---------|--------------|
| **Empfohlen** | Hervorgehobene Vorlagen für eine typische Installation. |
| **Spezialisten** | Vollständiger Katalog optionaler Agentenvorlagen. |
| **Alle auswählen / Auswahl aufheben** | Sammelauswahl. |
| *N ausgewählt* | Anzahl gewählter Vorlagen. |
| **Überspringen / Weiter** | Ohne Spezialisten abschließen oder die Auswahl übernehmen. |

Die Auswahl wird als Vorlagen-IDs gespeichert und in echte Agenten umgesetzt (mit demselben Workspace-Muster wie die primären). Später änderst du sie unter **Einstellungen → Agenten**.

## KI-Anbieter

**Zweck:** sicherstellen, dass mindestens ein Modell-Backend verfügbar ist.

### Host-CLIs (falls erkannt)

| Element | Beschreibung |
|---------|--------------|
| Badge (*Claude Code erkannt und konfiguriert* / *Grok CLI …* / *Kimi Code CLI …*) | Lokale CLI gefunden und nutzbar — **kein API-Schlüssel**. Bei Claude bedeutet *erkannt und konfiguriert*, dass die Claude-Code-Laufzeit startet **und angemeldet ist** (claude.ai-Anmeldung, `ANTHROPIC_API_KEY` oder eine Bedrock/Vertex-Einrichtung); dass `claude` nur im PATH liegt, reicht nicht. Siehe [Anbieter — Claude-Code-Laufzeit](/docs/de/ai/providers/#claude-code-runtime). |
| **Für EYAS anmelden** (Grok / Kimi) | Erscheint immer, wenn Grok CLI oder Kimi Code CLI erkannt wird. EYAS führt diese CLIs in einem eigenen Home aus und nutzt nicht ihre Anmeldung auf diesem Rechner; melde dich also hier einmal für EYAS an: **Mit Gerätecode anmelden** (beide) — öffne den Link auf einem beliebigen Gerät und bestätige den Code, auf dem Server ist kein Browser nötig — oder **Stattdessen API-Schlüssel verwenden** (Grok, ein xAI-API-Schlüssel). Siehe [Anbieter — Grok und Kimi für EYAS anmelden](/docs/de/ai/providers/#sign-in-grok-and-kimi-for-eyas). |
| **Primäre CLI** | Erscheint, wenn mehrere CLIs erkannt werden: welche der Standard für Agenten und Routing ist. Sie wird Standard-Anbieter und -Modell der Installation und beantwortet damit auch interne Aufrufe ohne Modellangabe, wenn keine Stufe Standard gesetzt ist — siehe [Routing & Budget](/docs/de/ai/routing-budget/#default-binding). |
| **Anderen Anbieter verwenden** | Wechsel zur Konfiguration einer Cloud-/lokalen API. |
| **Zurück zu erkannten CLIs** | Zurück zur CLI-Ansicht. |

### Manuelle / API-Anbieter

| Element | Beschreibung |
|---------|--------------|
| Anbieterliste | Bekannte Backends (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **Aktiv / Inaktiv** | Ob der Anbieter fürs Routing aktiviert ist. |
| **Konfigurieren / Schlüssel ändern** | Eingabe des API-Schlüssels öffnen. |
| API-Schlüssel-Feld (*API-Schlüssel eingeben…*) | Geheimnis; wird im verschlüsselten Secrets-Speicher abgelegt. |
| **Speichern** | Schlüssel speichern und Anbieter nutzbar machen. |
| **Erneut prüfen** | Einen lokalen Endpunkt erneut prüfen (z. B. die Ollama-URL). |
| **Weiter / Einrichtung abschließen** | Weitergehen, auch wenn keiner aktiv ist (du kannst es später unter Einstellungen → Anbieter nachholen) — siehe Hinweis auf dem Bildschirm. |

## KI-Modelle

**Zweck:** jedem Agenten ein konkretes Modell zuweisen, sobald ein Anbieter bereit ist.

| Element | Beschreibung |
|---------|--------------|
| Spalte **Agent** | Agentenname aus den vorigen Schritten. |
| Spalte **Modell** | Auswahlliste der Modelle der aktiven Anbieter, jeweils als *Anbieter / Modell* (am besten passendes vorausgewählt); **— keins —** lässt das Modell des Agenten, wie es ist. |
| **Anwenden** | Zuweisungen speichern. Jede wird als das gewählte Paar aus Anbieter und Modell gesendet und gespeichert, sodass eine Modell-ID, die zwei Anbieter führen, nie mehrdeutig ist; ein Paar, das nicht im Modellkatalog steht, wird übersprungen. |
| **Zu den Anbietern** | Zur vollständigen Anbieter-Seite springen, wenn nichts konfiguriert ist. |
| **Einrichtung abschließen** | Assistenten beenden und die Haupt-App öffnen. |

Wird kein Anbieter erkannt (*Kein KI-Anbieter erkannt*), richte nach dem Assistenten einen auf der Anbieter-Seite ein.

## Nach dem Assistenten

| Ziel | Warum |
|------|-------|
| [Deine erste Stunde](/docs/de/first-hour/) | Die Live-Oberfläche erkunden: Start, eine Unterhaltung, Board, Speicher |
| [Start](/docs/de/daily/home/) | Einrichtungsempfehlungen für die restliche optionale Arbeit |
| [Anbieter](/docs/de/ai/providers/) | Weitere Backends, Schlüssel, Modelle |
| [Agenten](/docs/de/agents/overview/) | Kollegen und Spezialisten prüfen |
| [Teams und Delegation](/docs/de/agents/teams/) | Wie Kollegen übergeben und Spezialisten starten |
| [Benutzer](/docs/de/admin/users/) | Menschliche Benutzer hinzufügen (bei mehreren Benutzern) |

## Sicherheitshinweise

- Das Master-Passwort schützt die **Geheimnisse**; es verschlüsselt die SQLite-Datei nicht von sich aus im Ruhezustand — schütze Host-Festplatte und Backups.
- Das Passwort des Hauptinhabers ist unabhängig vom Master-Passwort.
- Agenten-„Benutzer“ sind keine interaktiven Anmeldungen für Menschen; sie existieren für Identität und Zugriffsregeln.
