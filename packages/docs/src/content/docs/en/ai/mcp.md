---
title: MCP servers
description: Model Context Protocol — active servers, catalog install, memory-store blocking, and CLI tool parity.
---

**What this is for.** MCP (Model Context Protocol) is how EYAS attaches *external* toolboxes: a filesystem server, a SaaS MCP, a local `npx` process. Tools discovered here become assignable like builtins. This is not a chat [channel](/docs/en/communication/channels/) and not a [Connection](/docs/en/admin/connections/) inventory row — though you can also register an MCP server as a Connection for health tracking.

**Route:** `/mcp-settings` (sidebar **MCP Servers**). Title: **MCP Servers**. Subtitle: *Extend EYAS with external tools, resources, and prompts via Model Context Protocol.* Tabs: **Active** · **Catalog**.

## When to use it

- An agent needs tools that EYAS does not ship (a vendor MCP, a local filesystem server).
- A Grok or Kimi agent cannot reach EYAS tools and you need the bridge self-test result.
- You want a one-click catalog install (API key) instead of typing a command.
- Grok/Kimi CLI sessions should see the same ToolExecutor tools as in-process agents.
- A server is disconnected and you need **Test** / discovered tool counts.
- A server shows **Blocked: memory store**, or an install was refused because it would keep memory outside EYAS.

## Typical workflow

1. Open **MCP Servers** (`/mcp-settings`).
2. Browse **Catalog**. Filter by category. Sections: **Ready to Use** / **One-Click Install (API Key Required)** / **Third-Party (Manual Setup)** / **Not available — memory outside EYAS**.
3. **Install** (fill the keys if prompted, then **Install & Connect**) or **Manual** → **Add MCP Server** (name, transport, command or URL).
4. On **Active**, confirm the server is connected, run **Test**, inspect the discovered tools / resources / prompts.
5. Assign those tool ids on the agent **Configuration** tab. See [Tools](/docs/en/automation/tools/).

## Features

The header shows **N/M connected**. Catalog entries carry a **license** badge (MIT-compatible / copyleft / proprietary / unknown) — copyleft and proprietary still run as a **separate process**; EYAS remains MIT.

You can also register an MCP server as a [Connection](/docs/en/admin/connections/) inventory row (type **MCP server**) for health tracking next to Odoo/GitHub/etc.

Magnific, Higgsfield, fal, and HeyGen connect under [Media](/docs/en/ai/media/); the agent uses five `media_*` tools instead of their raw MCP catalogues.

**Agent Browser** (Vercel, Apache-2.0) is a Browser catalog row: `agent-browser mcp --tools core,state`. Install the CLI first (`EYAS_AGENT_BROWSER_BIN` or PATH). Never `--tools all` (includes `chat`). See [Browser Use](/docs/en/automation/browser-use/).

**Chrome DevTools MCP** (Google, Apache-2.0) is a **DevTools** catalog row: `npx -y chrome-devtools-mcp@latest --isolated` with telemetry off and `--categoryExperimentalWebmcp=true`. Coding/debug only (console, network, Lighthouse, WebMCP) — **not** form-filling. Tools arrive as `mcp_chrome-devtools_*`. WebMCP tools (`list_webmcp_tools` / `execute_webmcp_tool`) only if the sidecar advertises them; otherwise they are not invented. `--autoConnect` and the daily Chrome profile are refused. See [Browser Use](/docs/en/automation/browser-use/#chrome-devtools-mcp).

## Fields and controls

<h2 id="active">Active servers</h2>

Each server card shows its name, a status dot, the transport, the command or URL, and badges:

| Control | Meaning |
|---------|---------|
| **disabled** | Server exists but is not enabled |
| **Blocked: memory store** | The server keeps memory outside EYAS or points at a protected folder. It is never started and its tools reach no model; **Test** and **Refresh** are disabled, **Edit** and **Delete** still work — see [below](#memory-store-servers-are-blocked) |
| **OAuth** / **API key** | How the server authenticates (no badge when it needs none) |
| **Connect with OAuth** | OAuth servers: starts the browser sign-in (`POST …/oauth/start` → redirect). Magnific and Higgsfield show **Connect with Magnific / Higgsfield (OAuth)** |
| **Managed by Settings → Media** | Shown when the server belongs to Media (`ownedBy` is `media`) |
| **N tools / N resources / N prompts** | Discovered catalogue |
| **Test** → **Connection OK / Test failed** | Probe the connection; the result of the last test |
| **Refresh** | Discover the server's tools again |
| **Edit** / **Delete** | Change command, URL or API key; remove the server |

<h2 id="add-server">Add / edit dialog</h2>

**Manual** opens **Add MCP Server** (**Edit MCP Server** for an existing one):

| Field | Meaning |
|-------|---------|
| **Name** | Display id |
| **Transport** | **stdio (local process)** · **HTTP (remote)** · **SSE (streamable HTTP)** — the `sse` transport is Streamable HTTP; do **not** append `/sse`. EYAS handles the session header. |
| **Command** / **Arguments** | stdio only: the process (`npx`) and its space-separated arguments |
| **URL** | HTTP / SSE only: the endpoint (no `/sse` suffix) |
| **API Key (optional)** | HTTP / SSE only: sent as a Bearer token |

Servers that sign in with OAuth come from the catalog or Media; the dialog has no OAuth option.

<h2 id="catalog">Catalog</h2>

| Control | Meaning |
|---------|---------|
| Category filter | **All (N)** plus per-category |
| **Install / Installed** | One-click or already present |
| **Setup guide** / **Hide setup guide** | Expand vendor instructions |
| Key dialog | Required keys before **Install & Connect** |
| License notice | *Licensed under … Runs as a separate process — EYAS remains MIT.* |

Empty active list: *No MCP servers configured* — **Browse Catalog**.

<h3 id="memory-store-servers-are-blocked">Memory-store servers are blocked</h3>

An MCP server that keeps a second memory outside EYAS would become a live read/write source for every model. Such servers are blocked for every model — API providers, Claude Code, Grok CLI and Kimi CLI alike. EYAS reads and writes memory only through its own stores; the way to bring other memory in is a one-way import (**Settings → System → Data portability → Import data**, see [Data import](/docs/en/admin/data-port/)).

What counts as a memory store:

- The catalog entries **Memory** (knowledge-graph server), **Qdrant** and **Obsidian**. They are listed under **Not available — memory outside EYAS**, with **Install** disabled, a short explanation and a **Go to Data portability** button.
- A server added by hand whose command or arguments name a known memory package or binary: the MCP reference memory server (`@modelcontextprotocol/server-memory`, `mcp-server-memory`), MCPVault (`@bitbonsai/mcpvault`, `mcpvault`), Obsidian MCP servers (`mcp-obsidian`, `obsidian-mcp`, `obsidian-mcp-server`), Basic Memory, Mem0/OpenMemory, and the packages of the flagged catalog entries (for example `mcp-server-qdrant`). A version suffix does not matter. Only package and binary names are matched, never the display name, so a server merely *called* "memory" installs normally.
- A server whose argument, `--flag=value`, environment variable value, command path or `file://` URL points at a protected folder: another tool's memory or state (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, OpenCode's folders, `ai-memory` folders, an Obsidian vault, `security.foreignMemoryPaths` entries), EYAS's own data folder (vault, database, keys — conversation workspaces stay allowed) or the EYAS-owned CLI homes. A Filesystem server pointed at an Obsidian vault or at `data/vault` is blocked; one pointed at an ordinary project folder is fine. Servers EYAS runs from `data/mcp-servers/` — the folder `config/mcp.yaml` clones them into — are server code, not memory, and are allowed (judged by their real path, so a link from there into the vault is still blocked).

**What happens.** Installing from the catalog, adding by hand, or editing a server into such a configuration is refused, with a translated message, and nothing is saved. Servers configured before blocking existed are not deleted: at startup they are marked **Blocked**, never started, and none of their `mcp_*` tools reach any model. The **Active** tab shows a **Blocked: memory store** badge with the reason and a link to the data import. If the policy no longer flags a server (for example a folder was removed from `security.foreignMemoryPaths`), it leaves the Blocked state at the next start. Entries in `config/mcp.yaml` that are memory stores are skipped with an error in the log.

**Migration.** Existing installs lose a previously working Memory, Qdrant, Obsidian or MCPVault server, and any server pointed at a vault or at another tool's memory. This is intended: copy that memory into EYAS once with the data import.

**API (integrators).** `GET /api/v1/mcp/servers` includes `blocked: 'memory_store' | null` per server (status `blocked`). `POST /api/v1/mcp/servers`, `PUT /api/v1/mcp/servers/:id`, `POST /api/v1/mcp/registry/:id/install` and `POST /api/v1/mcp/servers/:id/refresh` answer `409 {error, code: 'memory_store_blocked'}`; `POST /api/v1/mcp/servers/:id/test` returns `{ok: false, code: 'memory_store_blocked'}`. Catalog entries carry `memoryStore: true`.

---

<h2 id="cli-mcp-tool-parity-grok--kimi">CLI MCP tool parity (Grok / Kimi)</h2>

API and in-process providers already share EYAS tools. For **host CLI** providers:

| Provider | Behaviour |
|----------|-----------|
| **Claude Code** | In-process MCP server named `eyas`, called as `mcp__eyas__<name>`. It does not go through the stdio bridge below, so it does not depend on the bridge's boot self-test. It is the only MCP server Claude Code loads. |
| **Grok CLI / Kimi Code CLI** | Stdio MCP server + loopback bridge (`/api/v1/internal/cli-mcp/tools/list` and `/tools/call`) with a per-turn secret; ACP `session/new` receives `mcpServers` so the CLI host can call the same ToolExecutor tools. It is the only MCP server they may connect: host and project MCP servers are not loaded (see [Providers](/docs/en/ai/providers/#grok-cli-and-kimi-code-cli)). |

OpenCode is not an MCP host here: inside an `opencode_run` task it gets `memory_search` / `memory_expand` from the EYAS memory plugin instead (see [below](#tool-names-per-host) and [OpenCode](/docs/en/automation/opencode/)).

**Which EYAS tools a CLI gets.** One rule for both bridges: every EYAS tool in the agent's scope — its **Tools** list plus `memory_search` and `memory_expand` (an empty list means all tools), without `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` and `propose_team` in a **Solo** conversation — **except** the ones for which the CLI has a granted equivalent of its own: `read_file`, `grep` and `glob` (the CLI's reading tools are always granted), `write_file` and `edit_file` while the agent's list grants writing, and `run_command`, `git_status` and `git_diff` while it grants the shell. For those the CLI uses its own shell and file tools in the turn's folders, under the [kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox) and the memory-path policy. An EYAS tool whose CLI equivalent is not granted is offered over the bridge instead — `git_status` and `git_diff` on a list without `run_command`. The agent's **Tools** list also limits the CLI's own write, shell and web tools (see [Agents — Tools](/docs/en/agents/configure/#tools--constraints)). CLI models also get the EYAS browser tools (`browser_*`, including saved sessions and `browser_totp`), `agent_browser_*`, `browser_use_*` and `opencode_*`. They run in EYAS under the same security gate, approvals, permissions and tool scope as on API models. For Grok and Kimi, the per-turn binding stores the tool scope on the server: `tools/list` shows exactly the allowed tools, `tools/call` refuses any other — before the security gate is asked, so it never creates an approval — and the refusal shows on the turn's tool row as **Denied**. The tool list in a CLI model's system prompt does not name the EYAS tools the CLI's own granted tools stand in for.

Result: coding CLIs and the web agent path see a **consistent tool surface** instead of inventing parallel integrations. On Claude Code every bridged tool call carries the conversation, its project, the answer (turn) and the run, so memory drill-down is **3 calls per answer** as on the other providers, memory results stay locked to the conversation's project, its type and global memory, and tool executions are attributed to the supervised run. A request made outside a conversation is not attributed to an empty conversation id. Grok and Kimi agents reach `memory_search` / `memory_expand`, board, documents, search and the rest of the EYAS tools. The helper also tells the model that EYAS memory is the only memory and that `memory_search` / `memory_expand` come from this server.

<h3 id="how-the-bridge-is-secured">How the bridge is secured</h3>

- Each answer turn gets its own random secret (192 bits).
- EYAS records on the server which conversation, agent, project, turn and run the secret belongs to, whether the turn is attended (an interactive chat or a channel conversation) or autonomous (a background run; a turn not labelled as attended counts as autonomous), and a resumed run's list of calls already executed. The helper process only presents the secret; nothing it sends can make a tool call act for another conversation, project or user.
- The secret is revoked the moment the turn ends (finished, failed, stopped or abandoned) and expires 2 hours after its last use, so a long, busy turn keeps its EYAS tools.
- A request that visibly came through a proxy from a non-local address is refused, even with a valid secret.
- Bridged tool calls go through the same decision as Claude Code's tool calls and the API providers' own tool loop: first the toolset check (a tool outside the agent's list is refused as **Denied** before the gate, so it never queues an approval), then the EYAS [security gate](/docs/en/admin/security-privacy/) and, for autonomous turns, the autonomy ladder; permission checks run as the agent. In an attended chat or channel conversation a call the gate allows runs — a tool marked as needing approval no longer waits in the queue just because the model is Grok or Kimi — and a call the gate escalates shows an approval card without pausing the chat. In an autonomous run a call at **Notice** or **Approve** waits for approval, and an escalated call always waits for a person, even at **Auto** (before, it ran unasked on Grok and Kimi). Without a running security gate every bridged call is refused. The bridge knows the turn's folders on the server — all of the conversation's folders, not only the first — so EYAS file tools work in them, and a request can never name folders of its own.
- When a bridged EYAS tool is refused or waits for an approval, the outcome goes back to the same tool row in the conversation, with the approval's entry in the Approvals queue. In a supervised autonomous run, such an approval pauses the run (**Waiting approval**) once the CLI's turn ends, just as an approval for the CLI's own tools does; once approved, the run resumes and exactly the approved call is allowed once.
- A resumed or retried run that repeats an EYAS tool call the original run already completed is refused before it runs, and the row shows **Skipped** — *already executed on the original run — duplicate side effect prevented*. The same tool with other arguments still runs. On Grok, the tool row of an EYAS tool records the arguments the tool received (`use_tool`'s `tool_input`), not Grok's wrapper, so the resumed run recognises the repeat. Proven on the installed Grok CLI by the release check; how a real Kimi binary reports these calls has not been verified on a host yet.
- Results of memory tools (`memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`), including their error texts, are masked by the privacy policy before the CLI receives them, exactly as memory in the prompt is: the CLI's vendor always counts as remote, and nothing the helper sends can change that. The same masking applies to Claude Code's in-process EYAS tools. If the scan fails, the result is withheld (*Error: memory tool result withheld (privacy scan failed)*). Other tools' results are passed unchanged. See [Where masking applies](/docs/en/admin/security-privacy/#where-masking-applies).
- Exactly two internal paths skip the web login: `/api/v1/internal/cli-mcp/tools/list` and `/api/v1/internal/cli-mcp/tools/call`. Every other internal path still requires login.

The helper runs under the same runtime as EYAS (Bun), from its own install location, so it also works in Docker images; `EYAS_INSTALL_ROOT` is not used to find it.

<h3 id="boot-self-test">Boot self-test</h3>

When EYAS starts, it tests the bridge through the full request stack, the same way the helper will call it. Success is logged as *CLI tool bridge self-test passed*. Failure is a warning — *CLI tool bridge self-test failed — Grok/Kimi turns cannot reach EYAS tools (memory, board, …)* — with the reason attached; start-up continues, but Grok and Kimi then run without EYAS tools. On a fresh install the test is postponed until the setup wizard is complete (info log) and runs at the next start.

| Reason in the warning | What to do |
|-----------------------|------------|
| `tools/list returned HTTP 401 … Authentication required` | The running build lacks the bridge exemption. Update or rebuild, then restart. |
| `stdio MCP server not found at …` | The build is missing `dist/stdio-mcp-server.js`. Rebuild with `bun run build` (Docker images built from this version include it), then restart. |
| `HTTP 404` | The Tools module is disabled, so there are no EYAS tools to offer. |

<h3 id="outside-mcp-clients">Outside MCP clients</h3>

Clients of EYAS's own MCP server (`/api/v1/mcp/tools/call`) have no EYAS conversation. Their memory tool calls read global memory only, with a limit of 3 calls per 90 seconds. See [Memory — Looking further](/docs/en/knowledge/memory/#looking-further-memory_search-and-memory_expand).

- **Masked.** Memory tool results sent to an external MCP client are masked by the privacy policy like every other remote destination — an external client can run any model, so it always counts as remote. A failed scan withholds the result.
- **Validated.** A malformed `tools/call` body gets HTTP `400` with a JSON-RPC error: `-32600` *Invalid Request* for a non-JSON or non-object body, `-32602` *Invalid params* for a missing name or a non-object `arguments`. An unknown tool is `404` with `-32601`.

<h2 id="tool-names-per-host">Tool names per host</h2>

EYAS tools have one canonical name (`memory_search`, `memory_expand`, …). Each model host lists them differently:

| Host | How the model calls `memory_search` |
|------|-------------------------------------|
| API providers (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, Ollama, LM Studio, compatible endpoints) | `memory_search` — EYAS runs the tool itself |
| Claude Code CLI | `mcp__eyas__memory_search` — the tools come from EYAS's in-process MCP server named `eyas`, which does not go through the stdio bridge and so does not depend on the bridge's boot self-test |
| Grok CLI | EYAS tools are not in Grok's own tool list. The model finds one with `search_tool`, then calls `use_tool` with `tool_name` `eyas__memory_search` and its arguments in `tool_input`. A plain `memory_search` in Grok is Grok's own built-in memory tool, not EYAS memory, so EYAS never tells a Grok model to call a bare `memory_search`. |
| Kimi Code CLI | `memory_search` on the MCP server named `eyas`. Kimi's exact naming is not verified yet, so EYAS names the server rather than a qualified tool name. |
| OpenCode (in an `opencode_run` task) | `memory_search` — a tool of the EYAS memory plugin inside OpenCode, with EYAS's own name, description and arguments. The plugin posts the call to EYAS, which runs the real tool for the task's conversation. It offers only `memory_search` and `memory_expand`, nothing that writes. |

When EYAS knows which provider runs a turn, the tool list in the system prompt ends with one line telling the model how to call the listed tools on its host — on Claude Code, that the EYAS tools come from the EYAS MCP server and are called as `mcp__eyas__<name>`. Memory hints and the *N more notes* line name the tools the same way. Models on API providers see plain names. There is nothing to configure. When a conversation switches to a provider with different tool naming, the cached prompt prefix changes once (a one-time prompt-cache miss).

## Related

- [Tools](/docs/en/automation/tools/)
- [OpenCode](/docs/en/automation/opencode/)
- [Media](/docs/en/ai/media/)
- [Agents configure](/docs/en/agents/configure/)
- [Connections](/docs/en/admin/connections/)
- [Providers](/docs/en/ai/providers/)
- [Data import](/docs/en/admin/data-port/)
