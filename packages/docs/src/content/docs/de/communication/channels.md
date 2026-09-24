---
title: Kanäle — Überblick
description: Externe Messaging-Instanzen — Typen, Modi, Eingangswarteschlange, Kopplung. Nicht Verbindungen, nicht Hände.
---

**Wozu das da ist.** Über Kanäle schreiben Menschen außerhalb dieser Maschine einem EYAS-Agenten: Telegram, Slack, E-Mail und der Rest des Katalogs. Jede Instanz hat eigene Secrets und einen gebundenen Agenten. Das ist **nicht** [Verbindungen](/docs/de/admin/connections/) (Odoo, GitHub, MCP-Inventar) und **nicht** [Hände](/docs/de/admin/hands/) (ein lokales Gerät, das OS-/CLI-Werkzeuge anbietet). MCP und A2A sind Integrationen anderer Art und haben eigene Seiten.

**Route:** `/communication` → Tabs **Kanäle · Eingangswarteschlange · Kopplung**. Untertitel: *Messaging-Kanäle verbinden und dem Primary-Agenten zuweisen.*

## Wann du es brauchst

- Du willst von Telegram (oder einem anderen Katalogtyp) aus mit deinem Primary-Agenten sprechen, ohne die Web-UI zu öffnen.
- Du betreibst zwei Bots desselben Typs (Arbeit + privat) und brauchst eine zweite Instanz.
- Eingehende Nachrichten hängen, und du brauchst die dauerhafte Warteschlange (eine **tot**-Zeile erneut versuchen).
- Eine Telegram-DM wartet auf einen Kopplungscode.

## Typischer Ablauf

1. **Kommunikation** (`/communication`) im Tab **Kanäle** öffnen.
2. Eine Katalogkarte aufklappen oder **Instanz hinzufügen** für ein weiteres Konto desselben Typs.
3. Die Secrets einfügen, **Agent für eingehende Nachrichten** wählen, **Speichern & verbinden** drücken.
4. **Autonom** (unbeaufsichtigt, weiterhin von der Autonomie-Leiter geprüft) oder **Verwaltet** (Security-Gate bei jedem Tool-Aufruf) wählen.
5. Für Telegram-DMs: dem Bot schreiben, dann den Code unter **Kopplung** freigeben. Die **Eingangswarteschlange** beobachten, wenn Zustellungen scheitern.

## Funktionen

Du kannst **mehrere Konten desselben Typs** betreiben (z. B. zwei Telegram-Bots), jedes mit eigenen Zugangsdaten und eigenem Agenten. Nutze **Instanz hinzufügen** oder auf der Karte **… -Instanz hinzufügen**.

### Kanaltypen (Katalog) {#channel-types}

Das sind die Messaging-Typen, die EYAS anbietet. MCP / A2A sind **keine** Chat-Kanäle.

| Typ | Was du verbindest | Kopplung | Extra |
|-----|-------------------|----------|-------|
| **Telegram** | HTTP-API-Token von BotFather | Ja — unbekannte DMs | Erstklassig; siehe [Telegram](/docs/de/communication/telegram/) |
| **Discord** | Bot-Token der Anwendung | Nein | Braucht `discord.js` zur Laufzeit |
| **Slack** | Bot-Token (`xoxb-`) + App-Level-Token (`xapp-`) | Nein | Socket Mode — kein öffentlicher Webhook |
| **Email (SMTP/IMAP)** | SMTP (Pflicht) + optional IMAP | Nein | Jedes Postfach |
| **Gmail (API)** | OAuth-Client-ID/-Secret, Refresh-Token, Postfach | Nein | Gmail API |
| **Microsoft 365 (Graph)** | Tenant, Client-ID/-Secret, Postfach-UPN | Nein | Graph-App-Zugangsdaten |
| **WhatsApp Business** | Phone-Number-ID, Access-Token, Verify-Token, App-Secret | Nein | Webhook `/api/v1/webhooks/whatsapp` |
| **Signal** | Bot-Nummer (E.164) + URL der signal-cli-HTTP-Bridge | Nein | EYAS bettet Signal nicht ein |
| **Google Chat** | Projekt-/App-ID, optional Sende-Token und Standard-Space | Nein | Webhook `/api/v1/channels/googlechat/webhook` |
| **Microsoft Teams** | App-ID, App-Passwort, optional Tenant | Nein | Webhook `/api/v1/channels/teams/webhook` |

Jede Karte klappt **So richtest du es ein** mit nummerierten Schritten vor dem Formular für die Zugangsdaten auf. Webhook-Typen zeigen außerdem **Zu exposierende Webhook-Pfade**.

## Felder und Steuerelemente

### Instanz anlegen {#create-instance}

| Feld | Bedeutung |
|------|-----------|
| **Kanaltyp** | Vorlage aus dem Katalog |
| **Anzeigename** | z. B. Arbeit Signal, Privat Telegram |
| **Erstellen & verbinden** | Instanz anlegen und Verbindungsablauf starten |
| **Instanz löschen** | Instanz samt Zugangsdaten entfernen (mit Bestätigung) |

### Instanzstatus {#status}

| Status | Bedeutung |
|--------|-----------|
| **Verbunden** | Aktive Verbindung |
| **Getrennt** | Nicht verbunden |
| **Zugangsdaten gesetzt** | Secrets gespeichert, eventuell ist Verbinden nötig |
| **Nicht konfiguriert** | Secrets fehlen |
| **Fehler** | Letzter Fehler |
| Zustand **Konflikt / Authentifizierungsfehler / Eingeschränkt** | Betriebszustand |

### Modus {#mode}

| Modus | Bedeutung |
|-------|-----------|
| **Autonom** | Läuft unbeaufsichtigt; die Stufenautonomie-Leiter prüft weiterhin jede Aktion |
| **Verwaltet** | Das Security-Gate steuert jeden Tool-Aufruf |

Ein Klick wechselt den Modus (Tooltips erklären beide).

### Speicher in Kanal-Antworten {#memory-in-replies}

Eine Antwort in der **internen** Stimme des Besitzers bekommt denselben Abrufblock mit Datum und Uhrzeit wie ein Chat-Zug (siehe [Speicher — Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model)). Eine Antwort mit Stimm-Scope **Extern** — **Force External** am Gespräch oder ein temporärer Override — bekommt nur Datum und Uhrzeit: Kein abgerufener Besitzer-Speicher geht an einen externen Leser. Kann EYAS den Stimm-Scope einer Antwort nicht bestimmen, geht auch sie ohne abgerufenen Speicher raus. Die Speicher-Werkzeuge sind unverändert und stehen weiter unter dem Security-Gate.

Die **Tools**-Liste des gebundenen Agenten gilt für Kanal-Antworten wie auf jedem anderen Pfad, plus `memory_search` und `memory_expand` ([Konfigurieren — Tools](/docs/de/agents/configure/#tools--constraints)). Was Kanal-Absender schreiben, wird als *Peer*-Text gespeichert, nicht als deiner.

**Speichererfassung bei Kanal-Antworten.** Jede Kanal-Antwort führt jetzt auch EYAS' Erfassung dauerhafter Erinnerungen aus, unter denselben `memory.capture.*`-Einstellungen wie ein Chat-Zug. Die Nachricht des Absenders wird als Worte eines Dritten gelesen: Sie kann nie eine Notiz darüber anlegen, wer du bist, oder eine Regel dafür, wie EYAS arbeiten soll; sie kann nur Notizen der Art `reference`, `project` oder `domain` erzeugen, die `trust: peer` tragen und mit Peer-Vertrauen gespeichert werden, und eine solche Notiz ergänzt nie eine deiner eigenen Notizen. Die Längenprüfung zählt nur die Worte des Absenders, ein kurzes „ok“ kostet also keinen Modellaufruf, und ein Kanal-Gespräch teilt sich eine Obergrenze `maxPerConversation` über alle seine Nachrichten. Siehe [Speicher — Capture ist standardmäßig an](/docs/de/knowledge/memory/#capture-is-on-by-default).

**Modell und Effort.** Ein Kanal-Gespräch folgt dem Modell des gebundenen Agenten; hat der Agent keines, wird der Installations-Default mit der ersten Antwort am Gespräch festgelegt. Auch der eigene Reasoning-Effort des Agenten gilt. Jede Kanal-Antwort hält Anbieter und Modell fest, die geantwortet haben, und den Effort, mit dem sie lief.

### Abgelehnte Nachrichten (Datenschutz) {#refused-messages}

Ein Kanal gilt immer als entferntes Ziel. Eine eingehende Nachricht mit einem Wert, den die Datenschutzrichtlinie auf **Blockieren** setzt — standardmäßig IBAN, Kontonummer, Steuernummer, Personalausweisnummer, Kartennummer oder US-Sozialversicherungsnummer, plus jedes eigene Muster auf Blockieren —, wird abgelehnt, bevor irgendetwas gespeichert wird:

- Der Absender bekommt eine automatische Antwort in der Sprache, in der er geschrieben hat (Englisch, Ungarisch, Deutsch, Spanisch, Französisch oder Klingonisch; Englisch, wenn unklar). Sie nennt die Typen, nie die Werte, und bittet darum, die Nachricht ohne diese Werte erneut zu senden.
- Es entsteht kein Gespräch, keine Nachricht und kein Agentenlauf. In der **Eingangswarteschlange** zeigt das Ereignis den Status **übersprungen** mit dem Fehler `privacy_blocked`, und nur sein maskierter Text bleibt erhalten. Scheitert das Senden des Hinweises, wird das Ereignis wie jede Zustellung erneut versucht.
- Nachrichten, die vor einer Änderung der Richtlinie schon gespeichert waren, werden nachträglich nicht abgelehnt. E-Mail-Adressen und Telefonnummern (Klasse Maskieren) und Werte der Klasse Warnen werden nie abgelehnt.

Jede Ablehnung wird als `privacy.inbound_refused` auditiert (Typen und die ID des eingehenden Ereignisses, nie ein Wert). Siehe [Sicherheit & Datenschutz — Abgelehnte Nachrichten](/docs/de/admin/security-privacy/#refused-messages).

### Zugangsdaten & Agentenbindung {#credentials}

| Feld | Bedeutung |
|------|-----------|
| Secret-Felder | Je nach Kanal (siehe Karte bzw. Kapitel Telegram) |
| *Leer lassen, um den aktuellen Wert zu behalten* | Platzhalter beim Bearbeiten |
| Kennzeichen **gesetzt** | Secret ist schon gespeichert |
| **Agent für eingehende Nachrichten** | Welcher Agent antwortet; Standard ist der Primary-Assistent |
| **— keiner (Nachricht gespeichert, keine Auto-Antwort) —** | Nur speichern |
| **Gebundener Agent** | Aktuell gebundener Agent |
| **Speichern & verbinden** | Secrets speichern und verbinden |
| **Test / Verbinden / Trennen / Erneut verbinden / Konfigurieren** | Lebenszyklus-Aktionen |

### Tab Eingangswarteschlange {#inbound}

Dauerhafte At-least-once-Warteschlange für eingehende Kanalnachrichten. Fehlgeschlagene Zustellungen werden verzögert erneut versucht und landen schließlich im Dead-Letter; **tot**-Zeilen lassen sich erneut einreihen.

| Spalte | Bedeutung |
|--------|-----------|
| **Quelle** | Kanal-Instanz |
| **Absender** | Absender-ID / Name |
| **Nachricht** | Inhalt |
| **Versuche** | Zustellversuche |
| **Empfangen** | Alter (*vor Ns / vor N Min. / vor N Std.*) |

Die Spalte **Status** zeigt **ausstehend**, **zugestellt**, **tot** oder **übersprungen**; der Grund einer gescheiterten oder übersprungenen Zeile steht unter der Nachricht (etwa `privacy_blocked`, siehe [oben](#refused-messages)). **Erneut versuchen** an einer **tot**-Zeile reiht sie wieder ein; **Aktualisieren** lädt die Liste neu.

### Tab Kopplung {#pairing}

Unbekannte Absender bekommen einen Kopplungscode und warten hier. Eine Freigabe gibt dem Kanal Zugriff auf seinen gebundenen Agenten; Kopplungen überstehen Neustarts. Telegram ist der Katalogtyp mit **supportsPairing**.

| Steuerung | Bedeutung |
|-----------|-----------|
| Kennzeichen **Pairing** | Auf der Kanalkarte, wenn Kopplung nötig ist |
| **Freigeben / Ablehnen** | Entscheidung über eine offene Anfrage |
| Spalten | Quelle, Absender, Code, Angefragt |

Leer: *Keine ausstehenden Kopplungsanfragen.*

## Verwandt

- [Telegram](/docs/de/communication/telegram/)
- [A2A](/docs/de/communication/a2a/)
- [Agenten — Kanäle](/docs/de/agents/configure/)
- [Verbindungen](/docs/de/admin/connections/)
- [Hände](/docs/de/admin/hands/)
- [Ingress](/docs/de/admin/ingress/)
