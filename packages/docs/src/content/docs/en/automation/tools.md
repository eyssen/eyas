---
title: Tools
description: Catalogue of invokable capabilities — risk, approval, and assignment to agents.
---

**What this is for.** Tools are the actions an agent can actually take: read a file, search an index, open a browser, send a draft email. This page is the live catalogue of everything registered on this instance. Assignment still happens on the agent **Configuration** tab; this screen is how you inspect name, category, risk, and whether a call waits on approval.

**Route:** `/tools`. Sidebar: **Tools**. Subtitle: *Registered tools available for agent execution.*

## When to use it

- You want to know which tools exist before you put their ids on an agent.
- A call was blocked and you need the risk tier and whether it **requires approval**.
- You are wiring MCP or a Connection and want to see the discovered tools next to the builtins.
- You need the input schema for a tool the agent keeps mis-calling.

## Typical workflow

1. Open **Tools** in the sidebar (`/tools`).
2. Search by name or description, or filter by category and risk tier.
3. Expand **Show schema** on a card when you need the JSON input shape.
4. Put the tool id on the agent **Configuration** tab, in **Tools (comma-separated)**. See [Configure](/docs/en/agents/configure/).
5. Dangerous calls still pass the [security gate](/docs/en/admin/security-privacy/) at runtime — a catalogue row is not a permission grant.

## Features

The header counts the **tools** and how many **require approval**. Each card shows a monospace id, a short description, a category badge, a risk badge (`green risk`, `yellow risk` or `red risk`), and an amber shield when approval is required.

| Concept | Meaning |
|---------|---------|
| Tool name | Stable id used in agent config and logs |
| Description | What the tool does (shown in the catalogue) |
| Category | Grouping from the registry: `memory`, `knowledge`, `search`, `documents`, `board`, `shell`, `browser`, `conversation`, `communication`, `research`, `agent`, `custom` (MCP and connection tools bring their own) |
| Risk tier | **green / yellow / red** — the security gate's low / medium / high |
| **approval required** | The executor will not run this call until a human approves it |
| Input schema | JSON Schema of arguments; expand **Show schema** / **Hide schema** |
| Permissions | CASL on the API plus the security gate on each call. A model can only run a tool its agent was offered: any other name is refused (*'&lt;tool&gt;' is not in this agent's toolset*), without an approval prompt, on every provider — see [Configure — Tools](/docs/en/agents/configure/#tools--constraints) |
| Sandbox | Some tools run in restricted environments |

Empty: *No tools registered yet.* Loading (*Loading tools…*) and load errors (*Failed to load tools: …*) surface as page copy, not a silent blank.

Configure MCP-backed tools under [MCP servers](/docs/en/ai/mcp/). External system credentials under [Connections](/docs/en/admin/connections/).

<h3 id="tool-execution-log">Tool execution log</h3>

Every tool call is recorded in the tool execution log: the tool's canonical name, its input, its output or error text, the duration, and the conversation, agent and supervised run it belongs to.

- Calls the EYAS executor runs — on API providers, and EYAS tools a CLI calls over the EYAS bridge — are logged by the executor, once each.
- Tools a CLI ran in its own loop — Claude Code, Grok CLI and Kimi Code CLI, such as their shell or file reads — get a row too, under the canonical name (Claude Code's `Bash` is logged as `run_command`). EYAS did not run these, so it only records them: they already ran under EYAS's permission checks for that CLI.
- These rows are the tool evidence the completeness critic checks a run against, and they feed the Self-learning and efficiency reports — the same on every provider.
- The log is not memory: nothing reaches EYAS memory from it. Whether tool output is recorded in memory is decided by `memory.l0.captureToolResults` alone — see [Memory](/docs/en/knowledge/memory/).

The **Tools** column on [Observability — Usage](/docs/en/admin/observability/#usage-tab) counts the same calls per trace.

## Fields and controls

<h2 id="catalogue">Catalogue filters</h2>

| Control | Meaning |
|---------|---------|
| Search | *Search tools…* — matches name or description |
| **All categories** | Restrict to one registry category |
| **All risk tiers** | Restrict to one risk tier |

<h2 id="built-in-tool-groups">Built-in tool groups (highlights)</h2>

<h3 id="coding-surface">Coding surface (model-agnostic)</h3>

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

Paths are jailed to the conversation **working folders** (or the agent **worktree**) — a conversation without folders of its own works in its own EYAS workspace. There is no fallback to the EYAS process directory. Sensitive paths (`.env`, `master.key`, `.ssh`, …) are denied, and so is memory outside EYAS — other tools' memory, Obsidian vaults, EYAS's own data folder and another conversation's workspace — for reads as well as writes ([Security & privacy — Memory outside EYAS](/docs/en/admin/security-privacy/#memory-outside-eyas)). A folder that would expose memory or credentials cannot be saved as a working folder at all ([Conversations — Folders](/docs/en/daily/conversations/#working-folders)). In a folder that merely contains such a location — a repository holding EYAS's `data/`, `~/Documents` with a vault — `grep` and `glob` never descend into the protected sub-folders (EYAS's data folder, a nested Obsidian vault, another tool's memory, a CLI home, another conversation's workspace), so a search never returns results from them. A symlink inside the working folder that points outside it is refused, also when its target does not exist yet (this covers `read_file`, `write_file`, `edit_file` and `browser_upload` paths). Prefer `edit_file` over full-file rewrites.

**Read-only git without a click.** If the agent calls `run_command` (or a CLI `Bash`) with an argument list that is unambiguously `git status` or `git diff` — no shell metacharacters, no `-C` / `--git-dir` / `--no-index`, no absolute path — the security gate remaps it to `git_status` / `git_diff` and **allows it**. You do not get an approval prompt. `git commit`, `git add`, `ls`, and any command with metacharacters stay red or are refused. Dedicated `git_status` / `git_diff` tools are green.

**Verify before done:** configure `agent.verifyCommands` in YAML (e.g. `bun test`) to run deterministic checks after a run; failures re-open the agent with the error summary.

**Hooks:** every tool call passes PreToolUse / PostToolUse on the ToolExecutor (universal, not Claude-only). Claude Code's own built-in tools additionally pass EYAS's memory-policy check before they run.

**CLI models use their own file tools.** Claude Code, Grok and Kimi are not offered this coding surface (`run_command`, `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`, `git_diff`) over the EYAS bridge, because they have their own: they run them in the turn's folders, under the security gate, the memory-path policy and — for Claude Code's shell and Grok's tools — the [kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox). Every other EYAS tool reaches them.

<h3 id="search-grounding">Search & grounding</h3>

| Tool | Purpose |
|------|---------|
| `list_search_sources` | List sources (label, version, edition, family, paths, status) before inventing facts |
| `get_search_context` | Show which sources are pinned for this conversation |
| `set_search_context` | Pin or clear sources (`sourceIds`, `labels`, `version`, `edition`, or `clear: true`) |
| `search_indexed` | Hybrid FTS + vector search with **citations**; respects conversation/project pin; optional `sourceIds` / `labels` / `version` / `edition` |

When multiple **odoo-family** sources are ready and nothing is pinned, tools return **`needsPin`** instead of mixing versions. See [Search — multi-version pin](/docs/en/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

<h3 id="memory">Memory</h3>

| Tool | Purpose |
|------|---------|
| `memory_search` | Search EYAS memory — summaries, facts, vault notes, imported transcripts — never the host CLI's. Read-only and locked by EYAS to the conversation's project, its type and global memory; a `scope` or project argument is ignored. Returns ids to open with `memory_expand`. |
| `memory_expand` | Open one hit by id (`vt:`, `gs:`, `en:`, … — from `memory_search` or a standing memory line), inside the same project lock |
| `search_memory` | Alias of `memory_search`, with the same project lock |
| `save_memory` | Retired — writes nothing. EYAS records memory automatically; agents never write memory themselves |

`memory_search` and `memory_expand` are always available, whatever an agent's **Tools** list says, and they are the only memory tools a model gets on every host — API providers, Claude Code, Grok, Kimi, and OpenCode inside an `opencode_run` task. The three search/expand tools share one budget of **3 calls per answer** on every provider. A caller outside an EYAS conversation — an external MCP client, or an OpenCode session EYAS did not start for a task — reads global memory only, 3 calls per 90 seconds. `memory_block_read` and `memory_block_write` are retired: what was stored in blocks was copied once into EYAS memory and is found with `memory_search`; an agent whose list still names them simply no longer gets them. Results of the memory tools are masked by the privacy policy on every transport (API providers, the CLI bridges, external MCP clients, OpenCode). See [Memory](/docs/en/knowledge/memory/).

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
| `opencode_status` / `opencode_run` | Optional OpenCode coding-engine sidecar ([OpenCode](/docs/en/automation/opencode/)). Status is green; run is red + approval. `opencode_run` runs only inside a conversation. Inside the task, OpenCode can read EYAS memory with the same read-only `memory_search` / `memory_expand`, locked to the conversation's project and sharing the calling turn's 3-call budget; it cannot write EYAS memory. |

The EYAS browser tools, `agent_browser_*`, `browser_use_*` and `opencode_*` also reach CLI models (Claude Code, Grok, Kimi) over the EYAS bridge, under the same gate, approvals and tool scope as on API models.

<h3 id="studio">Studio (optional module)</h3>

Local engines, not Media. See [Studio](/docs/en/studio/).

| Tool | Purpose |
|------|---------|
| `hyperframes_*` | HTML composition → deterministic MP4 ([Hyperframes](/docs/en/studio/hyperframes/)) |
| `videouse_*` | Footage + EDL → MP4 ([Video Use](/docs/en/studio/videouse/)) |

Screen-capture polish is not a Studio tool. Recordly is an AGPL companion under [Extensions](/docs/en/admin/extensions/#recordly) — no `recordly_*` tools.

<h3 id="email">Email (draft → approve → send)</h3>

| Tool | Purpose |
|------|---------|
| `email_create_draft` | Create local draft |
| `email_approve_draft` | Mark draft approved |
| `email_send_draft` | Send **only** if approved |

<h3 id="odoo">Odoo (optional module)</h3>

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

<h3 id="connections-inventory">Connections inventory</h3>

| Tool | Purpose |
|------|---------|
| `connections_list` / `connections_catalog` | Inventory + catalog |
| `connections_test` | Health check |
| `connections_propose` | Propose connection for human approval |

<h3 id="media">Media (optional module)</h3>

Connect Magnific, Higgsfield, fal, or HeyGen under [Media](/docs/en/ai/media/). Agents get five shared tools, not one per vendor model. Talking-head / presenter video: pin `provider: heygen`.

| Tool | Purpose | Risk |
|------|---------|------|
| `media_generate` | Start image / video / audio / upscale / edit / 3d | yellow |
| `media_wait` | Poll until the job is terminal | yellow |
| `media_catalog` | List models for a kind | green |
| `media_balance` | Credits remaining | green |
| `media_history` | Recent jobs | green |

Completed files ingest into [Documents](/docs/en/knowledge/documents/) and attach to the producing turn.

<h3 id="other-groups">Other registered groups</h3>

These appear in the catalogue when their module is enabled: **board** tools, **conversation** tools, **document** tools, **knowledge** tools, **research** tools, **schedule** tools, **channel** send/list, **A2A delegate**, and optional **Google Docs**.

Agent-owned routing (registered by the agent module, not duplicated in this catalogue):

| Tool | Purpose | Risk |
|------|---------|------|
| `run_specialist` | Spawn an enabled specialist and wait for the summary. Alias: `delegate_to_agent`. The one way to run specialists on every provider — Claude Code's own subagent tool is not offered. | green |
| `handoff_to_colleague` | Open another colleague's home thread and start a run there at once, with the brief as its goal; refused while that thread is busy. | green |
| `assign_task` | Asynchronous board card for an enabled agent. | green |
| `propose_team` | Card for missing roles, epic work, or an explicit team ask. | yellow |
| `propose_agent_creation` | Propose a new specialist template. | yellow |

See [Teams & delegation](/docs/en/agents/teams/).

<h3 id="cli-mcp-parity">CLI MCP parity</h3>

When agents run on **Grok CLI** or **Kimi Code CLI**, EYAS injects a stdio MCP bridge so those hosts share the same ToolExecutor tools as in-process / Claude Code sessions — memory tools included. Each turn has its own secret, bound on the server to that conversation, agent, project, folders and tool scope, and bridged calls still pass the security gate. On both bridges — Claude Code's in-process EYAS MCP server and the Grok/Kimi bridge — a CLI gets exactly the agent's **Tools** list plus `memory_search` / `memory_expand` (all tools when the list is empty), no delegation tools in a Solo conversation, and not the tools for which the CLI's own equivalent is granted (`read_file`, `grep`, `glob` always; `write_file`, `edit_file` while the list grants writing; `run_command`, `git_status`, `git_diff` while it grants the shell). The same list also limits the CLI's own write, shell and web tools (see [Agents — Tools](/docs/en/agents/configure/#tools--constraints)). A call to any other tool is refused and shows as **Denied**. EYAS tests the bridge at every start and logs a warning when Grok/Kimi cannot reach EYAS tools. Each host names the tools its own way (Grok: `use_tool` with `eyas__<name>`). See [MCP](/docs/en/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

## Related

- [Agents — configure tools](/docs/en/agents/configure/)
- [Teams & delegation](/docs/en/agents/teams/)
- [Security gate](/docs/en/admin/security-privacy/)
- [Connections](/docs/en/admin/connections/)
- [Skills](/docs/en/automation/skills/)
- [MCP servers](/docs/en/ai/mcp/)
- [OpenCode](/docs/en/automation/opencode/)
- [Media](/docs/en/ai/media/)
- [Studio](/docs/en/studio/)
- [Browser Use](/docs/en/automation/browser-use/)
- [Extensions](/docs/en/admin/extensions/#recordly)
