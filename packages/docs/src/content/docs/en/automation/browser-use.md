---
title: Browser Use
description: Headless Playwright tools for public pages, and an optional CLI sidecar for the Chrome you already logged into.
---

**What this is for.** Related surfaces, one model. Headless `browser_*` tools let an agent open public pages in EYAS’s own Chromium — snapshot numbered controls, fill forms, download files into Documents. The **Browser Use** screen (`/browser-use`) has two optional CLI sidecars for **persistent auth**: **Agent Browser** (recommended — Vercel `agent-browser`, Apache-2.0, `@e1` refs) and the legacy Python Browser Use CLI. **Playwright MCP** is an optional [Connections](/docs/en/admin/connections/) catalog row for a11y refs. **Chrome DevTools MCP** is a separate coding/debug catalog row (console, network, Lighthouse, WebMCP) — not form-filling. None of these paths import a third-party LLM SDK. EYAS still owns the model. Never `agent-browser chat`, never the Python browser-use MCP.

**Route:** `/browser-use`. Sidebar: **AI → Browser Use**. Catalogue of the headless tools: [Tools](/docs/en/automation/tools/) (`/tools`).

## When to use it

- You want the agent to read or fill a **public** page (docs, search, a form) without attaching to your daily Chrome.
- A download should land in [Documents](/docs/en/knowledge/documents/) on the conversation that produced it.
- You need the Chrome you are **already logged into** (admin UI, mail, 2FA done) — that is the sidecar, not headless.
- A tool call was blocked and you need to see whether the sidecar is **Ready** or **Not ready**, and the remedy.

## Typical workflow

1. Open **Tools** (`/tools`). Search `browser_`. Prefer `browser_snapshot` indexes over CSS.
2. Assign those tool ids on the agent **Configuration** tab. See [Configure](/docs/en/agents/configure/).
3. For a public page: the agent navigates, snapshots, acts by index, and snapshots again after every navigation.
4. For persistent auth: open **Browser Use** (`/browser-use`). Prefer the **Agent Browser** card. If it says **Not ready**, install the CLI (`npm i -g agent-browser` then `agent-browser install`, or `EYAS_AGENT_BROWSER_BIN`). Then `agent_browser_status` then `agent_browser_run`. The Python card is the legacy sidecar.
5. Desktop apps that are not a browser: [Hands](/docs/en/admin/hands/).

## Features

### Lanes

| Job | Where | Tools |
|-----|-------|-------|
| Public page, headless | [Tools](/docs/en/automation/tools/) catalogue | `browser_*` — Playwright, numbered indexes, EYAS-owned profile |
| Persistent auth, `@e1` refs (recommended sidecar) | this screen, `/browser-use` | `agent_browser_status` then `agent_browser_run` (or `mcp_agent_browser_*`) |
| Legacy Python CLI | this screen, second card | `browser_use_status` then `browser_use_exec` |
| a11y-ref MCP sidecar / live tab | [Connections](/docs/en/admin/connections/) + [MCP](/docs/en/ai/mcp/) catalog | `mcp_playwright_*` after Playwright MCP is connected |
| Coding/debug: console, network, Lighthouse, WebMCP | [Connections](/docs/en/admin/connections/) + [MCP](/docs/en/ai/mcp/) catalog | `mcp_chrome-devtools_*` after Chrome DevTools MCP is connected — **not** form-filling |
| Desktop OS | [Hands](/docs/en/admin/hands/) | Hands tools |

<h2 id="headless">Headless Playwright (browser_*)</h2>

No Python. Same Chromium as the design print pipeline. The **process** lasts 5 minutes; cookies survive in `data/browser/profile` (or `EYAS_BROWSER_USER_DATA_DIR`). That directory is **never** your daily Chrome/Edge profile — Chrome 136+ refuses CDP on Default, and EYAS refuses it first.

| Tool | What it does |
|------|----------------|
| `browser_navigate` | Open an http(s) URL. **SSRF** blocks private/metadata hosts |
| `browser_snapshot` | Accessibility tree + numbered interactive list + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | Act by **index** (preferred) or CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` — cannot close the last tab |
| `browser_back` | History back (invalidates indexes) |
| `browser_wait` | Wait for selector, URL, load state, or timeout (max 30 s) |
| `browser_dialog` | Arm accept/dismiss **before** the click that opens `alert`/`confirm`/`prompt` |
| `browser_upload` | File input — workspace paths and/or Documents ids |
| `browser_evaluate` | JavaScript **in the page**, not in Node. JSON result capped at 50k |
| `browser_download` | Next download → Documents, linked to this conversation |
| `browser_storage` | Save/load Playwright `storageState` (cookies + origins) |
| `browser_replay` / `browser_action_cache` | Replay a **saved locator** on the next run (no LLM). JSON in the project vault folder, else `procedural/browser-action-cache.json`. Never Stagehand, never fill values or TOTP seeds |
| `browser_totp` | 6-digit TOTP from [Secrets](/docs/en/admin/secrets/) (or macOS Keychain). Pass the code to `browser_fill`. Yellow. The seed is never returned |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Capture, text, end the process (the profile stays on disk) |

Indexes and `snapshotId` die on navigation or back. Snapshot again. A successful click/fill with `intent: "click Submit"` stores a durable CSS/role locator (not the index); `browser_replay` uses that locator on the same origin. Downloads appear under **Documents** (`/documents`). Dangerous calls still wait on [approval](/docs/en/admin/security-privacy/).

Use this lane for public pages. Use the sidecar when you need the Chrome you already logged into.

<h2 id="agent-browser">Agent Browser (recommended sidecar)</h2>

Optional Vercel `agent-browser` CLI (Apache-2.0). EYAS does **not** vendor the Rust crate. The binary is resolved `EYAS_AGENT_BROWSER_BIN` → settings path → `agent-browser` on PATH. A set-but-missing env path is refused (no PATH fallback). Missing binary, timeout, or `doctor --offline --quick --json` with `ok: false` → **Not ready** with a remedy. No npx auto-install.

Install: `npm i -g agent-browser` then `agent-browser install`, or `brew install agent-browser` then `agent-browser install`.

The agent calls `agent_browser_status` then `agent_browser_run` with `argv` (for example `["snapshot","-i"]`, `["click","@e1"]`) or `batch` JSON. Snapshot refs are `@e1`. Auth persistence is `state save` / `state load` under `data/browser/agent-browser/`. The profile is EYAS-owned (`data/browser/agent-browser/profile`). Never `--profile Default`, never the daily Chrome/Edge profile (Chrome 136+). Never `--auto-connect` / `--cdp` to the Chrome you use every day. Never `--no-sandbox`. Never `chat` (that is a Vercel AI Gateway loop — EYAS already has a model). `AI_GATEWAY_*` is stripped on spawn.

Optional MCP: **Settings → MCP Servers → Catalog → Agent Browser** (`agent-browser mcp --tools core,state`). `--tools all` / `debug` are rewritten because they include `chat`. Tools arrive as `mcp_agent_browser_*`. Test is fail-closed, like Hyperframes CLI.

<h2 id="sidecar">Python CLI (legacy)</h2>

The extra module still wraps the MIT Browser Use **CLI**. It does not vendor that project’s Python library or LLM SDKs. Telemetry is always off. The Cloud API key is stripped unless you turn Cloud on in settings. Never `--no-sandbox`. Prefer Agent Browser when that card is Ready.

Requirements:

- Python 3.11+
- `browser-use` on PATH, `uvx`, or `EYAS_BROWSER_USE_BIN`

If a check is **Missing**, the empty copy says the CLI is not ready — install the remedy, then ask the agent to use `browser_use_exec`. Do not invent a CDP URL.

<h2 id="playwright-mcp">Playwright MCP (Connections)</h2>

Optional Microsoft `@playwright/mcp` (Apache-2.0). Install from **Settings → MCP Servers → Catalog**, then optionally track it as a [Connections](/docs/en/admin/connections/) row of type **Playwright MCP**. **Test** is fail-closed (Node 18+, npx), like Hyperframes CLI. Telemetry off (`DO_NOT_TRACK=1`). `--no-sandbox` is stripped and refused.

The agent does not get a second LLM loop. Tools arrive through the existing MCP bridge as `mcp_playwright_*` (accessibility snapshot + element refs). For a live Chrome/Edge tab, install the Playwright MCP Bridge extension and switch args to `--extension` (drop `--isolated`). Never the daily Chrome profile.

Do **not** install the Python `browser-use` MCP (`uvx browser-use --mcp`). It asks for an LLM API key and exposes `retry_with_browser_use_agent`. EYAS rejects that sidecar on add/connect.

<h2 id="chrome-devtools-mcp">Chrome DevTools MCP (coding / debug)</h2>

Optional Google `chrome-devtools-mcp` (Apache-2.0). Install from **Settings → MCP Servers → Catalog → Chrome DevTools MCP**, then optionally track it as a [Connections](/docs/en/admin/connections/) row of type **Chrome DevTools MCP**. **Test** is fail-closed (Node 18+, npx). Telemetry off (`DO_NOT_TRACK=1`, `--no-usage-statistics`, `--no-performance-crux`). `--no-sandbox` is stripped and refused. `--autoConnect` is refused (daily Chrome, Chrome 136+). Catalog uses `--isolated`.

This is **not** the form-filling lane. Do not use this server’s `click` / `fill` / `fill_form` for forms — that stays `browser_*`. Tools arrive through the existing MCP bridge as `mcp_chrome-devtools_*` (console, network, Lighthouse, performance).

**WebMCP is fail-closed.** Catalog enables `--categoryExperimentalWebmcp=true`. `list_webmcp_tools` / `execute_webmcp_tool` appear **only if the sidecar advertises them** (Chrome 150+ with `--enable-features=WebMCP`, and the page registered `navigator.modelContext` tools). If they are missing, EYAS does not invent them. An empty list means the page exposed no WebMCP tools — that is not a reason to click/fill here.

## Fields and controls

<h2 id="status">Status card</h2>

| Control | Meaning |
|---------|---------|
| Title | **Browser Use** |
| Subtitle | *Optional CLI sidecars for persistent auth.* |
| Lane hint | Headless `browser_*`; Agent Browser (recommended); Python CLI (legacy); Hands |
| Cards | **Agent Browser** (Recommended) and **Browser Use CLI (Python)** |
| Badge | **Ready** / **Not ready** per card |
| Empty | Remedy on the card that is not ready |
| Check row | Label + **OK** / **Missing** / **Warning**, optional detail, and a remedy when not OK |
| Help **?** | Opens this chapter |

This screen does not run tasks. The agent calls `agent_browser_run` or `browser_use_exec` after the matching card is ready.

## Related

- [Tools](/docs/en/automation/tools/)
- [Connections](/docs/en/admin/connections/)
- [MCP servers](/docs/en/ai/mcp/)
- [Documents](/docs/en/knowledge/documents/)
- [Hands](/docs/en/admin/hands/)
- [Security & privacy](/docs/en/admin/security-privacy/)
- [Configuration](/docs/en/deploy/configuration/) (`EYAS_BROWSER_USER_DATA_DIR`, `EYAS_AGENT_BROWSER_BIN`)
