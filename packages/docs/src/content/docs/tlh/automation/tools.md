---
title: janmey
description: ra'laH laH tetlh — QIH, chaw', nob.
---

**nuq 'oH.** janmey ta' ghoqwI' ta'laHbogh. jajvam yIn tetlh 'oH. nob ghoqwI' **SeH** DechDaq Qam; naDev pong, Segh, QIH, chaw' loS 'e' yIbej.

**He:** `/tools`. nav: **janmey**.

## ghorgh yIlo'

- ghoqwI'Daq idmey ghItlhpa'.
- ra' botlu' — QIH patlh + **chaw' poQ**.
- MCP pagh rar — tu'lu' janmey 'ang.
- 'el chenmoH poQ — ghoqwI' Qagh.

## motlh mIw

1. **janmey** (`/tools`).
2. nej pagh Segh / QIH wIv.
3. **chenmoH yI'ang** JSON vaD.
4. id ghoqwI' **SeH** DechDaq. [SeH](/docs/tlh/agents/configure/).
5. QIH ra'mey [Hub lojmIt](/docs/tlh/admin/security-privacy/) ghoS.

## laHmey

mInDu': jan mI' + chaw' poQ mI'. Seghmey `system`/`file`/`network`/`compute`/`data`. tetlh QIH **green / yellow / red**. ghItlh Daq (`read_file`, `edit_file`, `grep`, `glob`, `git_status`/`git_diff`, `run_command` — He'mey **vum pa'mey**Daq ngaQ). `run_command`/`Bash` `git status` pagh `git diff` (metachar Hutlh, `-C`/`--git-dir` Hutlh, naQ He Hutlh) SuD janvaD choH — **qIH Hutlh**. `git commit` / `git add` / `ls` Doq taH. nej/`needsPin`, qawHaq 'ay'mey + `search_memory`/`save_memory` (`scope` motlh `current`: Qu'vam + Segh + Hoch user/feedback/reference; `all` = latlh Qu'mey; qawHaq jaj nej pe'be'), QIn draft→chaw'→ngeH, Odoo chaw', rar tetlh. **nagh beQ** (chaw'): `media_generate`, `media_wait`, `media_catalog`, `media_balance`, `media_history` — [nagh beQ](/docs/tlh/ai/media/). jIH Qum chIch jan 'oHbe': Recordly AGPL tlhej [cheltaHghachmey](/docs/tlh/admin/extensions/#recordly) — `recordly_*` tu'lu'be'. CLI MCP rap: [MCP](/docs/tlh/ai/mcp/).

<h3 id="browser">Internet jan</h3>

Playwright jan chIm (`browser_*`): SSRF; `browser_snapshot` mI' + `snapshotId` jaHtaHvIS Hegh; Dechmey, back, wait, hover, select, ja'chuq, upload, `evaluate` jaj neH, download → ghItlhmey, `storageState`. `browser_replay` / `browser_action_cache` locator pol (JSON project pagh vault, LLM Hutlh, teb Hutlh). `browser_totp` (SuD) peghmey/Keychain ngoq laD, mI' `browser_fill` nob. `data/browser/profile` — Chrome jaj profile lo'Qo' (Chrome 136+). [Browser Use](/docs/tlh/automation/browser-use/): `agent_browser_*` qel, `browser_use_*` ngugh.

chIm: *jan tu'lu'be'.*

## latlh

- [ghoqwI'pu' — janmey](/docs/tlh/agents/configure/)
- [Hub lojmIt](/docs/tlh/admin/security-privacy/)
- [rarmey](/docs/tlh/admin/connections/)
- [laHmey](/docs/tlh/automation/skills/)
- [MCP Servers](/docs/tlh/ai/mcp/)
- [nagh beQ](/docs/tlh/ai/media/)
- [mIw pa'](/docs/tlh/studio/)
- [cheltaHghachmey](/docs/tlh/admin/extensions/#recordly)
