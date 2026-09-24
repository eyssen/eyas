---
name: browser-use
description: Drive a logged-in or persistent-auth browser through optional CLI sidecars. Prefer agent-browser (@e1 refs) when Ready. Not the headless Playwright browser_* tools, not Chrome DevTools MCP (coding/debug), not Hands, not Studio.
type: integration
trigger_patterns:
  - "browser-use"
  - "agent-browser"
  - "logged in chrome"
  - "real browser"
  - "fill this form in chrome"
  - "use my cookies"
capabilities:
  - real-chrome
  - cdp
version: "1.2.0"
---
# Browser Use (sidecars)

Lanes:

| Job | Tools |
|---|---|
| Headless page, public URL | `browser_*` (Playwright). Prefer `browser_snapshot` indexes over CSS. Indexes die on navigation — snapshot again. Profile is EYAS-owned, never the daily Chrome profile. |
| Persistent auth, `@e1` refs, domain allowlist | `agent_browser_status` then `agent_browser_run` (recommended). If the Agent Browser MCP server is connected, `mcp_agent_browser_*` is also fine. |
| Legacy Python CLI (already installed) | `browser_use_status` then `browser_use_exec` |
| Desktop apps / OS | Hands |
| Console / network / Lighthouse / WebMCP (coding/debug) | Chrome DevTools MCP → `mcp_chrome-devtools_*`. **Not this skill.** See `chrome-devtools-mcp`. Do not fill forms there. |

## Loop (agent-browser, preferred)

1. `agent_browser_status`. If a check is `missing`, tell the user the remedy (`npm i -g agent-browser` then `agent-browser install`, or `EYAS_AGENT_BROWSER_BIN`). Do not invent CDP. Do not call `chat`.
2. `agent_browser_run` with `argv` such as `["open","https://example.com"]`, `["snapshot","-i"]`, `["click","@e1"]`, `["fill","@e2","text"]`, `["state","save", "<path under data/browser/agent-browser>"]`. Or `batch` as `string[][]` (JSON stdin to `batch --json`).
3. Snapshot again after navigation. Refs look like `@e1`.
4. Do not pass `--profile Default`, `--auto-connect`, `--cdp`, `--no-sandbox`, or `chat`.

## Loop (Python CLI, legacy)

1. `browser_use_status`. If a check is `missing`, tell the user the remedy. Do not invent CDP.
2. `browser_use_exec` with Python using CLI 3.0 helpers: `new_tab`, `goto_url`, `page_info`, `click_at_xy`, `type_text`, `fill_input`, `js`, `capture_screenshot`.
3. Print results. Do not call an LLM from the Python.

## Do not

- Import OpenAI/Anthropic/ChatBrowserUse or call `agent-browser chat`. EYAS already has a model.
- Pass `--no-sandbox`.
- Point `--profile` at the daily Chrome/Edge profile (Chrome 136+).
- Use a sidecar for public pages that `browser_*` can handle.
- Enable Browser Use Cloud unless the user asked.
- Install the Python `browser-use` MCP or the npm `mcp-agent-browser` wrapper.
- Use Chrome DevTools MCP (`mcp_chrome-devtools_*`) to fill forms. That sidecar is coding/debug (console, HAR, Lighthouse, WebMCP).
