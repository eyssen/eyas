---
title: Benachrichtigungen
description: Wer wird auf welchem Kanal wie laut informiert — In-App, E-Mail, Telegram, Webhook.
---

**Wozu das dient.** Unter Benachrichtigungseinstellungen entscheidest du, welche Ereignisse dich erreichen, auf welchem Kanal und in welcher Lautstärke. Jede Einstellung ist eine Zeile Ereignismuster × Kanal. So landen Budgetwarnungen, Agentenereignisse und Ähnliches in der Glocke, per E-Mail, Telegram oder Webhook — ohne dich mit Rauschen zu wecken. **Kritisch** umgeht immer Ruhezeiten und Bündelung.

## Wann du es nutzt

- Manche Ereignisse sollen in die In-App-Glocke, andere nach **Telegram** oder **E-Mail**.
- Du willst nur **Warnung** und höher, nicht jedes **Info**.
- Du willst ein Ruhefenster (auch über Nacht), außer für **Kritisch**.
- Du willst eine Zusammenfassung statt einer Flut von Mails oder Webhook-POSTs.
- Du brauchst einen signierten HTTPS-Webhook für Automatisierung (n8n, Zapier, Home Assistant und ähnliche).

## Typischer Ablauf

1. Öffne in der Seitenleiste **Einstellungen** → Gruppe **Module** → **Benachrichtigungen** (`/notifications-settings`).
2. Unter **Einstellung hinzufügen** ein **Ereignismuster** eingeben (z. B. `agent.*`, `budget.warning` oder `*`).
3. **Kanal**, **Mindest-Schweregrad** und **Zustellungsmodus** wählen.
4. Optional **Ruhig ab** und **Ruhig bis**. Über-Nacht-Bereiche wie 22:00–07:00 funktionieren.
5. **Hinzufügen**. Die Zeile erscheint unter **Aktive Einstellungen**.
6. Ist der Kanal **Webhook**, **Webhook-Endpunkt** ausfüllen und **Webhook speichern**.

Du solltest die neue Zeile mit Muster, Kanal, ≥ Schweregrad und optional **Zusammenfassung** / Ruhe-Badges sehen.

## Funktionen

Eine Zeile pro Ereignismuster × Kanal. Muster sind Segment-Globs: `*` trifft alles; `agent.*` ein Segment nach `agent`; `budget.warning` nur dieses Ereignis.

**Kanal:** **Web** (In-App / WebSocket), **E-Mail**, **Telegram**, **Webhook**. E-Mail und Telegram liefern nur, wenn die Integration wirklich konfiguriert ist (SMTP aus Secrets / gekoppelter Telegram-Bot). Die Kanalwahl hier legt die Integration nicht an.

**Sofort** sendet jetzt. **Gebündelt** stellt eine Zusammenfassung in die Warteschlange (E-Mail und Webhook; Standardfenster fünf Minuten). **Web** und **Telegram** überspringen die Bündelung. **Kritisch** geht immer sofort und ignoriert Ruhezeiten.

Ruhezeiten nutzen `HH:MM` und können über Mitternacht laufen.

Ein Webhook-POST ist JSON (`event`, `severity`, `title`, `body`, `data`, `createdAt`, `notificationId`). Optionales gemeinsames Geheimnis setzt `X-EYAS-Signature: sha256=…` (HMAC-SHA256). Zusätzliche HTTP-Header können am Endpunkt gespeichert werden (API); das Formular hat URL, Geheimnis und **Aktiviert**. Hinweis der Seite: nur https-URLs; Loopback- und Metadaten-Hosts (`169.254.169.254`, `.internal`) sind blockiert.

Fehlgeschlagene Sends gehen in die Wiederholungswarteschlange (drei Versuche, exponentielles Backoff ab 30 Sekunden). Danach **Fehlgeschlagen (Dead Letter)**. **Wiederholungswarteschlange** erscheint, wenn Retries aktiv sind.

Die Glocke in der Kopfzeile listet Benachrichtigungen und Gelesen-Markierung. Diese Seite sind nur die Einstellungen.

## Felder und Steuerelemente

<h2 id="preferences">Aktive Einstellungen</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Aktive Einstellungen** | Vorhandene Zeilen. Leer: *Noch keine Einstellungen. Füge unten eine hinzu.* |
| Ereignismuster-Badge | Getroffenes Glob, z. B. `agent.*` |
| Kanal-Badge | **Web** / **E-Mail** / **Telegram** / **Webhook** |
| ≥ Schweregrad | Mindestschwere dieser Zeile |
| **Zusammenfassung** | Wenn **Zustellungsmodus** **Gebündelt** ist |
| ruhig `ab`–`bis` | Ruhezeiten dieser Zeile |
| Papierkorb | Zeile Muster × Kanal löschen |

<h2 id="add-preference">Einstellung hinzufügen</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Ereignismuster** | Platzhalter: `agent.* oder budget.warning oder *` |
| **Kanal** | **Web**, **E-Mail**, **Telegram**, **Webhook** |
| **Mindest-Schweregrad** | **Info**, **Warnung**, **Fehler**, **Kritisch** |
| **Zustellungsmodus** | **Sofort** oder **Gebündelt** |
| **Ruhig ab** / **Ruhig bis** | Zeitfelder. Beide nötig, um Ruhezeiten zu speichern; leer = keine |
| **Hinzufügen** | Zeile speichern (deaktiviert bei leerem Muster) |

<h2 id="webhook">Webhook-Endpunkt</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **URL** | Ziel. Platzhalter `https://hooks.example.com/eyas` |
| **Gemeinsames Geheimnis (optional — aktiviert HMAC-SHA256-Signaturen)** | Passwortfeld. Wenn schon eines existiert: *(unverändert — leer lassen, um das bestehende zu behalten)* |
| **Aktiviert** | Ungehakt: Webhook gespeichert, aber ungenutzt |
| **Webhook speichern** | URL / Geheimnis / Aktiviert persistieren (deaktiviert ohne URL) |
| **Entfernen** | Gespeicherten Webhook löschen (nur wenn einer existiert) |

<h2 id="retry-queue">Wiederholungswarteschlange</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| **Ausstehend** | Noch geplante Retries |
| **Fehlgeschlagen (Dead Letter)** | Versuche erschöpft |
| **Aktualisieren** | Einstellungen, Webhook und Retry-Statistik neu laden |

## Verwandt

- [Einstellungen-Übersicht](/docs/de/admin/settings/)
- [Erweiterungen](/docs/de/admin/extensions/)
- [Remote-Knoten](/docs/de/admin/nodes/)
- [Hände](/docs/de/admin/hands/)
- [Kanäle](/docs/de/communication/channels/)
- [Telegram](/docs/de/communication/telegram/)
- [Geheimnisse](/docs/de/admin/secrets/)
