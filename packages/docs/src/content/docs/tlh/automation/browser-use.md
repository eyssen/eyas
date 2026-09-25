---
title: Browser Use
description: Playwright jan chIm naw' lI'be'. CLI sidecar optional Chrome lI'vaD.
---

**nuqDaq lI'.** cha' Dech. Headless `browser_*` EYAS ChromiumDaq naw' chIm poSmoH — mI' ra', form, download ghItlhmeyDaq. **Browser Use** (`/browser-use`) sidecar optional 'oH: **lI'** Chrome CDP lo', cookie 2FA pItlh. LLM SDK Hop. EYAS model taH.

**He:** `/browser-use`. nav: **AI → Browser Use**. jan chIm tetlh: [janmey](/docs/tlh/automation/tools/) (`/tools`).

## ghorgh yIlo'

- ghoqwI' naw' **chIm** laD pagh teb — Chrome jaj Hutlh.
- download [ghItlhmey](/docs/tlh/knowledge/documents/) jaH 'ej jawwI' rar.
- Chrome **lI'** poQ — sidecar 'oH, jan chIm 'oHbe'.
- ra' botlu'; **ghuH** / **ghuHbe'** 'ej Hergh legh.

## motlh mIw

1. **janmey** (`/tools`). `browser_` yInej. mI' CSS Hop, `browser_snapshot`.
2. idmey ghoqwI' **SeH** DechDaq. [SeH](/docs/tlh/agents/configure/).
3. naw' chIm: jaH, snapshot, mI' yI'uy, jaHtaHvIS snapshot chu'.
4. Chrome lI': **Browser Use** (`/browser-use`). **ghuHbe'** chugh, check Hutlh tIchel (Python 3.11+, CLI PATH). vaj `browser_use_status` 'ej `browser_use_exec`.
5. Internet jan 'oHbe': [ghopDu'](/docs/tlh/admin/hands/).

## laHmey

### loS mIw

| Qu' | nuqDaq | janmey |
|-----|--------|--------|
| naw' chIm, headless | [janmey](/docs/tlh/automation/tools/) | `browser_*` — Playwright, mI', EYAS profile |
| yIn lI', `@e1` (sidecar qel) | Dechvam, `/browser-use` | `agent_browser_status` 'ej `agent_browser_run` (pagh `mcp_agent_browser_*`) |
| Python CLI ngugh | Dechvam, Dech cha' | `browser_use_status` 'ej `browser_use_exec` |
| a11y-ref MCP sidecar / Dech yIn | [rarmey](/docs/tlh/admin/connections/) + [MCP](/docs/tlh/ai/mcp/) tetlh | `mcp_playwright_*` Playwright MCP rarlu'chugh |
| coding/debug: console, network, Lighthouse, WebMCP | [rarmey](/docs/tlh/admin/connections/) + [MCP](/docs/tlh/ai/mcp/) tetlh | `mcp_chrome-devtools_*` Chrome DevTools MCP rarlu'chugh — form tebQo' |
| desktop | [ghopDu'](/docs/tlh/admin/hands/) | ghopDu' |

<h2 id="headless">Playwright jan chIm (browser_*)</h2>

Python Hutlh. Chromium rap design print. **mIw** 5 tup; cookie `data/browser/profile` (pagh `EYAS_BROWSER_USER_DATA_DIR`) taH. Chrome/Edge jaj profile **lo'Qo'** — Chrome 136+ Default CDP Qotlh; EYAS wa'DIch Qotlh.

| jan | nuq ta' |
|-----|---------|
| `browser_navigate` | http(s) URL. **SSRF** private/metadata jan |
| `browser_snapshot` | accessibility qach + tetlh mI' + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | **mI'** (maS) pagh CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` — Qav Dech Qaw'be' |
| `browser_back` | chol (mI'mey Hegh) |
| `browser_wait` | selector, URL, load pagh timeout (30 lup 'aqro') |
| `browser_dialog` | accept/dismiss **pa'** 'uy `alert`/`confirm`/`prompt` poSmoH |
| `browser_upload` | tej Dech — workspace He pagh Documents id |
| `browser_evaluate` | JavaScript **jajDaq**, NodeDaqbe'. JSON 50k 'aqro' |
| `browser_download` | download veb → ghItlhmey, jawwI' rar |
| `browser_storage` | Playwright `storageState` pol/laD |
| `browser_replay` / `browser_action_cache` | locator qaw'lu'bogh LLM Hutlh. JSON project vault, pagh `procedural/browser-action-cache.json`. Stagehand lo'Qo'; teb/TOTP ngoq qaw'Qo' |
| `browser_totp` | jav mI' TOTP [peghmey](/docs/tlh/admin/secrets/) (pagh macOS Keychain). ngoq `browser_fill` nob. SuD. ngoq nI' choltbe' |
| `browser_screenshot` / `browser_get_content` / `browser_close` | mIllogh, bI'reS, mIw van (profile taH) |

mI' 'ej `snapshotId` jaHtaHvIS Hegh. snapshot chu'. Qap click/fill `intent` CSS/role locator pol; `browser_replay` origin rap lo'. download **ghItlhmey** (`/documents`). ra' QIH [chaw'](/docs/tlh/admin/security-privacy/) loS.

<h2 id="agent-browser">Agent Browser (sidecar qel)</h2>

Vercel `agent-browser` chut (Apache-2.0). Rust vendorQo'. `EYAS_AGENT_BROWSER_BIN` → PATH. He tu'lu' 'ach Hutlh chugh fail-closed. `npm i -g agent-browser` 'ej `agent-browser install`. lIw: `agent_browser_status` 'ej `agent_browser_run` `argv` (`["snapshot","-i"]`, `["click","@e1"]`) pagh `batch`. profile: `data/browser/agent-browser/profile`. Default / Chrome jaj lo'Qo' (Chrome 136+). `chat` lo'Qo', `--no-sandbox` lo'Qo'. MCP tetlh **Agent Browser** (`mcp --tools core,state`) → `mcp_agent_browser_*`.

<h2 id="sidecar">Python CLI (ngugh)</h2>

extra module MIT Browser Use **CLI** So' taH. Python lib vendorQo'. LLM SDK Qo'. telemetry Qoff. Cloud Key chaw'chugh neH. `--no-sandbox` lo'Qo'. Agent Browser ghuH chugh, vetlh yImaS.

poQ: Python 3.11+ 'ej `browser-use` PATH, `uvx` pagh `EYAS_BROWSER_USE_BIN`.

check **Hutlh** chugh, CLI ghuHbe' — Hergh tIchel, vaj `browser_use_exec`. CDP URL chenmoHQo'.

<h2 id="playwright-mcp">Playwright MCP (rarmey)</h2>

Microsoft `@playwright/mcp` chut (Apache-2.0). **SeHmey → MCP patmey → tetlh** yIchel, vaj [rarmey](/docs/tlh/admin/connections/) **Playwright MCP** rar. **Test** fail-closed (Node 18+, npx), Hyperframes CLI rap. telemetry Qoff (`DO_NOT_TRACK=1`). `--no-sandbox` teqlu' 'ej Qotlh.

LLM mIw cha' Qo'. janmey MCP jIHDaq ghoS: `mcp_playwright_*`. Dech yIn: Playwright MCP Bridge extension 'ej `--extension` (`--isolated` Hutlh). Chrome jaj profile lo'Qo'.

Python `browser-use` MCP (`uvx browser-use --mcp`) yIchelQo'. LLM pegh poQ 'ej `retry_with_browser_use_agent` qem. EYAS add/connectDaq Qotlh.

<h2 id="chrome-devtools-mcp">Chrome DevTools MCP (coding / debug)</h2>

Google `chrome-devtools-mcp` chut (Apache-2.0). **SeHmey → MCP patmey → tetlh → Chrome DevTools MCP** yIchel, vaj [rarmey](/docs/tlh/admin/connections/) **Chrome DevTools MCP** rar. **Test** fail-closed (Node 18+, npx). telemetry Qoff. `--no-sandbox` Qotlh. `--autoConnect` Qotlh (Chrome jaj, Chrome 136+). tetlh `--isolated` lo'.

form He **'oHbe'**. `click` / `fill` / `fill_form` formvaD lo'Qo' — `browser_*` vetlh. janmey MCP jIHDaq ghoS: `mcp_chrome-devtools_*` (console, network, Lighthouse).

**WebMCP fail-closed.** tetlh: `--categoryExperimentalWebmcp=true`. `list_webmcp_tools` / `execute_webmcp_tool` Sidecar chaw'chugh neH (Chrome 150+, `--enable-features=WebMCP`). Hutlhchugh, EYAS chenmoHQo'.

## Dechmey

<h2 id="status">Dotlh chaw'</h2>

| Dech | QIj |
|------|-----|
| pong | **Browser Use** |
| pongHom | CLI sidecar optional Chrome lI' CDP |
| mIw qech | `browser_*` chIm; sidecar lI'; ghopDu' latlh |
| Badge | **ghuH** / **ghuHbe'** |
| chIm | *Browser Use CLI ghuHbe'…* |
| check | pong + **lugh** / **Hutlh** / **ghuHmoH**, De', Hergh |
| **?** | Dechvam poSmoH |

Dechvam Qu' taghbe'. ghoqwI' `browser_use_exec` lo' ghuHchugh.

## latlh

- [janmey](/docs/tlh/automation/tools/)
- [rarmey](/docs/tlh/admin/connections/)
- [MCP patmey](/docs/tlh/ai/mcp/)
- [ghItlhmey](/docs/tlh/knowledge/documents/)
- [ghopDu'](/docs/tlh/admin/hands/)
- [Hub 'ej He](/docs/tlh/admin/security-privacy/)
- [SeH](/docs/tlh/deploy/configuration/) (`EYAS_BROWSER_USER_DATA_DIR`)
