---
title: Grundkonzepte
description: Mentales Modell — Agenten, Gespräche, Board, Speicher, Skills, Tools, Kanäle.
---

Lies das einmal nach [Die erste Stunde](/docs/de/first-hour/). Komm zurück, wenn ein späteres Kapitel ein Wort verwendet, das du nicht erkennst. Das ist das mentale Modell, keine Bildschirm-für-Bildschirm-Anleitung.

EYAS ist ein **persönliches KI-Betriebssystem**: benannte Agenten, dauerhafter Speicher, Board, Automatisierung, Multi-Kanal — auf deiner Maschine.

## Bausteine

| Konzept | Bedeutung | UI |
|---------|-----------|-----|
| **Agent** | KI-Persona mit Modell, Tools, Skills, Stimme, Workspace, Kanälen | Agenten |
| **Primary** | Always-on aus dem Setup (Assistant + Engineer) | Agenten |
| **Team / Specialist** | Extra-Kapazität, oft Delegation | Agenten |
| **Gespräch** | Nachrichten-Thread mit Tools und Runs | Neue Unterhaltung |
| **Board-Karte** | Nachverfolgbare Arbeit | Board |
| **Projekt / Stage** | Delivery-Struktur | Projekte |
| **Skill / Tool** | Wissenspaket / aufrufbare Aktion | Fähigkeiten / Werkzeuge |
| **Speicher** | Working → episodic → vault → archive | Speicher |
| **Knowledge / Documents** | Wiki vs. Uploads | Wissen / Dokumente |
| **Kanal** | Externer Ein-/Ausgang (z. B. Telegram) | Kommunikation |
| **Provider** | LLM-Backend | Anbieter |
| **Prompt-Kette** | master → project-type → project → conversation | Prompts |
| **Security Gate / Forge** | Policy bzw. freigegebene Soul-Änderungen | Sicherheit / Forge |

## Typischer Ablauf

1. Setup (Owner, Primaries, Provider)
2. Gespräch oder Board-Karte
3. Agent: Tools/Skills, Memory, Delegation, Kanal
4. Ergebnis in Chat, Board, Dokumenten oder Outbound

## Agent vs Gespräch vs Karte

| | Agent | Gespräch | Board-Karte |
|--|-------|----------|-------------|
| Lebensdauer | Langlebige Config | Thread | Work-Tracking |
| Inhalt | Persona + Tools | Nachrichten | Aufgabenstatus |

## Speicher vs Wissen vs Dokumente

| Speicher | Wer schreibt | Wofür |
|----------|--------------|-------|
| **Speicher-Stufen** | System / Agenten bei der Arbeit | Automatischer Abruf, Episoden, Verfahren |
| **Vault-Markdown** | Import / Agenten / du / **Auto-Capture nach einem Gesprächs-Turn** (standardmäßig an seit 0.8.16-beta) | Langlebige semantische und prozedurale Notizen |
| **Wissensbasis** | Du (Editor) | Kuratiertes Wiki |
| **Dokumente** | Upload | PDFs, Office, Source-Dumps |

Eine dauerhafte Tatsache im Chat kann eine Vault-Notiz werden, ohne dass jemand danach fragt. Capture läuft nach der Zustellung der Antwort; ein fehlgeschlagenes Capture kostet eine Notiz, nie die Antwort. Details: [Speicher](/docs/de/knowledge/memory/).

## Orchestration (Gespräch)

| Steuerung | Bedeutung |
|-----------|-----------|
| **Effort** | Reasoning-Tiefe vs. Kosten |
| **Solo** | Keine Sub-Agenten |
| **Auto** | Modell entscheidet Fan-out |
| **Deep** | Aggressiver Multi-Agent-Fan-out |

## Weiter

- [Die erste Stunde](/docs/de/first-hour/)
- [Erste Schritte](/docs/de/getting-started/)
- [Agenten](/docs/de/agents/overview/)
- [Speicher](/docs/de/knowledge/memory/)
