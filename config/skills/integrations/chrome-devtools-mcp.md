---
name: chrome-devtools-mcp
description: Use Google chrome-devtools-mcp for coding/debug on a live Chrome — console, network, Lighthouse, WebMCP. Not form-filling. Not native browser_*. Not Playwright MCP. Not agent-browser.
type: integration
trigger_patterns:
  - "chrome-devtools-mcp"
  - "chrome devtools mcp"
  - "webmcp"
  - "list_webmcp_tools"
  - "lighthouse audit"
  - "browser console errors"
  - "HAR"
  - "network requests in chrome"
  - "performance trace chrome"
capabilities:
  - chrome-devtools
  - webmcp
  - lighthouse
version: "1.0.0"
---
# Chrome DevTools MCP (coding / debug)

This sidecar is a **separate lane** from form-filling.

| Job | Tools |
|---|---|
| Public page: read, fill a form, download | Native `browser_*` (Playwright). Prefer `browser_snapshot` indexes. |
| Persistent auth / `@e1` refs | `agent_browser_status` then `agent_browser_run` (or `mcp_agent_browser_*`) |
| a11y snapshot + element refs / live tab via extension | Playwright MCP → `mcp_playwright_*` |
| Console, network/HAR, Lighthouse, performance trace, WebMCP | **This** catalog row → `mcp_chrome-devtools_*` |
| Desktop apps / OS | Hands |

Do **not** mix. If the user asked to fill a form or click through a public site, use `browser_*` even if Chrome DevTools MCP is connected. The sidecar also exposes `click` / `fill` / `fill_form` — ignore those for forms.

## When this lane

- Debug a page the agent is building: console errors, failed network calls, Lighthouse.
- Inspect HAR / `list_network_requests` / `get_network_request`.
- Run `lighthouse_audit` or a performance trace.
- Call **WebMCP** tools the *page* registered (`navigator.modelContext`), not EYAS builtins.

## Loop

1. Confirm the MCP server `chrome-devtools` is connected under Settings → MCP Servers. Tools show up as `mcp_chrome-devtools_<tool>`.
2. Prefer debug tools: `list_console_messages`, `list_network_requests`, `lighthouse_audit`, `performance_start_trace` / `performance_stop_trace`, `take_snapshot` (inspect), `evaluate_script`.
3. WebMCP, **fail-closed**:
   - Call `mcp_chrome-devtools_list_webmcp_tools` **only if that tool exists** in the discovered catalogue.
   - If it is missing: tell the user Chrome 150+ with `--enable-features=WebMCP` is required, and the catalog flag `--categoryExperimentalWebmcp=true` must stay on. Do **not** invent `list_webmcp_tools` / `execute_webmcp_tool`. Do **not** fall back to this server's `click` / `fill`.
   - If the list is empty, the page did not register WebMCP tools. Stop. That is not a reason to fill a form here.
   - `execute_webmcp_tool` only with a name from that list. Surface the sidecar error if it fails.
4. Isolated profile is the catalog default (`--isolated`). Never `--autoConnect`. Never `--user-data-dir` of the daily Chrome/Edge profile (Chrome 136+). Never `--no-sandbox`.

## Do not

- Use this server to fill forms, log into Gmail, or drive a checkout. That is `browser_*` / agent-browser.
- Attach to the operator's daily Chrome (`--autoConnect`, Default profile, `--user-data-dir` under Application Support/Google/Chrome).
- Install the Python `browser-use` MCP.
- Invent WebMCP tools when the sidecar did not advertise them.
