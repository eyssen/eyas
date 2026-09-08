---
title: Setup wizard
description: First-boot wizard — every step, field, and control explained.
---

**What this is for.** First boot only. The wizard creates the master password, the root owner, your two primary agents, and a first model backend so the main app can unlock. After that, change those things in **Settings**, **Providers**, and **Agents** — do not expect to re-run the wizard.

## When to use it

- The browser sent you to `/setup` because setup is incomplete
- You skipped an optional step and want the field list
- You are restoring a fresh instance

Not for day-to-day changes once the app is open.

The wizard runs **once** when setup is incomplete. The browser is redirected to `/setup` until required steps finish. Optional steps can be skipped and completed later in Settings.

Chrome on every step:

| Control | Meaning |
|---------|---------|
| **Language** | Product UI language (`en` / `hu` / `de` / `es` / `fr` / `tlh`). Stored in the client language store. |
| **Appearance** | Theme template (e.g. Halo, Nebula) + light/dark toggle. |
| **Step N of M** | Progress through pending steps. |
| **Continue / Complete Setup** | Submit current step and advance. |

---

## Step order (typical)

| Order | Step ID | Required | Module |
|------:|---------|----------|--------|
| — | Appearance / language (UI chrome) | — | frontend |
| 1 | **Master Password** | Yes | secrets |
| 2 | **Root Owner** | Yes | auth |
| 3 | **Primary agents** | Yes | auth |
| 4 | **Team agents** | No | auth |
| 5 | **AI Provider** | Usually | model |
| 6 | **AI Models** | Usually | model |

Exact registration is modular — modules register steps at bootstrap. Required steps must complete before the main app unlocks.

---

## Master Password

**Purpose:** encrypt all stored secrets (API keys, tokens) at rest.

| Field | Required | Description |
|-------|----------|-------------|
| **Master Password** | Yes | Passphrase for the secrets encryption key material. Choose something strong; recovery without it means re-entering provider keys. |
| **Confirm Password** | Yes | Must match Master Password. |

After this step, secrets written via the UI go through the encrypted Secrets store.

---

## Root Owner

**Purpose:** create the main human administrator (`role: owner`, `is_root_owner`).

| Field | Required | Description |
|-------|----------|-------------|
| **Username** | Yes | Login name (placeholder example: `admin`). Must be unique. |
| **Password** | Yes | Account password (hashed; never stored plaintext). |
| **Display Name** | No | Friendly name in the UI (defaults to username if empty). |

The wizard keeps owner credentials **in memory** for the rest of the session so optional steps that need an authenticated owner can run without re-login. If you reload mid-wizard with only optional steps left, you may be sent to **Login** then back to `/setup`.

---

## Primary agents

**Purpose:** create the two always-on teammates.

| Field | Required | Description |
|-------|----------|-------------|
| **Personal Assistant** | Yes | Display name for your day-to-day agent (e.g. Jarvis). Tier: primary, type: assistant. Bound to the **general** project type. |
| **System Engineer** | Yes | Display name for the agent that maintains EYAS itself (e.g. R2D2). Tier: primary, type: engineer. Bound to the **eyas** project type. |

What is created for each:

- `agent_definitions` row (model, tools, workspace path, …)
- Workspace tree under `data/agents/<id>/` (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- Linked **agent user** record (`is_agent = 1`) for permissions / addressing

You can rename and reconfigure them later under **Agents**.

---

## Team agents (optional)

**Purpose:** enable specialist templates that primary agents can delegate to.

| Control | Description |
|---------|-------------|
| **Recommended** | Highlighted template set for a typical install. |
| **Specialists** | Full catalogue of optional agent templates. |
| **Select All / Deselect All** | Bulk toggle. |
| **N selected** | Count of templates chosen. |
| **Skip / Continue** | Finish without specialists, or apply selection. |

Selection is stored as template IDs and bootstrapped into real agents (same workspace pattern as primaries). Change later under Settings / Agents.

---

## AI Provider

**Purpose:** ensure at least one model backend is available.

### Host CLIs (if detected)

| Control | Description |
|---------|-------------|
| Badge (Claude / Grok / Kimi) | Local CLI found and usable — **no API key**. |
| **Primary CLI** | Which detected CLI is the default for agents and routing. |
| **Use a different provider** | Switch to cloud/local API configuration. |
| **Back to detected CLIs** | Return to CLI-centric view. |

### Manual / API providers

| Control | Description |
|---------|-------------|
| Provider list | Known backends (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **Active / Inactive** | Whether the provider is enabled for routing. |
| **Configure / Change key** | Open API key entry. |
| **API key** field | Secret; saved into encrypted Secrets. |
| **Save** | Persist key and mark provider usable. |
| **Re-check** | Re-probe local endpoints (e.g. Ollama URL). |
| **Continue / Complete Setup** | Advance even if none active (you can finish later in Settings → Providers) — see on-screen warning. |

---

## AI Models

**Purpose:** assign a concrete model to each agent after a provider is ready.

| Control | Description |
|---------|-------------|
| **Agent** column | Agent name from previous steps. |
| **Model** column | Dropdown of models from the primary/active provider (best-fit pre-selected). |
| **Apply** | Save assignments. |
| **Go to Providers** | Jump to full Providers UI if nothing is configured. |
| **Complete Setup** | Finish wizard and enter the main app. |

If no provider is detected: follow the hint to configure Providers after the wizard.

---

## After the wizard

| Destination | Why |
|-------------|-----|
| [Your first hour](/docs/en/first-hour/) | Walk the live UI: Home, one conversation, Board, Memory |
| [Home](/docs/en/daily/home/) | Setup recommendations for remaining optional work |
| [Providers](/docs/en/ai/providers/) | Add more backends, keys, models |
| [Agents](/docs/en/agents/overview/) | Review primaries and specialists |
| [Users](/docs/en/admin/users/) | Add human users (if multi-user) |

## Security notes

- Master password protects **secrets**, not the SQLite file encryption-at-rest by itself — protect the host disk and backups.
- Root owner password is independent of the master password.
- Agent “users” are not interactive logins for humans; they exist for identity and ACL wiring.
