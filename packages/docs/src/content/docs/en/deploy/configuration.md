---
title: Configuration
description: YAML defaults, local overlays, env precedence — after you pick an install path.
---

**What this is for.** Configuration is how you change listen address, modules, autonomy, memory capture, and agent verify commands without rebuilding. Edit `local.yaml` and `EYAS_*` env — not `config/default.yaml` if you can avoid it (upgrades overwrite shipped defaults). This chapter assumes you already chose [native](/docs/en/deploy/native/), [Docker](/docs/en/deploy/docker/), or [Kubernetes](/docs/en/deploy/kubernetes/).

## When to use it

- Change host/port, log level, or disable a module.
- Turn the **model-call capture** off (`memory.capture.enabled: false`) — default is on. This does **not** stop raw capture: `memory.l0.enabled` is a separate switch, also on by default.
- Turn **raw capture** off (`memory.l0.enabled: false`) if you do not want a verbatim second copy of every message kept on disk.
- Import extra skill or persona markdown folders (`skills.importRoots` / `agent.importRoots`) without turning host Claude config on.
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

Example keys in default.yaml: `server.host/port`, `database.path`, `log.level`, `modules.disabled`, `autonomy.identitySelfUpdate`, `memory.capture.enabled`, `memory.l0.enabled`.

### Durable memory capture

```yaml
memory:
  capture:
    enabled: true          # set false to stop post-turn vault writes
    minUserChars: 40
    maxPerConversation: 20
```

Default **on**. A small model call attaches after a qualifying turn — never in the reply’s critical path. See [Memory](/docs/en/knowledge/memory/) and [FAQ](/docs/en/reference/faq/).

### Raw capture (0.8.23-beta)

```yaml
memory:
  engine: legacy           # 'legacy' or 'v2'; retrieval is the same either way
  l0:
    enabled: true          # false = keep no raw copies at all
    captureToolResults: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

This is **not** the same switch as `memory.capture` above. Capture writes vault notes and costs a small model call; raw capture keeps a **verbatim second copy of every persisted message** — compressed and content-addressed — with **no model call and no API cost**. It is on by default.

| Key | Default | Meaning |
|-----|---------|---------|
| `memory.l0.enabled` | **`true`** | Master switch for raw capture. `false` records nothing and buffers nothing. |
| `memory.l0.extractInLegacy` | **`true`** | Run the deterministic pass (facts, summary, entities, topics, importance) after each flush while `engine` is still `legacy`. `false` keeps the raw text and derives nothing from it. |
| `memory.engine` | **`legacy`** | `legacy` or `v2`. Today it gates only extraction — `v2` makes the deterministic pass run even when `extractInLegacy` is `false`. It does **not** switch what a conversation recalls. |
| `memory.l0.chunkTokens` | **`8000`** | Size flush trigger: a conversation's buffer is written out once its estimated token count reaches this. |
| `memory.l0.idleFlushMinutes` | **`30`** | Time flush trigger: a once-a-minute sweep writes out any buffer idle this long. Closing the conversation and stopping EYAS also flush, so a clean restart loses nothing. |
| `memory.l0.captureToolResults` | **`false`** | Also capture tool output. **Read the next paragraph before turning it on.** |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Byte cap for a single captured tool result, clipped on a UTF-8 boundary with a visible truncation marker. Tool results only; messages are not capped. |

**`captureToolResults` is off for a reason.** A captured tool result is the whole output, verbatim and unredacted, plus 2,048 clipped characters of the call's arguments: `run_command` stdout, `read_file` contents, and a live `browser_totp` one-time code all land in the raw layer as plain text. Nothing redacts them and nothing encrypts them at rest — compression is not confidentiality. With the flag on, every start logs a warning saying exactly that. Turn it on only where that is acceptable for this machine.

**Nothing reads these rows yet.** 0.8.23-beta is a write path only: there is no retrieval, no page in the UI, no API endpoint, and no `eyas memory` command. Prompts are still assembled from the vault and prior conversations exactly as before, so setting `memory.engine: v2` today changes nothing you can see.

**Raw capture grows and nothing prunes it.** There is no retention setting and no cleanup job in this release; a captured message costs roughly 5 KB on disk including indexes. If you would rather not pay that yet, set `memory.l0.enabled: false`. See [Memory](/docs/en/knowledge/memory/).

### Memory index and recall

| Key | Default | Meaning |
|-----|---------|---------|
| `memory.index.budgetChars` | **`2400`** | Characters of the always-on memory index per turn (≈ 600 tokens). Raise it to around 8000 when your `user` and `feedback` notes no longer fit. Needs a restart. |
| `memory.recall.includeSecrets` | **`false`** | Whether notes, episodic rows and skills tagged `contains-secrets` (files the importer found credentials in, stored verbatim) are shown to the model in the memory index, related work and `search_memory`. Off, they are stored and visible on the Memory page but never reach a prompt. Needs a restart. |

### Database durability

From 0.8.23-beta every EYAS database connection runs `PRAGMA synchronous = NORMAL` instead of SQLite's default `FULL`. Paired with WAL, which EYAS has always used, this means:

- A **process** crash — EYAS killed, an unhandled error — loses nothing already committed.
- An **OS** crash or power loss at the instant of a commit can lose the last transaction.

That is the standard WAL trade and it applies to **all** modules, not only memory. If your instance holds work you cannot re-enter, treat [Backup](/docs/en/admin/backup/) as the durability story, not the commit mode.

### Extra skill and persona roots

Host Claude / Cursor skill folders are **not** a live store. Isolation stays on. To copy procedures into EYAS, list directories on this instance:

```yaml
skills:
  importRoots: []          # extra markdown skill folders; empty = none
agent:
  importRoots: []          # extra persona markdown folders; empty = none
```

Shipped default is an empty list. Put paths in `local.yaml`, never in product source. Imported skills win over bundled copies of the same id. See [Skills](/docs/en/automation/skills/#import-roots).

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
