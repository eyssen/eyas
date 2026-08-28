---
title: Providerek
description: AI backendek — típusok, panel, modellek.
---

**Útvonal:** `/providers`. Tabok: Routing Tiers · Providers · Budget · AI Analysis.

## Kártya

On/Off, N/M models, CLI not found, No API key, Auth error.

Példák: Anthropic, OpenAI, Gemini, Kimi, Claude/Grok/Kimi CLI, Ollama, LM Studio, vLLM, xAI, Mistral, …

**Grok CLI / Kimi CLI:** EYAS toolok a [CLI MCP bridge](/docs/hu/ai/mcp/) segítségével.

## Panel

Authentication (API key vagy CLI), modell lista enable/disable. Kulcsok a Secrets tárban.

**Gépszintű Claude-konfig (Claude Code CLI).** Az EYAS alapból elszigeteli a beszélgetéseket a gép Claude-konfigurációjától — nincs settings.json (hookok, jogosultsági szabályok), nincs CLAUDE.md, nincsenek gépszintű skillek és projekt .mcp.json szerverek —, így az EYAS saját memóriája az egyetlen igazságforrás. A provider-panel „Gépszintű Claude-konfig betöltése" kapcsolójával lehet visszakapcsolni. A Grok és a Kimi CLI mindig betölti a saját gépszintű konfigurációját; ezt az EYAS nem tudja letiltani. A vállalatilag felügyelt (managed) policy-beállítások — ahol vannak — továbbra is érvényesülnek; azt a szintet az EYAS-ból nem lehet kikapcsolni.
