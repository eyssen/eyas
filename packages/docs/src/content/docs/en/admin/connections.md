---
title: Connections
description: External system inventory — health checks, vault secrets, agent proposals.
---

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
| **Custom HTTP** | http | Generic REST with bearer/API-key |

Catalog intro: *Known system types. Pick one to create a connection instance.*

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
- [Tools](/docs/en/automation/tools/)
- [Settings overview](/docs/en/admin/settings/)
