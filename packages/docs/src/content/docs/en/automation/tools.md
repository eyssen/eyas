---
title: Tools
description: Catalogue of invokable capabilities — risk, approval, and assignment to agents.
---

**What this is for.** Tools are the actions an agent can actually take: read a file, search an index, open a browser, send a draft email. This page is the live catalogue of everything registered on this instance. Assignment still happens on the agent **Configuration** tab; this screen is how you inspect name, category, risk, and whether a call waits on approval.

**Route:** `/tools`. Subtitle: *Registered tools available for agent execution.*

## When to use it

- You want to know which tools exist before you put their ids on an agent.
- A call was blocked and you need the risk tier and whether it **requires approval**.
- You are wiring MCP or a Connection and want to see the discovered tools next to the builtins.
- You need the input schema for a tool the agent keeps mis-calling.

## Typical workflow

1. Open **Tools** in the sidebar (`/tools`).
2. Search by name or description, or filter by **category** and **risk tier**.
3. Expand **Show schema** on a card when you need the JSON input shape.
4. Assign the tool id on the agent **Configuration** tab (`Tools` comma-separated list). See [Configure](/docs/en/agents/configure/).
5. Dangerous calls still pass the [security gate](/docs/en/admin/security-privacy/) at runtime — a catalogue row is not a permission grant.

## Features

The header counts **tools** and how many **require approval**. Cards show a monospace id, a short description, a category badge, a risk badge (**low / medium / high / critical**), and an amber shield when approval is required.

| Concept | Meaning |
|---------|---------|
| Tool name | Stable id used in agent config and logs |
| Description | What the tool does (shown in the catalogue) |
| Category | Grouping from the registry (`system`, `file`, `network`, `compute`, `data`, …) |
| Risk tier | Catalogue prints **green / yellow / red** (the gate’s low / medium / high) |
| **approval required** | The executor will not run this call until a human approves it |
| Input schema | JSON Schema of arguments; expand **Show schema** / **Hide schema** |
| Permissions | CASL on the API plus the security gate on each call |
| Sandbox | Some tools run in restricted environments |

Empty: *No tools registered yet.* Loading and load errors surface as page copy, not a silent blank.

Configure MCP-backed tools under [MCP servers](/docs/en/ai/mcp/). External system credentials under [Connections](/docs/en/admin/connections/).

## Fields and controls

<h2 id="catalogue">Catalogue filters</h2>

| Control | Meaning |
|---------|---------|
| Search | *Search tools…* — matches name or description |
| **All categories** | Restrict to one registry category |
| **All risk tiers** | Restrict to one risk tier |

## Built-in tool groups (highlights)

### Coding surface (model-agnostic)

First-class filesystem tools so **every** model (Grok, Claude API, Kimi, local, …) can edit code without relying on Claude Code SDK builtins:

| Tool | Purpose | Risk |
|------|---------|------|
| `read_file` | Read text file (line offset/limit) | green |
| `write_file` | Create/overwrite file | yellow |
| `edit_file` | Exact string replace (targeted edit) | yellow |
| `grep` | Content search under workspace | green |
| `glob` | Find files by pattern | green |
| `git_status` / `git_diff` | Read-only review helpers | green |
| `run_command` | Shell-free program execution (approval) | red |

Paths are jailed to the conversation **working folders** (or the agent **worktree**). There is no fallback to the EYAS process directory. Sensitive paths (`.env`, `master.key`, `.ssh`, …) are denied. Prefer `edit_file` over full-file rewrites.

**Read-only git without a click.** If the agent calls `run_command` (or a CLI `Bash`) with an argument list that is unambiguously `git status` or `git diff` — no shell metacharacters, no `-C` / `--git-dir` / `--no-index`, no absolute path — the security gate remaps it to `git_status` / `git_diff` and **allows it**. You do not get an approval prompt. `git commit`, `git add`, `ls`, and any command with metacharacters stay red or are refused. Dedicated `git_status` / `git_diff` tools were already green.

**Verify before done:** configure `agent.verifyCommands` in YAML (e.g. `bun test`) to run deterministic checks after a run; failures re-open the agent with the error summary.

**Hooks:** every tool call passes PreToolUse / PostToolUse on the ToolExecutor (universal, not Claude-only).

### Search & grounding

| Tool | Purpose |
|------|---------|
| `list_search_sources` | List sources (label, version, edition, family, paths, status) before inventing facts |
| `get_search_context` | Show which sources are pinned for this conversation |
| `set_search_context` | Pin or clear sources (`sourceIds`, `labels`, `version`, `edition`, or `clear: true`) |
| `search_indexed` | Hybrid FTS + vector search with **citations**; respects conversation/project pin; optional `sourceIds` / `labels` / `version` / `edition` |

When multiple **odoo-family** sources are ready and nothing is pinned, tools return **`needsPin`** instead of mixing versions. See [Search — multi-version pin](/docs/en/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

### Memory blocks

| Tool | Purpose |
|------|---------|
| `memory_block_read` / `memory_block_write` | Shared Letta-style blocks (company / agent / team / run) |
| `search_memory` / `save_memory` | Recall and record durable vault notes — EYAS memory, not the host CLI's. `search_memory` also searches prior conversation messages (user + assistant) in the current project; `scope=all` crosses projects. `scope` is `current` (default: this project, its type, and global user/feedback/reference notes) or `all` (other projects too). The Memory page search is unfiltered. |

See [Memory](/docs/en/knowledge/memory/).

<h3 id="browser">Browser</h3>

Headless Playwright (`browser_*`) uses the same Chromium as the design print pipeline. Prefer numbered indexes from `browser_snapshot` over CSS. Indexes and `snapshotId` die on navigation or back — snapshot again. Cookies persist in an **EYAS-owned** profile (`data/browser/profile`, or `EYAS_BROWSER_USER_DATA_DIR`) — never the daily Chrome profile (Chrome 136+ blocks Default-profile CDP). Downloads land in [Documents](/docs/en/knowledge/documents/).

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Open a URL; **SSRF** blocks private/metadata hosts |
| `browser_snapshot` | Accessibility tree + numbered interactive list + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | Act by index or CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` (cannot close the last tab) |
| `browser_back` / `browser_wait` | History back; wait for selector, URL, load, or timeout |
| `browser_dialog` | Arm accept/dismiss for the next `alert`/`confirm`/`prompt` |
| `browser_upload` | File input — workspace paths or Documents ids |
| `browser_evaluate` | JavaScript **in the page** (not Node); JSON result capped |
| `browser_download` | Next download → Documents, linked to the conversation |
| `browser_storage` | Save/load Playwright `storageState` (cookies + origins) |
| `browser_replay` / `browser_action_cache` | Replay a saved locator (no LLM). JSON in the project or vault. Never fill values |
| `browser_totp` | TOTP from Secrets / macOS Keychain → `browser_fill`. Yellow. Seed never returned |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Capture, text, end the process (profile stays on disk) |
| `agent_browser_status` / `agent_browser_run` | Recommended agent-browser sidecar (`@e1` refs, Apache-2.0) — [Browser Use](/docs/en/automation/browser-use/) |
| `browser_use_status` / `browser_use_exec` | Legacy Python CLI sidecar ([Browser Use](/docs/en/automation/browser-use/)) |

### Studio (optional module)

Local engines, not Media. See [Studio](/docs/en/studio/).

| Tool | Purpose |
|------|---------|
| `hyperframes_*` | HTML composition → deterministic MP4 ([Hyperframes](/docs/en/studio/hyperframes/)) |
| `videouse_*` | Footage + EDL → MP4 ([Video Use](/docs/en/studio/videouse/)) |

Screen-capture polish is not a Studio tool. Recordly is an AGPL companion under [Extensions](/docs/en/admin/extensions/#recordly) — no `recordly_*` tools.

### Email (draft → approve → send)

| Tool | Purpose |
|------|---------|
| `email_create_draft` | Create local draft |
| `email_approve_draft` | Mark draft approved |
| `email_send_draft` | Send **only** if approved |

### Odoo (optional module)

**Live instance** (JSON-RPC):

| Tool | Purpose |
|------|---------|
| `odoo_search_tasks` | Search tickets/tasks (read-heavy) |
| `odoo_get_task` | Fetch one task |
| `odoo_message_post` | Post chatter message |
| `odoo_write_task` | Gated write |

**Local source index** (coding chain):

| Tool | Purpose |
|------|---------|
| `odoo_search_model` | Find `_name` / `_inherit` in local Python |
| `odoo_search_field` | Find `fields.*` assignments |
| `odoo_search_xml_id` | Find XML record ids |

Roots resolve from: conversation/project **pin** → Search Sources (`family: odoo`) → `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. Optional tool filters: `label`, `labels`, `sourceIds`, `version`, `edition`. Citations: `[source:odoo-src:label:file:line]`.

Skill: `coding/odoo/odoo-dev-chain`. Live credentials via [Connections](/docs/en/admin/connections/) (Odoo type). Multi-version UI: [Search](/docs/en/daily/search/) · [Projects](/docs/en/daily/projects/) · conversation **Sources** tab.

### Connections inventory

| Tool | Purpose |
|------|---------|
| `connections_list` / `connections_catalog` | Inventory + catalog |
| `connections_test` | Health check |
| `connections_propose` | Propose connection for human approval |

### Media (optional module)

Connect Magnific, Higgsfield, or fal under [Media](/docs/en/ai/media/). Agents get five shared tools, not one per vendor model.

| Tool | Purpose | Risk |
|------|---------|------|
| `media_generate` | Start image / video / audio / upscale / edit / 3d | yellow |
| `media_wait` | Poll until the job is terminal | yellow |
| `media_catalog` | List models for a kind | green |
| `media_balance` | Credits remaining | green |
| `media_history` | Recent jobs | green |

Completed files ingest into [Documents](/docs/en/knowledge/documents/) and attach to the producing turn.

### Other registered groups

These appear in the catalogue when their module is enabled: **board** tools, **conversation** tools, **document** tools, **knowledge** tools, **research** tools, **schedule** tools, **channel** send/list, **A2A delegate**, and optional **Google Docs**. Agent-owned tools (`delegate_to_agent`, team tools, `propose_agent_creation`, …) are registered by the agent module, not duplicated here.

### CLI MCP parity

When agents run on **Grok CLI** or **Kimi Code CLI**, EYAS injects a stdio MCP bridge so those hosts share the same ToolExecutor tools as in-process / Claude Code sessions. See [MCP](/docs/en/ai/mcp/).

## Related

- [Agents — configure tools](/docs/en/agents/configure/)
- [Security gate](/docs/en/admin/security-privacy/)
- [Connections](/docs/en/admin/connections/)
- [Skills](/docs/en/automation/skills/)
- [MCP servers](/docs/en/ai/mcp/)
- [Media](/docs/en/ai/media/)
- [Studio](/docs/en/studio/)
- [Browser Use](/docs/en/automation/browser-use/)
- [Extensions](/docs/en/admin/extensions/#recordly)
