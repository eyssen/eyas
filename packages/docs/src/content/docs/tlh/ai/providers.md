---
title: nobwI'pu'
description: AI 'em pat — API, juH CLI, juH QapwI'. nIteb SeH nobwI' Hoch teH ja'.
---

**nuq 'oH.** nobwI'pu' LLM 'em pat 'oH. naDev **juH Claude SeH** chu'lu' — motlh chu'Ha' — 'ej Grok/Kimi ACP ja' nIteb SeHlaHbe'.

**He:** `/providers`. Dech: **He patlh · nobwI'pu' · Huch · AI chov**. nav: **nobwI'pu'**.

## ghorgh yIlo'

- tagh rInDI': nobwI' **chu'**, ngoq, patmey.
- `claude` / `grok` / `kimi` juHDaq, CLI ngoq Hutlh.
- ja'chuq `~/.claude` qawHaq laD — **juH Claude SeH tev** **chu'Ha'**.
- Grok/Kimi ACP **reH** juH SeH tev — ngeb chu'wI' tu'lu'be'.

## motlh mIw

1. **nobwI'pu'** → Dech **nobwI'pu'**.
2. nav chu'/chu'Ha'. chaw': API ngoq ([peghmey](/docs/tlh/admin/secrets/)) pagh juH CLI.
3. patmey chu'. API/CLI chu'qa'.
4. Claude Code CLI: **juH Claude SeH tev** **chu'Ha'** yItaH, settings.json / CLAUDE.md / juH laHmey / Qu' `.mcp.json` poQbe'chugh.
5. patlh + Huch: [He 'ej Huch](/docs/tlh/ai/routing-budget/).

motlh nIteb. chu': `settingSources: ['user','project','local']`. nIteb/chu'Ha' ra' je `CLAUDE_CODE_DISABLE_AUTO_MEMORY` + `strictMcpConfig` — `settingSources: []` neH cwd qawHaq **mevbe'**. ACP nIteb De' Hutlh; grok `~/.grok` 'ej `~/.claude` tev.

## latlh

- [tagh ghojmoHwI'](/docs/tlh/setup-wizard/)
- [peghmey](/docs/tlh/admin/secrets/)
- [MCP](/docs/tlh/ai/mcp/)
- [qawHaq](/docs/tlh/knowledge/memory/)
