---
title: Configuration
description: YAML defaults, local overlays, env precedence.
---

| File | Role |
|------|------|
| `config/default.yaml` | Shipped defaults |
| `local.yaml` | Overlay merge |
| `.env` | Optional secrets (never commit) |

Precedence: CLI flags → `EYAS_*` env → local YAML → default YAML.

Example keys in default.yaml: `server.host/port`, `database.path`, `log.level`, `modules.disabled`, `autonomy.identitySelfUpdate`.

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
