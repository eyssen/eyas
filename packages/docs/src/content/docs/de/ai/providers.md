---
title: Anbieter
description: KI-Backends — API, Host-CLI, lokale Runtimes. Isolation ist pro Anbieter ehrlich.
---

**Wozu das da ist.** Anbieter sind die LLM-Backends dieser Instanz: Cloud-APIs, Host-CLIs (Claude Code, Grok, Kimi) und lokale Runtimes. Hier schaltest du **Host-Claude-Config** ein — standardmäßig aus — und Grok/Kimi ACP sagen, dass sie nicht isolierbar sind.

**Route:** `/providers`. Tabs: **Routing-Stufen · Anbieter · Budget · KI-Analyse**. Sidebar: **Anbieter**.

## Wann du es brauchst

- Nach dem Setup: Anbieter **An**, API-Key, Modelle.
- `claude` / `grok` / `kimi` auf dem Host, keyless CLI.
- Gespräche lasen `~/.claude` — **Host-Claude-Config laden** bleibt **AUS**.
- Grok/Kimi ACP laden **immer** ihre Maschinen-Config — kein Fake-Schalter.

## Typischer Ablauf

1. **Anbieter** → Tab **Anbieter**.
2. Karte **An/Aus**. Authentifizierung: API-Key (im [Geheimnisse](/docs/de/admin/secrets/)-Vault) oder Host-CLI.
3. Modelle aktivieren. Refresh von API/CLI.
4. Claude Code CLI: **Host-Claude-Config laden** **AUS**, außer du willst settings.json, CLAUDE.md, Host-Skills, Projekt-`.mcp.json`.
5. Stufen und Budget: [Routing & Budget](/docs/de/ai/routing-budget/).

## Funktionen

Karten: An/Aus, N/M Modelle, CLI not found, No API key, Auth error. Anbieter wie auf den Karten: Anthropic, OpenAI, OpenRouter, Gemini, Kimi, Claude Code CLI/SDK, Grok CLI, Kimi CLI, Ollama/LM Studio/vLLM, plus Cloud-APIs.

**Host-Claude-Config (opt-in).** Default isoliert — kein settings.json, keine CLAUDE.md, keine Host-Skills, kein Projekt-`.mcp.json`. Opt-in sendet `settingSources: ['user','project','local']`. Isolierte/opt-out-Aufrufe setzen auch `CLAUDE_CODE_DISABLE_AUTO_MEMORY` und `strictMcpConfig` — leeres `settingSources` allein stoppt das cwd-Auto-Memory **nicht**. Enterprise-Policy bleibt. Rest: Session vor dem Flip stellt beim Resume alten Kontext wieder her.

**Grok/Kimi ACP nicht isolierbar.** ACP hat keinen Isolation-Parameter. grok lädt `~/.grok` und nachweislich `~/.claude`. kimi unverifiziert. Die Panels sagen das.

## Verwandt

- [Setup — KI-Anbieter](/docs/de/setup-wizard/)
- [Geheimnisse](/docs/de/admin/secrets/)
- [MCP](/docs/de/ai/mcp/)
- [Speicher](/docs/de/knowledge/memory/)
- [Routing & Budget](/docs/de/ai/routing-budget/)
