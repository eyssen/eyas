---
title: Grundkonzepte
description: Mentales Modell — Agenten, Gespräche, Board, Speicher, Skills, Tools, Kanäle.
---

EYAS ist ein **persönliches KI-Betriebssystem**: benannte Agenten, dauerhafter Speicher, Board, Automatisierung, Multi-Kanal — auf deiner Maschine.

## Bausteine

| Konzept | Bedeutung | UI |
|---------|-----------|-----|
| **Agent** | KI-Persona mit Modell, Tools, Skills, Stimme, Workspace, Kanälen | Agenten |
| **Primary** | Always-on aus dem Setup (Assistant + Engineer) | Agenten |
| **Team / Specialist** | Extra-Kapazität, oft Delegation | Agenten |
| **Gespräch** | Nachrichten-Thread mit Tools und Runs | Neue Konversation |
| **Board-Karte** | Nachverfolgbare Arbeit | Board |
| **Projekt / Stage** | Delivery-Struktur | Projekte |
| **Skill / Tool** | Wissenspaket / aufrufbare Aktion | Skills / Tools |
| **Speicher** | Working → episodic → vault → archive | Memory |
| **Knowledge / Documents** | Wiki vs. Uploads | Knowledge / Documents |
| **Kanal** | Externer Ein-/Ausgang (z. B. Telegram) | Kommunikation |
| **Provider** | LLM-Backend | Providers |
| **Prompt-Kette** | master → project-type → project → conversation | Prompts |
| **Security Gate / Forge** | Policy bzw. freigegebene Soul-Änderungen | Security / Forge |

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

## Orchestration (Gespräch)

| Steuerung | Bedeutung |
|-----------|-----------|
| **Effort** | Reasoning-Tiefe vs. Kosten |
| **Solo** | Keine Sub-Agenten |
| **Auto** | Modell entscheidet Fan-out |
| **Deep** | Aggressiver Multi-Agent-Fan-out |

## Weiter

[Erste Schritte](/docs/de/getting-started/) · [Agenten](/docs/de/agents/overview/) · [Speicher](/docs/de/knowledge/memory/)
