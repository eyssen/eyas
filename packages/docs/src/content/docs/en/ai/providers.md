---
title: Providers
description: AI backends — every provider type, panel controls, models.
---

**Route:** `/providers`. Subtitle: *AI routing, provider configuration, and budget controls.*

Tabs: **Routing Tiers · Providers · Budget · AI Analysis**.

## Provider cards

Each card shows identity, health, and enable toggle.

| Element | Meaning |
|---------|---------|
| **On / Off** | Enable provider for routing |
| **N/M models enabled** | How many models are active |
| **CLI not found** | Host binary missing |
| **No API key** | Needs key |
| **Auth error** | Credentials failed — re-enter key/login |

### Built-in provider descriptions (examples)

| Provider | Role |
|----------|------|
| Anthropic | Claude (Opus, Sonnet, Haiku, Fable) |
| OpenAI | GPT-4o, o3, … |
| OpenRouter | Multi-provider gateway |
| Gemini | Google Gemini |
| Kimi | Moonshot API |
| Claude Code CLI / SDK | Local Claude session |
| Grok CLI / Kimi CLI | Local ACP CLIs — receive EYAS tools via [CLI MCP bridge](/docs/en/ai/mcp/#cli-mcp-tool-parity-grok--kimi) |
| Ollama / LM Studio / vLLM | Local runtimes |
| xAI, Mistral, Groq, Together, DeepSeek, … | Cloud APIs as listed on cards |

## Provider panel

| Section | Meaning |
|---------|---------|
| **● Active** | Currently selected for editing |
| **Authentication** | API key or CLI session instructions |
| CLI auth | Uses local CLI — no API key; authenticate via `claude` / `grok` / `kimi` |
| API key fields | Stored encrypted in Secrets |
| Model list | Enable/disable individual models |

## Related tabs

- [Routing & budget](/docs/en/ai/routing-budget/) (Routing Tiers + Budget tabs)
- **AI Analysis** — embedded independent benchmarks iframe

## Related

- [Setup wizard — AI Provider](/docs/en/setup-wizard/)
- [Secrets](/docs/en/admin/secrets/)
