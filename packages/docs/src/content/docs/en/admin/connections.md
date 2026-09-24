---
title: Connections
description: External system inventory — health checks, vault secrets, agent proposals.
---

**What this is for.** Connections (`/connections`) is the named inventory of *external systems* (Odoo, GitHub, MCP, …) that agents may use after you approve them. It is not [Channels](/docs/en/communication/channels/) (messaging accounts such as Telegram) and not the [Secrets vault](/docs/en/admin/secrets/) (where credentials are stored). Put the system here; put the password or token in Secrets; put the chat bot under Channels.

**Route:** `/connections`.  
Subtitle: *External systems EYAS can use — inventory, health, and agent proposals.*

Connections are a **named inventory** of external systems (Odoo, GitHub, MCP, …). Credentials go into the [Secrets vault](/docs/en/admin/secrets/); agents can **propose** a connection for human approval instead of scattering config across MCP, skills, and ad-hoc secrets.

---

## Tabs

| Tab | Purpose |
|-----|---------|
| **Connections** | Active inventory (connected / error / disabled / unknown) |
| **Catalog** | Known system types — pick one to create an instance |
| **Pending** | Agent-proposed connections waiting for **Approve** / **Reject** |

---

## Connections list

| Control / field | Meaning |
|-----------------|---------|
| **N connections** | Count of inventory rows |
| **Add connection** | Open create form (or start from Catalog → **Use**) |
| **Name** | Human label for this instance |
| **System** | Catalog type (Odoo, GitHub, …) |
| **Status** | Pending / Disabled / Connected / Error / Unknown |
| **Adapter** | How EYAS talks to it: `native`, `http`, or `mcp` |
| **Last check** | Timestamp of last health test |
| **Error** | Last test/error message |
| **Source** | **User** / **Agent** / **System** — who created it |
| **Test** | Run health adapter (e.g. auth probe) |
| **Edit** | Update name, config, secrets |
| **Delete** | Remove connection (vault secrets pattern remains documented in Secrets) |

Empty: *No connections yet. Add one from the catalog or approve an agent proposal.*

---

## Create / edit form

| Field | Meaning |
|-------|---------|
| **Name** | Display name for this instance |
| **System type** | Catalog entry (fixed after create for most flows) |
| **Configuration** | Non-secret fields (URL, db, org, …) per system type |
| **Secrets** | Sensitive fields — stored in the vault as `conn-{id}-{field}`; *never shown again after save* |
| **Available to all agents** | Default scope when shown |
| **Save / Cancel** | Persist or discard |

Linked shortcuts: **MCP Settings**, **Secrets** (when relevant).

---

## Catalog system types

| Type | Adapter | Typical use |
|------|---------|-------------|
| **Odoo** | native | ERP / Helpdesk JSON-RPC + ticket tools |
| **GitHub** | http | Repos, issues, PRs, releases |
| **GitLab** | http | Projects, issues, MRs |
| **Linear** | http | Issues / projects API |
| **Notion** | http | Pages and databases |
| **Jira** | http | Atlassian Cloud issues |
| **Slack (API)** | http | Workspace bot tools (chat channel is separate under Communication) |
| **MCP server** | mcp | Link inventory row to an MCP server already configured under [MCP](/docs/en/ai/mcp/) |
| **Playwright MCP** | mcp | Optional Microsoft `@playwright/mcp` (Apache-2.0, npx). Accessibility snapshot + element refs; optional Playwright MCP Bridge extension for a live tab. Agent tools arrive through the MCP bridge as `mcp_playwright_*`. Test runs a fail-closed doctor (Node 18+, npx). Telemetry off. `--no-sandbox` is forbidden. Not the Python browser-use MCP. |
| **Agent Browser** | mcp | Optional Vercel `agent-browser` (Apache-2.0 CLI+MCP). `@e1` refs, state save/load, domain allowlist. Install the CLI, then Catalog → Agent Browser (`mcp --tools core,state`). Test is fail-closed (`EYAS_AGENT_BROWSER_BIN` / PATH). Never `chat`, never the daily Chrome profile. Tools: `mcp_agent_browser_*`. |
| **Chrome DevTools MCP** | mcp | Optional Google `chrome-devtools-mcp` (Apache-2.0 npx). Coding/debug: console, network, Lighthouse, WebMCP. **Not** form-filling. Catalog → Chrome DevTools MCP (`--isolated`). Test is fail-closed (Node 18+, npx). Telemetry off. `--autoConnect` and the daily Chrome profile are refused. Tools: `mcp_chrome-devtools_*`. WebMCP tools only if the sidecar lists them. |
| **Custom HTTP** | http | Generic REST with bearer/API-key |

Catalog intro: *Known system types. Pick one to create a connection instance.*

### Playwright MCP (optional)

Install from **Settings → MCP Servers → Catalog → Playwright MCP**, then add a Connections row of this type (`mcpServerName` defaults to `playwright`) so **Test** can doctor it.

- Tools appear on the agent as `mcp_playwright_*` after the MCP server connects. EYAS does not vendor the package.
- Live tab: Playwright MCP Bridge extension, then `--extension` instead of `--isolated`. Never the daily Chrome/Edge profile.
- Doctor is fail-closed, like Hyperframes CLI: missing Node 18+ or npx → Test fails with a remedy. Telemetry is off (`DO_NOT_TRACK=1`).
- Never `--no-sandbox` / `PLAYWRIGHT_MCP_NO_SANDBOX`. Never the Python `browser-use` MCP (`uvx browser-use --mcp`) — it asks for an LLM API key and exposes `retry_with_browser_use_agent`.

### Agent Browser (optional)

Install the published CLI (`npm i -g agent-browser` then `agent-browser install`, or set `EYAS_AGENT_BROWSER_BIN`), then **Settings → MCP Servers → Catalog → Agent Browser**. Add a Connections row of this type (`mcpServerName` defaults to `agent-browser`) so **Test** can doctor it.

- Tools appear as `mcp_agent_browser_*`. `--tools all` / `debug` are rewritten to `core,state` (those profiles include `chat`).
- Profile is EYAS-owned (`data/browser/agent-browser/profile`). Never `--profile Default` or the daily Chrome/Edge profile (Chrome 136+).
- Doctor is fail-closed: missing binary, timeout, or `ok: false` → Test fails with a remedy. Telemetry off. AI Gateway keys stripped.
- Never the npm `mcp-agent-browser` wrapper. Never `agent-browser chat`.

### Chrome DevTools MCP (optional, coding / debug)

Install from **Settings → MCP Servers → Catalog → Chrome DevTools MCP**, then add a Connections row of this type (`mcpServerName` defaults to `chrome-devtools`) so **Test** can doctor it.

- Tools appear as `mcp_chrome-devtools_*`. This is **not** the form-filling lane — use native `browser_*` for that.
- Catalog args: `--isolated`, `--no-usage-statistics`, `--no-performance-crux`, `--categoryExperimentalWebmcp=true`.
- WebMCP (`list_webmcp_tools` / `execute_webmcp_tool`) only if the sidecar advertises them (Chrome 150+ with `--enable-features=WebMCP`). Missing tools are not invented.
- Doctor is fail-closed: missing Node 18+ or npx → Test fails with a remedy. `--autoConnect` and `--no-sandbox` fail Test.
- Never the daily Chrome/Edge profile as `--user-data-dir`.

See [Browser Use](/docs/en/automation/browser-use/) for the headless `browser_*` lane, CLI sidecars, and this coding/debug MCP.

---

## Pending proposals

Agents can call tools to **propose** a connection. You review reason + config on the **Pending** tab:

| Control | Meaning |
|---------|---------|
| **Reason** | Why the agent wants this connection |
| **Approve** | Create/activate the connection |
| **Reject** | Dismiss the proposal |

Empty pending: *No pending proposals.*

---

## Agent tools

When the connections module is loaded, agents may use:

| Tool | Purpose |
|------|---------|
| `connections_list` | List inventory |
| `connections_catalog` | List catalog types |
| `connections_test` | Health-check a connection |
| `connections_propose` | Propose a new connection for approval |

---

## Related

- [Secrets](/docs/en/admin/secrets/)
- [MCP servers](/docs/en/ai/mcp/)
- [Browser Use](/docs/en/automation/browser-use/)
- [Tools](/docs/en/automation/tools/)
- [Settings overview](/docs/en/admin/settings/)
