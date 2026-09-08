---
title: rarmey
description: Hur pat tetlh — yIn chov, vault peghmey, ghoqwI' chupmey.
---

**Qu' 'oH.** rarmey (`/connections`) *Hur patmey* (Odoo, GitHub, MCP, …) ponglu'bogh tetlh 'oH, ghoqwI'pu' SoH lajpu'DI' lo'laHbogh. [Hemey](/docs/tlh/communication/channels/) ghobe' (QIn juHmey, Telegram rur) 'ej [pegh qawHaq](/docs/tlh/admin/secrets/) ghobe' (naw' peghmey Daq). pat naDev; pegh pagh token peghmeyDaq; QIn bot Hemey bIngDaq.

**He:** `/connections`.  
bIng pong: *Hur patmey EYAS lo'laH — tetlh, yIn Dotlh, 'ej ghoqwI' chupmey.*

rarmey **ponglu'bogh tetlh** 'oH Hur patmey'e' (Odoo, GitHub, MCP, …). naw' peghmey [pegh qawHaq](/docs/tlh/admin/secrets/)Daq jaH ; ghoqwI'pu' rar **chuplaH** nuv lajvaD — MCP, laHmey, 'ej pagh peghmey SeHmey cha'be'lu'.

---

## navmey

| nav | Qu' |
|-----|-----|
| **rarmey** | QaptaH tetlh (rar / Qagh / mevta' / Sovbe'lu') |
| **tetlh** | Sovlu'bogh pat Seghmey — wa' yIwIv 'ej rar chu' |
| **loS** | ghoqwI' chup rarmey — **yIlaj** / **yIlajHa'** loS |

---

## rar tetlh

| SeHwI' / mIw | Del |
|--------------|-----|
| **N rarmey** | tetlh mI' |
| **rar yIchel** | chu' De' yIpoS (pagh tetlhvo' **yIlo'**) |
| **pong** | nuv pong rarvamvaD |
| **pat** | tetlh Segh (Odoo, GitHub, …) |
| **Dotlh** | loS / mevta' / rar / Qagh / Sovbe'lu' |
| **chenwI'** | EYAS Qum mIw: `native`, `http`, pagh `mcp` |
| **Qav chov** | Qav yIn chov poH |
| **Qagh** | Qav chov/Qagh QIn |
| **Hal** | **lo'wI'** / **ghoqwI'** / **pat** — 'Iv chu' |
| **yIchov** | yIn chenwI' yIQap (chov: naw' chov) |
| **yIchoH** | pong, SeHmey, peghmey tIchoH |
| **yIQaw'** | rar yIteq (vault pegh pat peghmey QonoSDaq pol) |

chIm: *jajvam rar tu'lu'be'. tetlhvo' yIchel pagh ghoqwI' chup yIlaj.*

---

## chu' / choH De'

| mIw | Del |
|-----|-----|
| **pong** | rarvam cha' pong |
| **pat Segh** | tetlh 'ay' (Hoch mIwDaq chu'pu'DI' choHbe'lu') |
| **SeHmey** | peghbe' mIwmey (URL, db, ghom, …) pat Segh rur |
| **peghmey** | potlh mIwmey — vaultDaq `conn-{id}-{field}` rur qonlu' ; *toDpu'DI' nom cha'qa'lu'be'* |
| **Hoch ghoqwI' lo'laH** | motlh juv cha'DI' |
| **yItoD / yIqIl** | qon pagh ngeD |

rar He: **MCP SeHmey**, **peghmey** (poQchugh).

---

## tetlh pat Seghmey

| Segh | chenwI' | motlh lo' |
|------|---------|-----------|
| **Odoo** | native | ERP / Helpdesk JSON-RPC + ticket janmey |
| **GitHub** | http | qawHaqmey, wanI'mey, PR, ngeHmey |
| **GitLab** | http | Qu'mey, wanI'mey, MR |
| **Linear** | http | wanI' / Qu' API |
| **Notion** | http | navmey 'ej De' qawHaqmey |
| **Jira** | http | Atlassian Cloud wanI'mey |
| **Slack (API)** | http | Qu' Daq bot janmey (QIn He pIm, Qum bIngDaq) |
| **MCP pat** | mcp | tetlh rar [MCP](/docs/tlh/ai/mcp/)Daq SeHlu'ta'bogh MCP patDaq yIrar |
| **Playwright MCP** | mcp | Microsoft `@playwright/mcp` chut (Apache-2.0, npx). a11y snapshot + ref; Playwright MCP Bridge extension Dech yIn. janmey MCP jIHDaq ghoS (`mcp_playwright_*`). Test fail-closed (Node 18+, npx). telemetry Qoff. `--no-sandbox` lo'Qo'. Python browser-use MCP lo'Qo'. |
| **Agent Browser** | mcp | Vercel `agent-browser` chut (Apache-2.0 CLI+MCP). `@e1` ref, state. Test fail-closed (`EYAS_AGENT_BROWSER_BIN` / PATH). `chat` lo'Qo', Chrome jaj lo'Qo'. jan: `mcp_agent_browser_*`. |
| **Chrome DevTools MCP** | mcp | Google `chrome-devtools-mcp` chut (Apache-2.0 npx). coding/debug: console, network, Lighthouse, WebMCP. form tebQo'. tetlh → Chrome DevTools MCP (`--isolated`). Test fail-closed (Node 18+, npx). `--autoConnect` 'ej Chrome jaj Qotlh. jan: `mcp_chrome-devtools_*`. WebMCP Sidecar tetlhchugh neH. |
| **Custom HTTP** | http | motlh REST bearer/API-pegh tlhej |

tetlh tlhop: *Sovlu'bogh pat Seghmey. rar chu'meH wa' yIwIv.*

### Playwright MCP (chut)

**SeHmey → MCP patmey → tetlh → Playwright MCP** yIchel, vaj Connections rar Seghvam (`mcpServerName` = `playwright`) — **Test** doctor lI'laH.

- ghoqwI' janmey MCP jIHDaq ghoS: `mcp_playwright_*`. LLM mIw cha' Qo'.
- Dech yIn: Playwright MCP Bridge extension, `--extension` `--isolated` moj. Chrome/Edge jaj profile lo'Qo'.
- doctor fail-closed, Hyperframes CLI rap: Node 18+ pagh npx Hutlhchugh Test Hergh tlhej QIH. telemetry Qoff (`DO_NOT_TRACK=1`).
- `--no-sandbox` / `PLAYWRIGHT_MCP_NO_SANDBOX` lo'Qo'. Python `browser-use` MCP (`uvx browser-use --mcp`) lo'Qo' — LLM pegh poQ 'ej `retry_with_browser_use_agent` qem.

### Chrome DevTools MCP (chut, coding / debug)

**SeHmey → MCP patmey → tetlh → Chrome DevTools MCP** yIchel, vaj Connections rar (`mcpServerName` = `chrome-devtools`).

- jan: `mcp_chrome-devtools_*`. form tebQo' — `browser_*` vetlh.
- tetlh: `--isolated`, telemetry Qoff, `--categoryExperimentalWebmcp=true`.
- WebMCP Sidecar chaw'chugh neH (Chrome 150+). Hutlh jan chenmoHQo'.
- `--autoConnect` 'ej `--no-sandbox` Test QIH. Chrome jaj profile lo'Qo'.

headless `browser_*`, CLI sidecar 'ej coding/debug MCP: [Browser Use](/docs/tlh/automation/browser-use/).

---

## loS chupmey

ghoqwI'pu' janmey lo'laH rar **chupmeH**. **loS** navDaq meq + SeHmey Dabej:

| SeHwI' | Del |
|--------|-----|
| **meq** | qatlh ghoqwI' rarvam neH |
| **yIlaj** | rar yIchu' / yIpoSmoH |
| **yIlajHa'** | chup yIteq |

loS chIm: *loS chup tu'lu'be'.*

---

## ghoqwI' janmey

rarmey patHom lIHlu'chugh, ghoqwI'pu' lo'laH:

| jan | Qu' |
|-----|-----|
| `connections_list` | tetlh yIcha' |
| `connections_catalog` | tetlh Seghmey yIcha' |
| `connections_test` | rar yIn yIchov |
| `connections_propose` | rar chu' lajvaD yIchup |

---

## latlh

- [peghmey](/docs/tlh/admin/secrets/)
- [MCP patmey](/docs/tlh/ai/mcp/)
- [Browser Use](/docs/tlh/automation/browser-use/)
- [janmey](/docs/tlh/automation/tools/)
- [SeHmey Del](/docs/tlh/admin/settings/)
