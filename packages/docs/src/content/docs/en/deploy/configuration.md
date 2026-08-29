---
title: Configuration
description: YAML defaults, local overlays, env precedence — after you pick an install path.
---

**What this is for.** Configuration is how you change listen address, modules, autonomy, memory capture, and agent verify commands without rebuilding. Edit `local.yaml` and `EYAS_*` env — not `config/default.yaml` if you can avoid it (upgrades overwrite shipped defaults). This chapter assumes you already chose [native](/docs/en/deploy/native/), [Docker](/docs/en/deploy/docker/), or [Kubernetes](/docs/en/deploy/kubernetes/).

## When to use it

- Change host/port, log level, or disable a module.
- Turn **durable memory capture** off (`memory.capture.enabled: false`) — default is on.
- Add `agent.verifyCommands` so a coding run is not “done” until tests pass.
- Point Search at several Odoo checkouts via `EYAS_ODOO_SOURCES_JSON`.

## Typical workflow

1. Copy or create `local.yaml` next to the shipped defaults (or set `EYAS_HOME` so it lives with that instance).
2. Change only the keys you need. Validate: `eyas config validate`.
3. Restart (`eyas restart`) or `eyas config reload` where supported.
4. Confirm in **Settings** and with `eyas doctor`.

## Features

| File | Role |
|------|------|
| `config/default.yaml` | Shipped defaults |
| `local.yaml` | Overlay merge |
| `.env` | Optional secrets (never commit) |

Precedence: CLI flags → `EYAS_*` env → local YAML → default YAML.

Example keys in default.yaml: `server.host/port`, `database.path`, `log.level`, `modules.disabled`, `autonomy.identitySelfUpdate`, `memory.capture.enabled`.

### Durable memory capture

```yaml
memory:
  capture:
    enabled: true          # set false to stop post-turn vault writes
    minUserChars: 40
    maxPerConversation: 20
```

Default **on**. A small model call attaches after a qualifying turn — never in the reply’s critical path. See [Memory](/docs/en/knowledge/memory/) and [FAQ](/docs/en/reference/faq/).

## Agent verify & coding (0.8.6+)

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  # Deterministic checks after a background run (empty = disabled)
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /absolute/path/to/repo   # default: process.cwd()
```

| Key | Meaning |
|-----|---------|
| `agent.verifyCommands` | List of `{ name, command, args?, timeoutMs? }` — **no shell**; failures re-open the agent with the error summary |
| `agent.verifyCwd` | Working directory for those commands |
| `EYAS_ODOO_SOURCE_PATHS` | Colon- or semicolon-separated local Odoo checkout roots for lightweight `odoo_search_*` and optional source bootstrap |
| `EYAS_ODOO_SOURCES_JSON` | Preferred multi-version bootstrap: JSON array of `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` — creates idle **Search Sources** on start if those paths are not already registered |
| `EYAS_AUTO_FAILOVER` | Opt-in fill of empty routing-tier fallbacks from a second live provider |
| `EYAS_BROWSER_USER_DATA_DIR` | EYAS-owned Chromium profile for headless `browser_*` (default `data/browser/profile`). Daily Chrome/Edge profiles are rejected |
| `EYAS_AGENT_BROWSER_BIN` | Optional Vercel agent-browser CLI path. Empty = PATH. Set-but-missing is fail-closed (no PATH fallback). Profile: `data/browser/agent-browser/profile` |

### Multi-version Odoo example

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

Then open **Search Sources**, **Reindex** each source, and set **Default code sources** on each [Project](/docs/en/daily/projects/). Conversations pin sources on the **Sources** tab — see [Search](/docs/en/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

Tool policy hooks run on every tool call (PreToolUse / PostToolUse) via the ToolExecutor — see [Tools](/docs/en/automation/tools/).

## Related

- [CLI](/docs/en/deploy/cli/)
- [Providers](/docs/en/ai/providers/)
- [Routing & budget](/docs/en/ai/routing-budget/)
- [Memory](/docs/en/knowledge/memory/)
