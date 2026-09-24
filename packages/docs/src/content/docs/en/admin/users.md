---
title: Users & permissions
description: Human users, agent identities, roles, archive and restore.
---

**What this is for.** This page is the people-and-agents directory: humans who log in, and non-login **agent** identities linked to agent definitions. CASL enforces permissions on every protected API. It is not where you configure an agent's model or tools — that is [Configure](/docs/en/agents/configure/). **New Agent** here creates the identity and jumps to the agent editor.

**Route:** `/users`. Subtitle: *Users and AI agents.*

## When to use it

- A second human needs to log in (operator / viewer) on a multi-user install.
- You want a new agent identity without going through Agents first.
- Someone left and you need to **Archive** them (soft — restore later). Root owner and agent users cannot be archived from this table.
- You need to see who is **active** vs **archived**.

## Typical workflow

1. Open **Users** (`/users`).
2. Toggle **Active / Archived**.
3. **New Agent** creates an agent user named “New Agent” and opens `/agents/<id>`.
4. For a human, create them through setup or your user-provisioning path; roles are enforced via CASL.
5. **Archive** a human (confirm). Restore from the **Archived** view.

## Features

| Concept | Meaning |
|---------|---------|
| **Root owner** | First admin from setup (`is_root_owner`) — cannot be archived here |
| Role | `owner` / `admin` / others as defined — badge styling differs |
| Status | **active** / **archived** |
| Agent users | Non-login identities linked to agents (`is_agent`) — **AI Config →** jumps to the agent |
| Archive | Soft delete (`DELETE /users/:id`); restore `POST /users/:id/restore` |

Create users for multi-user installs; permissions enforced via CASL on API routes.

## Fields and controls

| Column | Meaning |
|--------|---------|
| **Username** | Login id |
| **Display Name** | Shown name |
| **Role** | Authorization role |
| **Type** | **Human** or **Agent** |
| **Created** | Created at |
| **AI Config →** | Agent users only — open the agent |
| Archive / restore | Humans except root owner |

Empty: *No users* / *No archived users*.

## Related

- [Setup — root owner](/docs/en/setup-wizard/)
- [API keys](/docs/en/admin/secrets/)
- [Agents](/docs/en/agents/overview/)
- [Security & privacy](/docs/en/admin/security-privacy/)
