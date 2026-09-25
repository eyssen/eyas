---
title: laHmey
description: laH tetlh — Hal, wIv, De' tetlh, auto-lo', ja'chuq chup.
---

**nuq 'oH.** laH 'oH Markdown mIw tev'e', Qu' rapDI' tagh pabmey ghoqwI' tev. jajvam tetlh 'oH. jan 'oHbe'. janmey ra'lu'; laHmey ja' *chay'*.

**He:** `/skills`. Dech: **nej** · **De' tetlh**. nav: **laHmey**.

## ghorgh yIlo'

- vumqa' mIw (Odoo He, runbook, juH pab).
- latlh QaHwI'vo' qemlu' — 'Iv laH id lo'lu'.
- ja'chuq laH chup — ghobe' pagh HochDaq chu'Ha'.
- chenmoHlu' laHmey nargh — chay' yInchoH pagh yInchoHbe'.

## motlh mIw

1. **laHmey** (`/skills`).
2. **nej**: **Hoch / lo'wI' laHmey / chellu'**, vaj **laH yIchu'**.
3. **laH pong**, **tagh pabmey**, **ghItlh / chenmoH**.
4. **De' tetlh**: 'Iv copy Qap, lo' mI', chu'lu'.
5. ja'chuqDaq tlheD loS. **yIlo'**, **DaH ghobe'**, pagh (joH/SeHwI') **yIchu'Ha'**.

## laHmey

rapbogh laH **chup 'oH, tlheD loS**. jangpa' pagh qaS. **yIlo'** / **DaH ghobe'** (ja'chuqvam neH) / **yIchu'Ha'** (Hoch; joH/SeHwI' neH). 0.8.15: wejDIch button Hoch 'oH. [ja'chuq](/docs/tlh/daily/conversations/).

auto-lo': chenmoHlu'/choHbogh laHmey **yInchoHbe'** benchmark snapshot min pass ratio + average score Hutlhchugh. lo'wI' chu' / chu' lo'be' lojmItvam.

**De' tetlh:** wa' tetlh skill id Hoch. patlh **User > Generated > Imported (`skills.importRoots`) > Bundled (cheltaHghach) > Bundled (EYAS)**. qach laHmey Claude Codevo' 'elbe' — reH nIteb Qap. latlh pa'mey `local.yaml`Daq (`skills.importRoots` / `agent.importRoots`, motlh **tetlh chIm**) — [bIng](#import-roots). tu'wI' **chup neH**: Hubbe', So'lu', lo'lu'pu'be' (0, 90 jaj tIQ), Qong (180+). [SeH'egh](/docs/tlh/agents/autonomy/). **chu'Ha', teqbe'.** Hubbe'/So'lu' DaH; lo'lu'pu'be'/Qong 30 jaj; lo'wI' laHmey poH chutmeyvo' tlhejbe'.

<h3 id="import-roots">latlh laH Sormey yItlhap</h3>

`local.yaml`Daq latlh markdown pa'mey yItetlh (`skills.importRoots`, `agent.importRoots`); motlh **tetlh chIm**. He'mey lIngDaq yIn, ngaSlu'bogh `src/`Daq not. tlhaplu'bogh laHmey ngaSlu'bogh cha'DIch laHmey nIv. `agent.importRoots`vo' qa'mey UIDaq markdown rur 'anglu', ngoqDaq pong ghobe'.

Sormeyvam **Hoch taghDI'** laDlu', vaj yIn Hal 'oH chaH — motlh pa'meyvaD neH, ghom pa' `/opt/team-skills` rur. latlh QaHwI' pagh ghItlhHom ghun pa''egh qoDDaq tu'lu'bogh, pagh ngaSbogh, Sor **buSHa'lu'**: `~/.claude` (laHmey, ghoqwI'pu', plugins), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot`, `~/.agents`, `~/.config/agents`, OpenCode pa'mey, Obsidian SeHmey vaultmey je, `security.foreignMemoryPaths`, 'ej EYAS CLI juHmey'egh. juH pa'lIj naQ rurbogh Sor buSHa'lu' je, chaH ngaSmo'. taghDI' Hoch buSHa'lu'bogh Sor ghuHmoHwI' log, 'ej `eyas doctor`Daq **Import roots** ghuHmoHwI' rur 'ang.

pa'vetlhvo' tlhaplu'pu'bogh laHmey EYASDaq taH; pa'vetlhvo' chu'qa'be' neH. De'vetlh DaqemmeH, pagh Dachu'qa'meH, pa' [De' tlhap](/docs/tlh/admin/data-port/) wa'logh yIQap — Hal qonlu'taHvIS EYASDaq qonqa'lu' — ghIq `local.yaml`vo' Doch yIteq. [SeH — latlh laH qa' Sormey je](/docs/tlh/deploy/configuration/#extra-skill-and-persona-roots).

## latlh

- [janmey](/docs/tlh/automation/tools/)
- [ghoj'egh](/docs/tlh/automation/self-learning/)
- [SeH'egh](/docs/tlh/agents/autonomy/)
- [ja'chuq](/docs/tlh/daily/conversations/)
- [tej](/docs/tlh/automation/research/)
