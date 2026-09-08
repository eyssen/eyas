---
title: MCP servers
description: Model Context Protocol — active servers, catalog install, and CLI tool parity.
---

**What this is for.** MCP (Model Context Protocol) is how EYAS attaches *external* toolboxes: a filesystem server, a SaaS MCP, a local `npx` process. Tools discovered here become assignable like builtins. This is not a chat [channel](/docs/en/communication/channels/) and not a [Connection](/docs/en/admin/connections/) inventory row — though you can also register an MCP server as a Connection for health tracking.

**Route:** `/mcp-settings`. Title: **MCP Servers**. Subtitle: *Extend EYAS with external tools, resources, and prompts via Model Context Protocol.* Tabs: **Active** · **Catalog**.

## When to use it

- An agent needs tools that EYAS does not ship (a vendor MCP, a local filesystem server).
- You want a one-click catalog install (API key) instead of typing a command.
- Grok/Kimi CLI sessions should see the same ToolExecutor tools as in-process agents.
- A server is disconnected and you need **Test** / discovered tool counts.

## Typical workflow

1. Open **MCP Servers** (`/mcp-settings`).
2. Browse **Catalog**. Filter by category. **Ready to use** / **One-Click Install (API Key Required)** / **Third-Party (Manual Setup)**.
3. **Install** (fill env keys if prompted) or **Manual** → **Add MCP Server** (name, transport, command or URL).
4. On **Active**, confirm status **connected**, run **Test**, inspect discovered tools / resources / prompts.
5. Assign those tool ids on the agent **Configuration** tab. See [Tools](/docs/en/automation/tools/).

## Features

Header shows **N/M connected**. Catalog entries carry a **license** badge (MIT-compatible / copyleft / proprietary / unknown) — copyleft and proprietary still run as a **separate process**; EYAS remains MIT.

You can also register an MCP server as a [Connection](/docs/en/admin/connections/) inventory row (type **MCP server**) for health tracking next to Odoo/GitHub/etc.

Magnific, Higgsfield, and fal connect under [Media](/docs/en/ai/media/); the agent uses five `media_*` tools instead of their raw MCP catalogues.

**Agent Browser** (Vercel, Apache-2.0) is a Browser catalog row: `agent-browser mcp --tools core,state`. Install the CLI first (`EYAS_AGENT_BROWSER_BIN` or PATH). Never `--tools all` (includes `chat`). See [Browser Use](/docs/en/automation/browser-use/).

**Chrome DevTools MCP** (Google, Apache-2.0) is a **DevTools** catalog row: `npx -y chrome-devtools-mcp@latest --isolated` with telemetry off and `--categoryExperimentalWebmcp=true`. Coding/debug only (console, network, Lighthouse, WebMCP) — **not** form-filling. Tools arrive as `mcp_chrome-devtools_*`. WebMCP tools (`list_webmcp_tools` / `execute_webmcp_tool`) only if the sidecar advertises them; otherwise they are not invented. `--autoConnect` and the daily Chrome profile are refused. See [Browser Use](/docs/en/automation/browser-use/#chrome-devtools-mcp).

## Fields and controls

<h2 id="active">Active servers</h2>

| Control | Meaning |
|---------|---------|
| **disabled** | Server exists but is not enabled |
| **Test** | Probe the connection |
| **Connect** | OAuth servers: starts the browser sign-in (`POST …/oauth/start` → redirect) |
| **Managed by Settings → Media** | Shown when `ownedBy` is `media` |
| **N tools / N resources / N prompts** | Discovered catalogue |
| **Connection OK / Test failed** | Last test |
| Edit / delete | Change command, URL, API key |

<h2 id="add-server">Add / edit dialog</h2>

| Field | Meaning |
|-------|---------|
| **Name** | Display id |
| **Transport** | **stdio (local process)** · **HTTP (remote)** · **SSE (Streamable HTTP)** — the `sse` transport is Streamable HTTP; do **not** append `/sse`. EYAS handles the session header. |
| **Command / Arguments** | stdio process (`npx` + space-separated args) |
| **URL** | HTTP / SSE endpoint (no `/sse` suffix) |
| **Authentication** | **None** · **Bearer** (API key) · **OAuth** (browser) |

<h2 id="catalog">Catalog</h2>

| Control | Meaning |
|---------|---------|
| Category filter | **All (N)** plus per-category |
| **Install / Installed** | One-click or already present |
| **Setup guide** | Expand vendor instructions |
| Env dialog | Required keys before **Install & Connect** |
| License notice | *Licensed under … Runs as a separate process — EYAS remains MIT.* |

Empty active: *No MCP servers configured* — **Browse Catalog**.

---

## CLI MCP tool parity (Grok / Kimi)

API and in-process providers already share EYAS tools. For **host CLI** providers:

| Provider | Behaviour |
|----------|-----------|
| **Claude Code** | In-process MCP (existing) |
| **Grok CLI / Kimi Code CLI** | Stdio MCP server + loopback bridge (`/api/v1/internal/cli-mcp/*`) with short-lived secrets; ACP `session/new` receives `mcpServers` so the CLI host can call the same ToolExecutor tools |

Result: coding CLIs and the web agent path see a **consistent tool surface** instead of inventing parallel integrations.

## Related

- [Tools](/docs/en/automation/tools/)
- [Media](/docs/en/ai/media/)
- [Agents configure](/docs/en/agents/configure/)
- [Connections](/docs/en/admin/connections/)
- [Providers](/docs/en/ai/providers/)
