---
title: SeHmey
description: YAML motlh, naDev chelmey, env potlh.
---

| tev | Qu' |
|-----|-----|
| `config/default.yaml` | ngeHlu'bogh motlh |
| `local.yaml` | chel boq |
| `.env` | chaw'lu'bogh peghmey (gitDaq yIchelQo') |

potlh: CLI wIvmey → `EYAS_*` env → naDev YAML → motlh YAML.

default.yaml mIw chovnatlh: `server.host/port`, `database.path`, `log.level`, `modules.disabled`, `autonomy.identitySelfUpdate`.

## ghoqwI' chov 'ej ghItlh (0.8.6+)

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

| mIw | Del |
|-----|-----|
| `agent.verifyCommands` | `{ name, command, args?, timeoutMs? }` tetlh — **shell tu'lu'be'** ; lujchugh ghoqwI' Qagh Del tlhej poSqa'lu' |
| `agent.verifyCwd` | ra'meyvam vum Daq |
| `EYAS_ODOO_SOURCE_PATHS` | naDev Odoo qawHaq potlh, `:` pagh `;` chev — ngeD `odoo_search_*` 'ej chaw'lu'bogh Hal taghvaD |
| `EYAS_ODOO_SOURCES_JSON` | potlh law' mI' tagh: JSON tetlh `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` — taghDI' Dal **nej Halmey** chu'chugh, Hemeyvam tetlhDaq tu'lu'be'chugh |

### law' mI' Odoo chovnatlh

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

ghIq **nej Halmey** yIpoS, Hoch Hal **yInejqa'**, 'ej Hoch [Qu'](/docs/tlh/daily/projects/)Daq **motlh ghItlh Halmey** tIwIv. ja'chuqmey **Halmey** navDaq Halmey tlhoy' — [nej](/docs/tlh/daily/search/#multi-version-pin-which-tree-may-the-agent-use) yIlegh.

Hoch jan ra'DI' jan chut tlheghmey Qap (PreToolUse / PostToolUse) ToolExecutor lo'taHvIS — [janmey](/docs/tlh/automation/tools/) yIlegh.
