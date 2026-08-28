---
title: Provider
description: KI-Backends — Karten, Panel, Modelle.
---

**Route:** `/providers`. Tabs: Routing Tiers · Providers · Budget · AI Analysis.

## Karte

On/Off · N/M models enabled · CLI not found · No API key · Auth error.

Beispiele: Anthropic, OpenAI, OpenRouter, Gemini, Kimi, Claude Code CLI/SDK, Grok/Kimi CLI (Tools via [CLI-MCP-Bridge](/docs/de/ai/mcp/)), Ollama, LM Studio, vLLM, xAI, Mistral, Groq, Together, DeepSeek, …

## Panel

Authentication (API-Key oder CLI-Session) · Modellliste enable/disable · Keys verschlüsselt in Secrets.

**Host-Claude-Konfiguration (Claude Code CLI).** EYAS isoliert Unterhaltungen standardmäßig von der Claude-Konfiguration des Host-Rechners — keine settings.json (Hooks, Berechtigungsregeln), keine CLAUDE.md-Dateien, keine Host-Skills und keine .mcp.json-Server des Projekts —, sodass EYAS' eigenes Gedächtnis die einzige Wahrheitsquelle ist. Der Schalter „Host-Claude-Konfiguration laden" im Provider-Panel aktiviert sie wieder. Die Grok- und Kimi-CLIs laden ihre eigene Host-Konfiguration immer; EYAS kann das nicht deaktivieren. Unternehmensverwaltete Policy-Einstellungen gelten, wo vorhanden, weiterhin — diese Ebene lässt sich aus EYAS nicht deaktivieren.

## Verwandt

[Routing & Budget](/docs/de/ai/routing-budget/) · [Setup](/docs/de/setup-wizard/)
