---
title: A2A & externe Agenten
description: Agent-to-Agent-Protokoll — Agent Card, eingehende Tasks, optionale Peer-Föderation.
---

**Wozu das da ist.** A2A ist, wie eine andere Agent-Runtime diese EYAS entdeckt und ihr eine Aufgabe übergibt — kein Mensch auf Telegram, keine [Hand](/docs/de/admin/hands/). Agent Card: `/.well-known/agent-card.json`. Inbound `tasks/send` erzeugt ein Gespräch und läuft `executeAgent`. Peer-Föderation existiert als API; **kein** Kommunikations-Tab.

## Wann du es brauchst

- Ein A2A-Client soll diese Instanz entdecken und Tasks senden.
- EYAS hinter [Ingress](/docs/de/admin/ingress/) — Well-known-URL und Auth-Schema.
- Zwei EYAS-Instanzen föderieren (`/api/v1/federation/peers`).

## Typischer Ablauf

1. Trust-Boundary. Nur bei bewusster Netz-Exposition, hinter Auth/Ingress.
2. `GET /.well-known/agent-card.json` (Name, Version, Capabilities, Skills, `authentication.schemes` default `bearer`).
3. Peer sendet `tasks/send` — Gespräch + `executeAgent`, kein Instant-Fail wenn Agenten stehen.
4. Optional Peer: `POST /api/v1/federation/peers`. Inbound-Token einmal teilen; rotieren `POST …/rotate-inbound`. Adresse `peerId/agentId`.
5. Gespräche und A2A-Task-Mailbox.

**Kein Besitzer-Speicher für Peers.** Eine Aufgabe, die ein anderer Agent über A2A schickt, bekommt Datum und Uhrzeit, aber keinen abgerufenen Speicher des Besitzers — der Abrufblock, den jeder interne Lauf bekommt, wird zurückgehalten. Die Speicher-Werkzeuge (`memory_search` / `memory_expand`) sind unverändert und stehen weiter unter dem Security-Gate. Was ein Peer schickt, wird als *Peer*-Text gespeichert, nicht als deiner. Siehe [Speicher — Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model).

**Speichererfassung bei A2A-Aufgaben.** Eine A2A-Aufgabe führt jetzt auch EYAS' Erfassung dauerhafter Erinnerungen aus, unter denselben `memory.capture.*`-Einstellungen wie ein Chat-Zug. Die Aufgabe des Peers wird als Worte eines Dritten gelesen: Sie legt nie eine Notiz darüber an, wer du bist, oder eine Regel dafür, wie EYAS arbeiten soll, sondern nur Notizen der Art `reference`, `project` oder `domain`, gespeichert mit Peer-Vertrauen (`trust: peer`), und sie ergänzt nie eine deiner eigenen Notizen. Nur die eigenen Worte des Peers zählen für `minUserChars`. Siehe [Speicher — Capture ist standardmäßig an](/docs/de/knowledge/memory/#capture-is-on-by-default).

**Modell und Aufwand.** Eine A2A-Aufgabe läuft als Gespräch des gebundenen Agenten: Sie folgt dessen Modell und Aufwand; hat der Agent kein Modell, wird der Installations-Default mit der ersten Antwort am Gespräch festgelegt.

**Der Text des Peers wird eingerahmt.** Die Aufgabenbeschreibung erreicht das Modell wie Kanalnachrichten in einem Block für nicht vertrauenswürdige Eingaben (Quelle `a2a`), Steuer-Tags darin werden entschärft — ein Peer kann seine Aufgabe also nicht mit Text beginnen, der wie EYAS' eigener Datums- oder Erinnerungsblock aussieht.

Default-Skills auf der Karte: `research`, `code-review`. Der Kanalkatalog schließt MCP/A2A als Chat-Karten aus.

## Verwandt

- [Ingress](/docs/de/admin/ingress/)
- [Kanäle](/docs/de/communication/channels/)
- [Agenten](/docs/de/agents/overview/)
- [Werkzeuge](/docs/de/automation/tools/)
