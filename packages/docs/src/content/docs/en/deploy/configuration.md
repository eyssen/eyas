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
| `EYAS_ODOO_SOURCE_PATHS` | Colon-separated local Odoo checkout roots for `odoo_search_model` / `field` / `xml_id` |

Tool policy hooks run on every tool call (PreToolUse / PostToolUse) via the ToolExecutor — see [Tools](/docs/en/automation/tools/).
