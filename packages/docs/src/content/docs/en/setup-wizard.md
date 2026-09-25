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

## Typical workflow

The wizard runs **once** while setup is incomplete. The browser is redirected to `/setup` until the required steps finish. Optional steps can be skipped and completed later in Settings.

Controls on every step:

| Control | Meaning |
|---------|---------|
| **Language** | Product UI language (`en` / `hu` / `de` / `es` / `fr` / `tlh`). Stored in the browser's language setting. |
| **Appearance** | Theme template (e.g. Halo, Nebula) + light/dark toggle. |
| *Step N of M* | Progress through the pending steps. |
| **Continue / Complete Setup** | Submit the current step and advance. |

## Step order (typical)

| Order | Step | Required | Module |
|------:|------|----------|--------|
| — | Appearance / language (UI chrome) | — | frontend |
| 1 | **Master Password** | Yes | secrets |
| 2 | **Root Owner** | Yes | auth |
| 3 | Primary agents (*Your two always-on AI teammates*) | Yes | auth |
| 4 | **Team Agents** | No | auth |
| 5 | **AI Provider** | Usually | model |
| 6 | **AI Models** | Usually | model |

Registration is modular — modules register their steps at start. Required steps must complete before the main app unlocks.

## Master Password

**Purpose:** encrypt all stored secrets (API keys, tokens) at rest.

| Field | Required | Description |
|-------|----------|-------------|
| **Master Password** | Yes | Passphrase for the secrets encryption key material. Choose something strong; losing it means re-entering provider keys. |
| **Confirm Password** | Yes | Must match the master password. |

After this step, secrets written via the UI go through the encrypted Secrets store.

## Root Owner

**Purpose:** create the main human administrator (`role: owner`, `is_root_owner`).

| Field | Required | Description |
|-------|----------|-------------|
| **Username** | Yes | Login name (placeholder: `admin`). Must be unique. |
| **Password** | Yes | Account password (hashed; never stored in plain text). |
| **Display Name** | No | Friendly name in the UI (defaults to the username if empty). |

The wizard keeps the owner credentials **in memory** for the rest of the session so optional steps that need an authenticated owner can run without a new login. If you reload mid-wizard with only optional steps left, you may be sent to **Login** and then back to `/setup`.

## Primary agents

**Purpose:** create the two always-on **colleagues** you talk to (sidebar **Colleagues**, one home thread each). On screen: *Your two always-on AI teammates*.

| Field | Required | Description |
|-------|----------|-------------|
| **Personal Assistant — your day-to-day AI teammate** | Yes | Display name for your day-to-day agent (e.g. Jarvis). Tier: primary, type: assistant. Bound to the **general** project type. |
| **System Engineer — keeps EYAS itself healthy** | Yes | Display name for the agent that maintains EYAS itself (e.g. R2D2). Tier: primary, type: engineer. Bound to the **eyas** project type. |

What is created for each:

- an `agent_definitions` row (model, tools, workspace path, …)
- a workspace tree under `data/agents/<id>/` (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- a linked **agent user** record (`is_agent = 1`) for permissions and addressing

You can rename and reconfigure them later under **Agents**. Open them from the sidebar **Colleagues** list after the wizard. The Assistant coordinates and does not edit source; the Engineer owns platform and code. See [Teams & delegation](/docs/en/agents/teams/).

## Team Agents (optional)

**Purpose:** enable extra **colleagues** (team tier) and **specialists** (shared pool any colleague can spawn). Primary agents do not need a proposal card to call an enabled specialist.

| Control | Description |
|---------|-------------|
| **Recommended** | Highlighted template set for a typical install. |
| **Specialists** | Full catalogue of optional agent templates. |
| **Select All / Deselect All** | Bulk toggle. |
| *N selected* | Count of templates chosen. |
| **Skip / Continue** | Finish without specialists, or apply the selection. |

The selection is stored as template ids and turned into real agents (same workspace pattern as the primaries). Change it later under **Settings → Agents**.

## AI Provider

**Purpose:** make sure at least one model backend is available.

### Host CLIs (if detected)

| Control | Description |
|---------|-------------|
| Badge (*Claude Code detected and configured* / *Grok CLI …* / *Kimi Code CLI …*) | Local CLI found and usable — **no API key**. For Claude, *detected and configured* means the Claude Code runtime starts **and is signed in** (claude.ai login, `ANTHROPIC_API_KEY`, or a Bedrock/Vertex setup); `claude` merely being on PATH is not enough. See [Providers — Claude Code runtime](/docs/en/ai/providers/#claude-code-runtime). |
| **Sign in for EYAS** (Grok / Kimi) | Shown whenever Grok CLI or Kimi Code CLI is detected. EYAS runs these CLIs in its own home and does not use their login on this computer, so sign in once for EYAS here: **Sign in with a device code** (both) — open the link on any device and confirm the code, no browser needed on the server — or **Use an API key instead** (Grok, an xAI API key). See [Providers — Sign in Grok and Kimi for EYAS](/docs/en/ai/providers/#sign-in-grok-and-kimi-for-eyas). |
| **Primary CLI** | Shown when several CLIs are detected: which one is the default for agents and routing. It becomes the install's default provider and model, which also answers internal calls that name no model when no Standard tier is set — see [Routing & budget](/docs/en/ai/routing-budget/#default-binding). |
| **Use a different provider** | Switch to cloud/local API configuration. |
| **Back to detected CLIs** | Return to the CLI view. |

### Manual / API providers

| Control | Description |
|---------|-------------|
| Provider list | Known backends (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **Active / Inactive** | Whether the provider is enabled for routing. |
| **Configure / Change key** | Open the API key entry. |
| API key field (*Enter API key…*) | Secret; saved into the encrypted Secrets store. |
| **Save** | Persist the key and mark the provider usable. |
| **Re-check** | Re-probe a local endpoint (e.g. the Ollama URL). |
| **Continue / Complete Setup** | Advance even if none is active (you can finish later in Settings → Providers) — see the on-screen note. |

## AI Models

**Purpose:** assign a concrete model to each agent once a provider is ready.

| Control | Description |
|---------|-------------|
| **Agent** column | Agent name from the previous steps. |
| **Model** column | Dropdown of the active providers' models, each shown as *Provider / model* (best fit pre-selected); **— none —** leaves the agent's model as it is. |
| **Apply** | Save the assignments. Each one is sent and stored as the provider + model pair you picked, so a model id that two providers list is never ambiguous; a pair that is not in the model catalog is skipped. |
| **Go to Providers** | Jump to the full Providers page if nothing is configured. |
| **Complete Setup** | Finish the wizard and enter the main app. |

If no provider is detected (*No AI provider detected*), configure one on the Providers page after the wizard.

## After the wizard

| Destination | Why |
|-------------|-----|
| [Your first hour](/docs/en/first-hour/) | Walk the live UI: Home, one conversation, Board, Memory |
| [Home](/docs/en/daily/home/) | Setup recommendations for the remaining optional work |
| [Providers](/docs/en/ai/providers/) | Add more backends, keys, models |
| [Agents](/docs/en/agents/overview/) | Review colleagues and specialists |
| [Teams & delegation](/docs/en/agents/teams/) | How colleagues hand off and spawn specialists |
| [Users](/docs/en/admin/users/) | Add human users (if multi-user) |

## Security notes

- The master password protects **secrets**; it does not encrypt the SQLite file at rest by itself — protect the host disk and backups.
- The root owner password is independent of the master password.
- Agent “users” are not interactive logins for humans; they exist for identity and access wiring.
