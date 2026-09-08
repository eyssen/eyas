---
title: MCP Servers
description: Model Context Protocol — yIn jan, tetlh, CLI jan rap.
---

**nuq 'oH.** MCP *Hur jan tevmey* rar. tu'lu' janmey motlh janmey rur noblu'. ja'chuq [He](/docs/tlh/communication/channels/) 'oHbe', [rar](/docs/tlh/admin/connections/) 'oHbe' — MCP jan rar je chenlaH.

**He:** `/mcp-settings`. Dech: **yIn** · **tetlh**. nav: **MCP Servers**.

## ghorgh yIlo'

- janmey EYAS qengbe'.
- wa' qIj (API ngoq) ra' ghItlhbe'.
- Grok/Kimi CLI ToolExecutor Daq rap tu'.
- jan rarHa' — **chov**.

## motlh mIw

1. **MCP Servers**.
2. **tetlh**: SuH / wa' qIj / lo'wI'.
3. **lIng** pagh **MCP jan yIchel** (stdio/HTTP/SSE).
4. **yIn**: connected, **chov**, jan/De'/mu'tlhegh tu'lu'.
5. idmey ghoqwI' **SeH** DechDaq.

copyleft/proprietary **nIteb Qap** — EYAS MIT taH. CLI rap: Claude Code in-process MCP; Grok/Kimi stdio MCP + He `/api/v1/internal/cli-mcp/*`.

**ngoQ:** pagh / Bearer (API ngaq) / OAuth (De'wI'). **SSE** qeng Streamable HTTP 'oH — `/sse` yIchelQo'; EYAS session header Qap.

Magnific, Higgsfield, fal [nagh beQ](/docs/tlh/ai/media/)Daq rar; ghoqwI' vagh `media_*` jan lo', nobwI' MCP tetlh ngeb lo'be'.

**Chrome DevTools MCP** (Google, Apache-2.0) **DevTools** tetlh: `npx -y chrome-devtools-mcp@latest --isolated`, telemetry Qoff, `--categoryExperimentalWebmcp=true`. coding/debug neH (console, network, Lighthouse, WebMCP) — form tebQo'. jan: `mcp_chrome-devtools_*`. WebMCP Sidecar chaw'chugh neH. `--autoConnect` 'ej Chrome jaj profile Qotlh. yIlaD [Browser Use](/docs/tlh/automation/browser-use/#chrome-devtools-mcp).

## latlh

- [janmey](/docs/tlh/automation/tools/)
- [nagh beQ](/docs/tlh/ai/media/)
- [ghoqwI' SeH](/docs/tlh/agents/configure/)
- [rarmey](/docs/tlh/admin/connections/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
