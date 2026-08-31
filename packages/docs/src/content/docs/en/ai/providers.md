---
title: Providers
description: AI backends — API, host CLI, and local runtimes. Isolation is honest per provider.
---

**What this is for.** Providers are the LLM backends this instance can call: cloud APIs, host CLIs (Claude Code, Grok, Kimi), and local runtimes (Ollama, LM Studio, vLLM). You enable a provider, store its key, pick models, then routing uses it. This page is also where **host Claude config** is opted in — off by default — and where Grok/Kimi ACP say they cannot be isolated.

**Route:** `/providers`. Subtitle: *AI routing, provider configuration, and budget controls.* Tabs: **Routing Tiers · Providers · Budget · AI Analysis**.

## When to use it

- First run after setup: turn a provider **On**, paste an API key, enable models.
- You installed `claude` / `grok` / `kimi` on the host and want a keyless CLI provider.
- Conversations were picking up `~/.claude` memory and you need **Load host Claude config** off (the default).
- You need to know that Grok/Kimi ACP **always** load their own machine config — there is no fake switch.

## Typical workflow

1. Open **Providers** (`/providers`) → **Providers** tab.
2. Select a card. **On / Off** enables it for routing. **Authentication** takes an API key (encrypted in [Secrets](/docs/en/admin/secrets/)) or points you at the host CLI login.
3. Enable individual models. **Refresh from API / CLI** reloads the list.
4. For Claude Code CLI, leave **Load host Claude config** **OFF** unless you deliberately want settings.json, CLAUDE.md, host skills, and project `.mcp.json`.
5. Set tiers and spend on [Routing & budget](/docs/en/ai/routing-budget/).

## Features

Each card shows identity, health, and enable toggle.

| Element | Meaning |
|---------|---------|
| **On / Off** | Enable provider for routing |
| **N/M models enabled** | How many models are active |
| **CLI not found** | Host binary missing |
| **No API key** | Needs key |
| **Auth error** | Credentials failed — re-enter key/login |

### Built-in providers (as listed on cards)

| Provider | Role |
|----------|------|
| Anthropic | Claude (Opus, Sonnet, Haiku, Fable) |
| OpenAI | GPT-4o, GPT-4 Turbo, o3 |
| OpenRouter | Multi-provider gateway (100+ models) |
| Gemini | Google Gemini |
| Kimi | Moonshot API (K3, K2.7 Code, K2.6) |
| Claude Code CLI | Local Claude session (`claude`) |
| Claude Code SDK | Claude Code via SDK query API |
| Grok CLI | Local ACP (`grok agent stdio`) — EYAS tools via [CLI MCP bridge](/docs/en/ai/mcp/#cli-mcp-tool-parity-grok--kimi) |
| Kimi CLI | Local ACP (`kimi acp`) — same bridge |
| Ollama / LM Studio / vLLM | Local runtimes |
| xAI, Mistral, Groq, Together, DeepSeek, Cerebras, Venice, Hugging Face, NVIDIA, Z.AI, Kilo Gateway, Vercel AI Gateway, Qianfan, MiniMax, Synthetic, Xiaomi, … | Cloud APIs as listed on cards |

### Host Claude config (Claude Code CLI) — opt-in

By default EYAS keeps conversations isolated from the host machine's Claude configuration — no `settings.json` (hooks, permission rules), no CLAUDE.md files, no host skills or project `.mcp.json` servers — so EYAS's own memory is the single source of truth. Opting in sends `settingSources: ['user','project','local']` plus the usual CLI session. Isolated / opted-out calls also set `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and `strictMcpConfig` — an empty `settingSources` list alone does **not** stop the CLI's cwd-keyed auto-memory.

The **Load host Claude config** switch on the provider panel opts back in. Existing installs flip too. Enterprise-managed policy settings, where deployed, still apply — that tier cannot be disabled from EYAS.

Known residual: a CLI session created before the flip restores its previously loaded context when resumed, until the session goes stale.

### Grok / Kimi ACP cannot be isolated

ACP has no isolation parameter. The grok CLI has no suppression flag (it loads `~/.grok` and demonstrably `~/.claude` globally). The kimi baseline is unverified. Their panels say so instead of pretending otherwise. Do not expect EYAS memory to be the only memory those CLIs see.

## Fields and controls

<h2 id="panel">Provider panel</h2>

| Section | Meaning |
|---------|---------|
| **● Active** | Currently selected for editing |
| **Authentication** | API key or CLI session instructions |
| CLI auth | Uses local CLI — no API key; authenticate via `claude` / `grok` / `kimi` |
| API key fields | Stored encrypted in Secrets; **Key saved / No key / Remove Key** |
| Model list | Enable/disable individual models; **Tools** / **Vision** / context size badges |
| **Load host Claude config** | Claude Code CLI only — **ON / OFF**, default OFF |
| Grok ACP hint | Conversations run through `grok agent stdio`; EYAS cannot disable host config |
| Kimi ACP hint | Conversations run through `kimi acp`; EYAS cannot disable or verify host config |

## Related tabs

- [Routing & budget](/docs/en/ai/routing-budget/) (Routing Tiers + Budget tabs)
- **AI Analysis** — embedded independent benchmarks iframe

## Related

- [Setup wizard — AI Provider](/docs/en/setup-wizard/)
- [Secrets](/docs/en/admin/secrets/)
- [MCP](/docs/en/ai/mcp/)
- [Memory](/docs/en/knowledge/memory/)
