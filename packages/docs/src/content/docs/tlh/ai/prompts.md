---
title: mu'tlhegh pat
description: mu'tlhegh patlhmey — pIn → Qu' Segh → Qu' → ja'chuq — jangbogh patvaD tIn cherlu', ghojmoHwI'pu' je.
---

**nuq 'oH.** Hoch mIw mu'tlhegh patlhmey boq, wa' ngogh ghobe'. **pIn** Hoch qa' 'oH ('ay'mey 'op So'lu'). **Qu' Segh** **Qu'** je Qu' Segh wa' Qu' je vaD QapchoH. **ja'chuq** thread ghItlh chel. ghoqwI'pu' **pat mu'tlhegh** ghaj je. tIq patlhmeyvam choHwI' 'oH paqvam; ja'chuq **mu'tlhegh DevwI'** wa'logh qonwI'mey neH.

**Hemey:** `/prompts` (retlh tetlh **mu'tlheghmey** — **mu'tlhegh chovnatlhmey**), `/prompt-settings` (pIn **pat mu'tlhegh** 'ay'mey). latlh: ja'chuq **mu'tlhegh DevwI'**, Qu'mey / ghoqwI'pu' je **mu'tlhegh ghojmoHwI'**.

## ghorgh yIlo'

- So'lu'bogh pat chutmey DaHotbe'taHvIS juH ghogh (choHlaHbogh **personality** 'ay') DachoH DaneH.
- Qu' Segh brief lo'qa'laHbogh ghaj 'e' DaneH, 'ej Seghvetlh Qu' Hoch Suq.
- wa' Qu' yuQ tIghmey poQ, latlh Qu'meyDaq narghnISbe'.
- ghItlhwI' qonwI' puj — mu'tlhegh DevwI' DaneH, tIq patlh choH ghobe'.

## motlh mIw

1. **mu'tlheghmey** yIpoSmoH (`/prompts`). patlh yIwIv: **pIn / Qu' Segh / Qu' / ja'chuq**.
2. chovnatlh yIwIv. So'lu'bogh **laD neH**. latlh: De' yIchoH, **yIchu' / yIchu'Ha'**, pagh yIteq.
3. pIn 'ay'mey DaleghmeH `/prompt-settings` yIpoSmoH (**mu'tlheghmey** He Degh). **personality** neH choHlaH; latlh **So'lu'**.
4. Qu' pagh ghoqwI' brief tIqvaD, Qu' / ghoqwI' 'aghtaHghachDaq **mu'tlhegh ghojmoHwI'** yIlo', ghIq **lo'**.
5. wa'logh lo'wI' mu'tlheghvaD, ja'chuq ghItlhwI'vo' **mu'tlhegh DevwI'** yIpoSmoH.

## laHmey

| patlh | He |
|-------|----|
| **pIn** | Hoch pat qa' potlh chutmey je ('ay'mey 'op So'lu') |
| **Qu' Segh** | Qu' SeghvaD motlh (Segh **Prompt** Doch, Seghvetlh bIngDaq `AGENTS.md` rur pollu' je) |
| **Qu'** | wa' QuvaD choHmey. chIm — Segh Suq. `+` tagh — Segh juv. latlh — Segh tam. choHwI' 'oH 'aghtaHghach; chImbe'bogh ngaQ retlh `AGENTS.md` Qap; polDI' teywI' ghItlhlu', chIm mu'tlhegh teywI' Qaw'. |
| **ja'chuq** | thread chelmey / wa'logh lo'wI' mu'tlheghmey |
| **ghoqwI' pat mu'tlhegh** | ghoqwI' vummeH tIgh ([SeHmey](/docs/tlh/agents/configure/)) |

| Doch | Del |
|------|-----|
| So'lu'bogh 'ay' | UIDaq choHlaHbe' (pat naQ) |
| choHlaHbogh 'ay' | ghogh/chutmey DachoHlaH |
| Suqghach | Dung patlhmey QapchoH bIng patlhmey |

<h3 id="the-memory-contract-in-the-master-prompt">pIn mu'tlheghDaq qawHaq mab</h3>

So'lu'bogh pIn 'ay'mey Hoch ghoqwI'vaD, Hoch nobwI'Daq, qawHaq chay' Qap ja':

- **potlh chut 8 (MEMORY).** EYAS qawHaq 'oH ghoqwI' qawHaq wa' neH'e'. nIteb qawHaq qon EYAS; qawHaq ghItlh'eghbe' ghoqwI'pu' not. EYAS qawqa'bogh qawHaq Hoch QIn `<eyas-memory>` 'ay'Daq ghoS, 'ej De' 'oH, ra' ghobe'. latlh nejmeH `memory_search` ra' ghoqwI'pu', ghIq `memory_expand` Sam poSmoHmeH — juHchaj EYAS janmeyvam tetlhbogh pong lo' ([MCP — Hoch juHvaD jan pongmey](/docs/tlh/ai/mcp/#tool-names-per-host)). latlh qawHaq laD pagh ghItlh not ghoqwI'pu' (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, OpenCode De' pa'mey, `ai-memory` pa'mey, Obsidian vaultmey), 'ej vum pa'meychajDaq pagh EYAS De' pa'Daq qawHaq teywI' chenmoH not. vum pa'meyDaq Qu' ra' teywI'mey (`AGENTS.md`, `CLAUDE.md` rur) QaQ.
- **potlh chut 7 (ngaQ)** `memory_search` pong — qawHaqDaq ja'ghach ngaQmoHmeH.
- **System identity** ja': EYAS qawHaq pol 'ej qon, qawqa'lu'bogh qawHaq Hoch QIn `<eyas-memory>` 'ay'Daq ghoS, rap `memory_search` → `memory_expand` cha' pong, 'ej lo'bogh Doch `[source:<id>]` rur ja'nIS ghoqwI'pu'. `MEMORY.md` pagh `memory/YYYY-MM-DD.md` jaj ghItlhHom pol 'e' ra'be'.

mu'tlhegh QaH 'oH **'ej** ngaQmoHghach. tetlhDaq Hoch pa', `security.foreignMemoryPaths`, EYAS De' pa''egh je laDmeH ghItlhmeH lajQo' Hub lojmIt — Hoch patvaD, chovbogh Hoch jan ra'vaD, Claude Code janmey'egh je. [Hub 'ej pegh — EYAS Hur qawHaq](/docs/tlh/admin/security-privacy/#memory-outside-eyas) yIlegh.

**jan ra'laHbe'bogh patmey rurbogh ghItlh Suq.** janmey lajbe' pat 'e' per pat tetlhchugh (jan laH ja'be'bogh Ollama De'wI' ghajbogh Ollama pat rur, pagh jan laH Dachu'Ha'pu'bogh pat rur), janmey pagh jan tetlh pagh ngeH EYAS. **System identity** **Core rules** jeDaj jan ra' 'e' ra'be'choH je:

- System identity qawHaq 'ay' 'ej potlh chut 8 ja': QInvaD EYAS qawqa'bogh `<eyas-memory>` 'ay'Daq ghoS, Suqbogh qawHaq Hoch 'oH, 'ej latlh nejlaHbe' — `memory_search` / `memory_expand` 'oSbe'choH;
- potlh chut 7 'ej ngaQ 'ay' ja': ja'chuq `<eyas-memory>` 'ay' je neH lo'taHvIS ja' (`[source:<id>]` rur ja'lu'), pagh 'ollaHbe' 'e' yIja' — `list_search_sources`, `search_indexed`, `search_knowledge` je pongbe'choH;
- "janmey Daghaj" 'ay' moj: patvam jan ra'laHbe', Data' 'e' yIja'Qo' — nuq ta'nIS yIja';
- ghoS 'ay' ja': ghoSlaHbe' 'ej laHwI'pu' taghlaHbe';
- laH tetlh Suqbe' (jan lo'taHvIS laHmey laDlu') 'ej ghoqwI' tetlh Suqbe' (jan ra'mey ghoSmey 'oH).

mu'tlhegh chenmoHlu'DI' jan Hutlhbogh ghItlh lo'lu'. pollu'bogh System identity Core rules je ghItlhqa'lu' not, vaj ghItlh motlh 'ang **pat mu'tlhegh** nav (`/prompt-settings`) taH. EYAS ngeHbogh ghItlh rap ngaStaHbogh 'ay'mey neH tamlu'; DachoHbogh 'ay' DaghItlhbogh rur ngeHlu', jan Hutlhbogh patmeyvaD je. mIw **De' chellu'ghach** qach nuq ngeHlu' net 'ang. jan ra'laHbogh patmey choH leghbe': pollu'bogh rur ghItlh Suq, jan pongmey mach tlhej, 'ej CLI nobwI'Daq jan tetlh Qav tlhegh chay' EYAS janmey pong juH ja' taH. pagh vIHmoHlu'; jan Hutlhbogh patmeyDaq mu'tlhegh cache tagh wa'logh choH.

**chu'moH.** chu'moHDI' wa'DIch taghDI', So'lu'bogh **System identity** 'ej **Core rules** 'ay'mey nIteb chu'qa'lu', ngo' EYAS ngeHbogh ghItlh ngaStaHchugh — 0.8.16–0.8.23 `save_memory` chut, ngo' "vum pa'Daq MEMORY.md" chaw', pagh mu'tlhegh Memory 'ay' 'oSbogh ngo' ghItlh ngaSbogh lIngmey je. joH choHpu'bogh 'ay'mey, pagh So'Ha'lu'bogh 'ay'mey, choHlu'be'; DachoHpu'chugh, chut 8 chu' ghop yIghItlh. chu'moH rInDI' mu'tlhegh cache tagh wa'logh choH.

<h2 id="prompt-size">patvaD tIn cherlu'</h2>

Hoch mIw mu'tlhegh jangbogh patvaD chenmoH EYAS — Hoch patvaD wa' tIn ngaQ ghobe'.

- **pat tetlhvo' logh Suqlu'** (nobwI'pu' → pat De' tIn Degh), CLI patmeyvaD je: 1M logh ghajbogh Claude Code pat 1MvaD cherlu'. QapwI' 1M Segh'egh neH (*Opus (1M context)* rur) 1M rur tetlh Claude Code; Fable, Opus, Sonnet, Haiku Dochmey 200kvaD cherlu', QapwI' patmeyDaj ja'pa' wa'DIch taghDI' je. CLI loghmey Sovlu'bogh — Claude Code 200k, Grok 500k, Kimi 256k — pat tetlh patvetlhvaD logh ghajbe'DI' neH Qap. EYAS Sovbe'bogh pat motlh tInmey Suq. latlh pat logh SeH tu'lu'be'.
- **100k token loghDaq** Hoch mu'tlhegh 'ay' motlh tInDaj pol.
- **logh tIn** choHlaHbogh 'ay'mey logh law' nob, 250k token 'ej law'Daq 2.5× SIch: Qu' De', ghoqwI' qa', ghogh, ghItlhmey teywI'mey, laH/jan/ghoqwI' tetlhmey, ghom De', Qu' qawHaq. motlh tInDaq ngaSlaHbe'bogh ghoqwI' ghItlhmey tIq logh tIn patmeyDaq (Grok 500k rur) naQ SIch.
- **tlhoS 29k token bIng** (motlh mach juH patmey) mu'tlhegh naQ logh 35% qoDDaq ratlh, vaj ja'chuq ngaSlaH taH. Sovlu'bogh veH: pat mu'tlhegh qawqa'lu'bogh qawHaq je neH ngaS Huchvam — jan De'mey retlh ghoS 'ach toghlu'be' — vaj tlhoS 4k–32k token loghDaq janmey 'ej jan tetlh tIn ghajbogh pat loghDaj teblaH taH.
- **pe'lu'be' not:** EYAS qa', potlh chutmey, motlh personality, Qap 'ay', ghogh tlhegh. reH naQ SIch qa' 'ay'.

[De' chellu'ghach](/docs/tlh/daily/conversations/#context-composition) qach Hoch 'ay'vaD pe'lu''a' 'ang; wIvlu'bogh pat wuq.

**janmey.** pat tetlhDaq janmey lajbe'bogh pat mu'tlheghDaq janmey pagh, jan tetlh pagh, laH tetlh pagh, ghoqwI' tetlh pagh Suq, 'ej qawHaq ngaQ chutmey jan Hutlhbogh ghItlh Suq ([Dung](#the-memory-contract-in-the-master-prompt) yIlegh). QapvaD noblu'bogh janmey neH pong jan tetlh (ghoqwI' **janmey** tetlh qawHaq janmey je — [ghoqwI'pu' — janmey](/docs/tlh/agents/configure/#tools--constraints)), qonlu'bogh Hoch jan ghobe'. CLI nobwI'Daq, CLI janmey'egh chaw'lu'bogh tammoHbogh EYAS janmey (`read_file`, `grep`, `glob`; ghItlhlaHtaHvIS `write_file`, `edit_file`; shell lo'laHtaHvIS `run_command`, `git_status`, `git_diff`) pongbe' tetlh, 'ej tetlh Dor wa' tlhegh: juHDaj EYAS janmey chay' pong (Claude Code: EYAS MCP QIn'a'vo' `mcp__eyas__<name>`; Grok: `use_tool` `eyas__<name>` tlhej; Kimi: `eyas` MCP QIn'a'Daq). API nobwI' patmey pong mach legh.

**'Iv patvaD mu'tlhegh tIn cherlu':**

| He | tIn cherlu'bogh |
|----|-----------------|
| ja'chuq mIwmey | mIw Qapbogh pat, rarlu'bogh pagh auto-He |
| 'em ja'chuq Qapmey, Board bot, ghom ghoqwI'pu', laHwI'pu' noblu'bogh, He jangmey | Qap ra'bogh pat. nobwI' Hutlhbogh pat rarlu'bogh — pat tetlhDaj ngaSbogh nobwI'vaD rarlu'; pat tetlh pagh ghajbogh nobwI' — motlh tIn 'ej jan pongmey mach Suq |
| pat pongbe'bogh Qapmey | lIng motlh pat (motlh patlh, ghIq motlh nobwI', ghIq wa'DIch Qapbogh nobwI') — vaj Qap |

**qawqa' tlhaq je QIn tlhej.** mIwvaD EYAS qawqa'bogh, DaH jaj poH je, pat mu'tlhegh 'ay' 'oHbe': DaH QInDaq chellu'bogh wa' `<turn-context>` 'ay'Daq ghoS, vaj mIw mIw rap taH pat mu'tlhegh, 'ej cachelaH taH. `memory.index.budgetChars` qawqa' 'ay' tIn cher (100k token loghDaq 2,400 ngutlh), jangbogh pat logh rur tInmoHlu', latlh 'ay'mey rur. [qawHaq — chay' qawqa' patDaq ghoS](/docs/tlh/knowledge/memory/#how-recall-reaches-the-model) yIlegh.

**tlhaq.** `i18n.timezone` poH yoSDaq (pagh De'wI' poH yoS) jaj poH je noblu', poH yoSvetlh UTC offset je pong — [SeH](/docs/tlh/deploy/configuration/#time-zone-of-the-models-clock) yIlegh.

---

<h2 id="prompt-enhancer">mu'tlhegh DevwI' (ja'chuq qonwI'mey)</h2>

ja'chuq **ghItlhwI'**vo' poS. **wa'logh** lo'wI' mu'tlhegh QaQmoH thread **pat qorDu'**vaD, Qu' Segh Deghmey, QaQ mI', puS/naQ He je tlhej. **mu'tlhegh QaD** He patlhDaq Qap ([He 'ej Huch](/docs/tlh/ai/routing-budget/#tiers)).

Doch tetlh naQ: [ja'chuqmey — mu'tlhegh DevwI'](/docs/tlh/daily/conversations/#prompt-enhancer-dialog).

---

<h2 id="prompt-coach">mu'tlhegh ghojmoHwI' (tIq patlhmey)</h2>

**mu'tlhegh ghojmoHwI'** Deghmey ghItlh **tIq**vaD Segh Sovbogh ghojmoHwI' poSmoH — ja'chuq qonwI'mey DuDbe'. **mu'tlhegh QaD** He patlhDaq Qap ghojmoHwI' je.

| He | nuqDaq | nuq QaQmoH |
|----|--------|------------|
| **Qu' Segh** | Qu'mey → Qu' Seghmey → Prompt | Seghvetlh Qu'mey Suqbogh motlh lo'qa'laH |
| **Qu'** | Qu'mey → Qu' → Prompt | Qu' ja'chuqmey HochvaD vummeH brief (yuQ, tIghmey, QapmeH chovnatlh) |
| **ghoqwI' pat** | ghoqwI'pu' → **SeHmey** → **pat mu'tlhegh** | ghoqwI' vummeH tIgh (ghogh ghobe', Qu' yuQ ghobe', wa'logh Qu' ghobe') |

<h3 id="coach-dialog-controls">ghojmoHwI' 'aghtaHghach SeHwI'mey</h3>

| SeHwI' | Del |
|--------|-----|
| He Degh | **Qu' qIb** / **Qu' Segh qIb** / **ghoqwI' systemPrompt** |
| qonwI' / jang | ngoQ yIDel pagh qonwI' yIchel; **ngeH** lo'taHvIS yIchoHqa' |
| **QaQ N/10** | tetlh mI'; **Hutlh: …** Hutlhbogh Dochmey tetlh, pagh Hutlhchugh **tetlh naQ** |
| **cha' He yIchup (puS + naQ)** | puS + naQ He |
| **chuplu'bogh Del** | chelmeH wIv |
| **lo'** | 'aghtaHghach DochDaq brief ghItlh |

## Dochmey 'ej SeHwI'mey

<h2 id="prompts-list">`/prompts` — mu'tlhegh chovnatlhmey</h2>

bIng pong: *mu'tlhegh ghajchuq HevaD pat mu'tlhegh chovnatlhmey tISeH.*

| SeHwI' | Del |
|--------|-----|
| patlh Dechmey | **pIn / Qu' Segh / Qu' / ja'chuq** |
| chovnatlh tetlh | pong, Qap per, **So'lu'** Degh |
| **chovnatlh yIlegh / chovnatlh yIchoH** | choHwI' 'ay' |
| **yIchu' / yIchu'Ha'** | `isActive` choH |
| **De'** | chovnatlh porgh |

<h2 id="prompt-settings">`/prompt-settings` — pat mu'tlhegh</h2>

bIng pong: *Hoch AI ja'chuq mo' 'oH 'ay'meyvam'e'. So'lu'bogh 'ay' choHlaHbe'.*

**So'lu'** 'ay'mey laD neH 'anglu'. **personality** 'ay' **choHlaH** — polDI' `PATCH /prompts/master/personality` ngeHlu'.

## latlh

- [Qu'mey — mu'tlhegh Dochmey](/docs/tlh/daily/projects/)
- [ghoqwI'pu' — pat mu'tlhegh](/docs/tlh/agents/configure/)
- [ja'chuqmey](/docs/tlh/daily/conversations/)
- [qawHaq](/docs/tlh/knowledge/memory/)
- [MCP — Hoch juHvaD jan pongmey](/docs/tlh/ai/mcp/#tool-names-per-host)
- [He 'ej Huch](/docs/tlh/ai/routing-budget/)
