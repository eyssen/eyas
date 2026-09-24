---
title: FAQ
description: Common problems.
---

### Port in use
`EYAS_PORT=3200 ./bin/eyas start` or free the process.

### The UI is not on port 3000
Default listen port is **3100**, chosen so it does not collide with Grafana or Create React App on :3000. Open **http://localhost:3100**. Override with `EYAS_PORT` or `server.port` in YAML. Docker maps `"${EYAS_PORT:-3100}:3100"`.

### No UI
`bun run build:web` (auto on start unless `EYAS_SKIP_WEB_BUILD=1`).

### /docs 404
`bun run docs:build` or restart without `EYAS_SKIP_DOCS_BUILD`. Package: `packages/docs`. Do not run `generate-full-docs.mjs` / `bun run full-docs` — it overwrites prose.

### Provider auth error
Re-enter key under Providers/Secrets. For Claude Code, ensure `claude` is signed in in the same environment. Grok and Kimi are signed in for EYAS on their provider panel, not on the host.

### Conversations keep reading my ~/.claude / ~/.grok memory
They no longer can. Claude Code always runs isolated — no host `CLAUDE.md`, settings, hooks, skills, MCP servers or auto-memory, and no transcripts under `~/.claude/projects`; the old **Load host Claude config** switch is gone. Grok CLI and Kimi Code CLI run in their own EYAS home and never see `~/.grok`, `~/.kimi` or `~/.claude`. The security gate refuses reads as well as writes of other tools' memory for every model, and memory-store MCP servers are blocked. To bring that knowledge into EYAS, import it once with **Settings → System → Data portability → Import data**. See [Providers — Claude Code isolation](/docs/en/ai/providers/#claude-code-isolation) and [Memory](/docs/en/knowledge/memory/#memory-outside-eyas-is-refused).

### Grok or Kimi stopped answering after the upgrade
Grok CLI and Kimi Code CLI now run in EYAS's own home, so the CLI's login on the computer is not used. Sign in once for EYAS: **Providers → Grok CLI / Kimi Code CLI → Sign in for EYAS** (device code; Grok also takes an xAI API key). Until then the card shows **Sign-in required** and turns fail with *… is not signed in for EYAS*. See [Providers — Sign in Grok and Kimi for EYAS](/docs/en/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### A turn failed with "could not confirm that it runs isolated"
EYAS found something on the host that would break the CLI's isolation — for example an extra MCP server, hook, plugin or skill, a system-wide Grok config, or a managed Claude Code policy that forces another permission mode. Remove the cause and send the message again; the turn is never handed to another model. See [Providers — Isolation check](/docs/en/ai/providers/#isolation-check-before-every-turn) and [Claude Code isolation](/docs/en/ai/providers/#claude-code-isolation).

### An MCP server shows "Blocked: memory store"
It keeps a second memory outside EYAS (Memory, Qdrant, Obsidian, MCPVault, …) or points at a protected folder, so EYAS never starts it. Edit it to point elsewhere, or delete it, and bring that memory in with the data import. See [MCP](/docs/en/ai/mcp/#memory-store-servers-are-blocked).

### Claude Code is installed but the provider is not available
EYAS needs the Claude Code binary to be **signed in**, not only on PATH: a claude.ai login, `ANTHROPIC_API_KEY`, or a Bedrock/Vertex setup. Check `eyas doctor` — the **Claude Code runtime** line shows which binary EYAS runs and whether it is signed in. A service's PATH may lack `claude`; set `EYAS_CLAUDE_CODE_BIN` to its absolute path. After signing in, turn the provider off and on under Providers, or restart. See [Providers — Claude Code runtime](/docs/en/ai/providers/#claude-code-runtime).

### Durable notes are being written and I want that off
Set `memory.capture.enabled: false` in `local.yaml` (key path `memory.capture.enabled`, default **true**). Capture skipped because it is off writes **no** `memory_capture_runs` row. See [Memory](/docs/en/knowledge/memory/) and [Configuration](/docs/en/deploy/configuration/).

### Where is data?
`$EYAS_HOME` or cwd: `data/sqlite`, `data/vault`, `data/agents`, backups, logs. `EYAS_DATA_DIR` moves the whole data directory; the vault moves with it (`<data dir>/vault`). Conversation workspaces of a source install run from a git clone live in your user's application-data directory — see [Configuration](/docs/en/deploy/configuration/#conversation-workspaces).

### I set EYAS_DATA_DIR and my memory notes are missing
Earlier versions kept the vault in `<EYAS home>/data/vault` even when `EYAS_DATA_DIR` pointed elsewhere. The first start after upgrading copies those notes once into `<data dir>/vault`, but only while the new vault holds no note. Run `eyas doctor`: its **Vault** line says whether a copy is pending, or whether the old folder is no longer used because both hold notes — then copy any note you still need by hand. See [Configuration — Data directory and vault](/docs/en/deploy/configuration/#data-directory-and-vault).

### The model gets the wrong local time
Set `i18n.timezone` (an IANA name such as `Europe/Berlin`) in `local.yaml` and restart. Unset, EYAS uses the server's zone — `TZ`, else the OS; containers are usually UTC. See [Configuration](/docs/en/deploy/configuration/#time-zone-of-the-models-clock).

### Wizard stuck after reload
Log in as owner, open `/setup` for remaining optional steps.
