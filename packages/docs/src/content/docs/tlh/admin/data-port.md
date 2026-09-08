---
title: De' tlhap 'ej ngeH
description: tlhap ghojmoHwI' qawHaq, laHmey, workspace chutmeyvaD — nej, wIv, chaw'.
---

**nuq 'oH.** Data-port **tlhap ghojmoHwI'** 'oH. De'wI' He pagh zip/markdown lI'lu'pu'bogh latlh QaHwI'vo' nej (Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot, Obsidian, ja'chuq ngeH, ngugh EYAS ngeH, pagh motlh Markdown pa') 'ej nuqDaq tev chup. qawHaq lo'laH; workspace chutmey + qa' **chup neH** merge chaw'pa'. DB naQ ngeH 'oHbe' — [qon](/docs/tlh/admin/backup/) lo'. ngeH **tugh**.

**Daq:** SeHmey → **De' vIH**. per: *ngugh AI patmeyvo' qawHaq, laHmey, chutmey je yItlhap. ngeH tugh.*

## ghorgh yIlo'

- nI' QIn `~/.claude` pagh Obsidian `ai-memory`vo' EYASDaq (qawHaq neH latlh tlheD laD).
- lo'wI' laHmey Claude/Cursorvo' → Segh **own**.
- chutmey/qa' merge chup, nIH'eghbe'.
- ngugh ngeH ZIP nejlu', 'ach nIteb teywI'mey qonqa'be'lu'.

## motlh mIw

1. **SeHmey** → **De' vIH** → **De' yItlhap…**
2. **Hal pat**: **nIteb tu'**, Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf / Codeium, GitHub Copilot, Obsidian, ja'chuq ngeH, EYAS ngeH, Markdown pa'. API pongmey: `claude-code`, `grok-cli`, `cursor`, `codex`, `gemini-cli`, `windsurf`, `copilot`, `obsidian`, `chat-export`, `eyas-export`, `generic-md`.
3. **De'wI' He** (janvamDaq He naQ) pagh **tevwI' yIwIv…** (zip pagh wa' markdown/JSON). **ra'mey** chaw'lu': potlh mIw neH Dev.
4. **yInej**. pa' Sor 'ej ghommey yIlegh (qawHaq, qawHaq tetlh, qeplu'meH poHmey, laHmey, chutmey, 'angwI', ghoqwI' qa'mey, Sov, ngoq, tlhaplaHbe') 'ej yIwIv nuq Dapol. tlhap naQ nIteb DaneHchugh, **mIw DubwI' lo' — De' De' neH** yIwIvQo'.
5. **N Dochmey tItlhap**. qawHaq/laHmey lo'lu'; chutmey/qa' loS: **Qu' pa' choH chupmey** — **boq yIchaw'** pagh **yIlujmoH**.

## laH tetlh

| laH | qech |
|-----|------|
| tlhap | De'wI' He pagh lI' (zip) |
| Daqmey | qawHaq (kind + patlh), wanI' qeplu'meH poHmey, laHmey teywI'meyDaj tlhej, ghoqwI' qa'mey, workspace chutmey, Qu' Segh ra'mey |
| merge | chutmey/qa' **chup neH** — chaw'lu'DI' neH lo'lu' |
| chelmoH | **motlh chu'Ha'lu'** — wIvlaHbogh per, De' De' neH, porgh not |
| Hol | tlhaplu'bogh qawHaq Hal Hol pol |
| laH Segh | tlhaplu'pu' → **own** |
| cheghmoH | Qu' naQ cheghmoH — Data PortDaq **`delete`** chaw' poQ |
| ngeH | **tugh** — `eyas-export-v1` boq (vault, laHmey, Qu' pa'mey, `episodic.jsonl`). pegh ngaSbogh ghItlhHommey qengchoHlaH boq, vaj ghoSpa', qawHaq qaw So'bogh chaw' rap Suq He: Data PortDaq `create` neH yapbe' |

## nuqDaq tev

pa' naQ poQbe'. **He bIngDaq Hoch tlheghlu'.** pol tetlh tu'be' 'ej 'aqroS tu'be': Sor DungDaq Hoch pa' 'el nej, tIn'a' 'ach. juH pa' motlh wa'maH logh tIn Sor naQ tlheghlu' 'ej tlhaplu' — poH natlh je Dil, 'ach not buSHa'lu'. qawHaq ngaSlaHbe'bogh pa' **Seghmey** neH 'elbe'lu': nIqHom pa'mey (`node_modules`), ghItlh loD pa'mey (`.git`, `.hg`, `.svn`), `.cache`, `__pycache__`, `.venv` / `venv`, chenmoH Hal pa'mey (`dist`, `build`, `out`, `.next`, `.turbo`, `target`) chenmoH manifest retlhDaq tu'lu'DI', browser lo'wI' De' pa' Sormey (Chrome, Chromium, Firefox, Antigravity — per teywI'meychaj lo'lu', nuqDaq 'ach), 'engDaq De' polwI' Sormey (`Library/CloudStorage` `Library/Mobile Documents` je, macOS Daq nobbogh lo'lu'; tIQbogh sync pa'mey, Dropbox rurbogh, per teywI'meychaj lo'lu' — OneDrive Dropbox joq pong neH ghajbogh pa' motlh pa' 'oH 'ej 'ellu'), veQ pa'mey (`.Trash`, `.Trashes`, `$RECYCLE.BIN`, `.local/share/Trash`), `Library/Caches` je. Hoch **wa' tlhegh leghlaHbogh** ratlh, tevwI' mI'Daj 'ej meq *pa' nejbe'lu': `<Segh>`* tlhej, vaj pagh So''egh. symlink pa' wa'logh 'ellu' — He teH wuq — 'ej DoH ja'lu', 'elqa'be'lu'. `.DS_Store` ghun Dotlh rur.

| Hal | EYAS 'ay' |
|-----|-----------|
| `type: user` / `feedback` / `project` / `reference` ghajbogh ghItlhHom (Claude Code, Obsidian, Grok) | vault ghItlhHom, **kind** rap ghaj; `feedback` `procedural/` bIngDaq, latlh `semantic/` bIngDaq; Hal teywI' pong pol ghItlhHom, vaj `[[wikilink]]`mey taHtaH |
| `MEMORY.md` tetlh | wa' vault ghItlhHom neH, `index` per ghaj; ghItlhHom qawlu'bogh `description` Delbe'DI', wa' Dov DovDaj moj |
| qep Dovmey, qep ghItlhHommey (`type: claude-session` / `grok-session`), ja'chuq qonmey je — Claude Code `*.jsonl`, ghoqwI'Hom qonmey je, Cursor ghoqwI' qonmey, Codex rollout, ChatGPT / Claude.ai ngeHmey | wanI' qawHaq, Hoch qepvaD wa' tlhegh — qep nI'qu' 'ay'mey Dujmey rurbogh, not pe'lu' — 'ej mu'mey mu' mu'. **motlh Hoch wIvlu'**; DaneHbe'chugh, *qeplu'meH poHmey* ghom yIwIvHa'. qep retlhDaq pollu'bogh jan Hal tlheghlu', 'ach wIvbe'lu' |
| ngugh qawHaq pa'mey (`memory.local-backup-*`, `memory.old`, `*.bak`) | `legacy` per ghajbogh vault ghItlhHom; pong lo'lu'pu'DI', `-2` loDnI' Suq, chIlbe' |
| Sor bIngDaq nuqDaq 'ach ghItlhmeylIj | vault ghItlhHom; `type:` Delchugh ghItlhHom, `kind` naDev Hal; Delbe'chugh, `reference` |
| latlh Doch ghItlhmey | `third-party` per ghajbogh vault ghItlhHom, wIvlu' — DaneHbe'chugh, ghom yIwIvHa' |
| ghItlh pa'mey qoDDaq chut teywI'mey (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md`) | chup, SorDaq nuqDaq 'ach |
| ngoq teywI'mey | tlheghlu' 'ej tlhaplaH, 'ach **wIvbe'lu'** — qawHaq ghobe', ra'mey ghobe' |
| De' cherwI' mu'mey je (`.yaml`, `.toml`, `.csv`, `.log`, QaHwI' `settings.json`Daj …) | tlheghlu' 'ej tlhaplaH, 'ach **wIvbe'lu'** |
| `SKILL.md`, `references/` `scripts/` je tlhej | wa' **own** laH: naQ ngIq mu' mu', teywI'mey `data/skills/imported/<pong>-<hash>/`Daq je qonqa'lu'. laH porghDaq pa'vam **He naQ** ponglu', vaj pa'vo' nIteb ngoqmey vumlaH |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor `.mdc`, Windsurf Copilot chutmey je | **wa'DIch QaHwI'** `AGENTS.md`vaD chup — pagh *Qu' Segh ra'mey* DawIvDI', `general` Qu' SeghvaD — chaw'DI' chelqa'lu', not qa'moHlu' |
| `.claude/agents/*.md` personamey | ghoqwI' qechmey (jan pongmey EYAS janmeyDaq lanlu') |

**pagh pe'lu', 'ej pagh buSHa'lu'.** tlhapDI', teywI'mey naQ laDlu', 'ej tIn 'aqroS tu'be': 4 MiB tIn law'bogh mu' teywI' (ja'chuq ngeHvaD 50 MiB) naQ tlhaplu' 'ej tlheghDaj tInDaj per neH qeng. porghmey **ngIq byte byte** qonlu', 'ej retlh Dovmey chIm je pollu'; vault qonwI' wa' rIn tlhegh 'ej woDlu'bogh UTF-8 BOM neH choHmey. Hoch lo'lu'bogh Doch qon: nuq lanwI' laDpu' (`source.adapter`, `source:<lanwI'>` per je — nIteb tu'lu'bogh Claude Code Qu' bIngDaq tu'lu'bogh Grok Dov `grok-cli` per Suq), Hoch He De' tu'lu'bogh, 'ej ledgerDaq De' sha256Daj — vault ghItlhHommeyvaD, wanI' tlheghmeyvaD, laHmeyvaD, laH boq teywI'meyvaD, ghoqwI'pu'vaD, chupmeyvaD je. Hal frontmatter, He, hash, 'ej choHlu'bogh poH — Hoch ghItlhHom tlhej `source:` bIngDaq lengtaH. nejwI' tlhapbe'bogh Hoch teywI' leghlaHbogh tlhegh 'oH, meqDaj tlhej. tlhapqa'DI', ghItlhHommey tu'lu'bogh **choHbe'** ghItlh, 'ej not qa'moHlu' — pong rap ghajbogh ghItlhHom pIm `-2` per 'ej `conflict-with:` per Suq. chaw'be'lu'pu'bogh chut teywI' tlhapqa'DI', cha'DIch chup chenmoHbe'lu'.

**Qu' pagh Qu' Segh qawlu'bogh 'ach naDev tu'be'bogh pagh chIHlu'.** ghItlhHom frontmatterDaq `project` (pagh `projectType`) qawmoHchugh, Qu' (pagh Qu' Segh) vam DaH EYAS boghmoHwI'vamDaq tu'chugh neH, ghItlhHom Qu' pa'Daq (pagh Qu' Segh pa'Daq) lanlu'. tu'be'chugh, ghItlhHom pa' Delbe'bogh lanlu' 'ej `declared-project:<id>` (pagh `declared-project-type:<id>`) per Suqlu'. Qu' rIntaH chenmoHlu'DI' tlhapqa'lu'DI' je, ghItlhHom qawlu'bogh IDDaq lanqa'lu' — pagh SoHvaD ghItlhHom teqlu'chugh je.

**Hoch QaHwI'.** Halmey tu' lanwI'pu': Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot (ghItlhlu'ta'bogh mIw neH), Obsidian, ChatGPT / Claude.ai / motlh JSON ngeHmey, eyas-export, 'ej motlh markdown (`generic-md`). Hemey law'Daq tu'lu'bogh teywI' (`~/.grok/memory` bIngDaq symlink vault) wa' ghItlhHom moj.

**motlh chu'Ha'lu' mIw DubwI'.** legh mIwDaq **mIw DubwI' lo' — De' De' neH** per tu'lu'. wIvbe'lu'chugh — motlh — tlhap naQ nIteb qaS, 'ej pagh mIw ja'lu'. wIvlu'chugh, 'ej cherlu'ta'bogh mIw tu'lu', vaj Segh Delbe'bogh ghItlhHommey Segh chup, Dov, permey je Suq. Dochmey 'aqroS tu'be'; poH neH Dil. porgh not qa'moHlu', mIw jatlhmo' pagh chIllu', 'ej `contains-secrets` per ghajbogh Doch not ngeHlu'. Doch tetlh 'ang: arlogh ghItlhHommey chelmoHlu'.

**qaSHa'moHmeH.** Doch tetlhvo' pagh *tlhap ret* tetlhvo' Hoch Qu' qaSHa'moHlaHlu': ghItlhHommey, wanI' tlheghmey, laHmey (qonqa'bogh teywI'meyDaj je), ghoqwI'pu', 'ej chaw'lu'bogh chut 'ay'mey teqlu'; loStaHbogh chupmey lajQo'lu'. qaSHa'moHmeH Qu' Qaw'wI' 'oH, vaj Data PortDaq **`delete` chaw'** poQ — noblu'bogh cherDaq pIn 'ej SeHwI' neH; latlhvaD chaw' Qagh 'ang. **tlhappu'ghach ret choHlu'pu'bogh** vault ghItlhHom teqbe'lu': *tlhapHa'* tetlhDaq ja'lu'.

laD janmey poSmoH juH qawHaq HemeyDaq, vaj tlhapwI'vam ghItlhHommey qonqa'laH; `~/.claude` / `~/.grok` / `ai-memory`Daq qon pagh shell tuchlu'. [qawHaq](/docs/tlh/knowledge/memory/) yIlegh.

## peghmey

pegh nejwI' perbogh teywI' **latlh teywI' rur, ngIq mu' mu' tlhaplu'**, 'ej `contains-secrets` per Suq. pegh ngaSmo', pagh chIllu' — naDev Qanpu' *qaw* mIw 'oH, tlhap mIw 'oHbe'. per lengtaH: ghItlhHom per, laH laH, wanI' per, 'ej chup perDaq `[contains-secrets]`. tlhappa' Dalegh net chaw'meH, tlhegh per ghojmoHwI'.

pegh nejwI' nej: pegh ngaQHom 'ay', nobwI' token, `KEY=value` mu', pagh `.env` rurbogh teywI' pong. pegh *nejbogh* ngoq — `keychain_lookup(...)`, `os.environ[...]`, `getenv(...)` — 'ej ghItlh Daq pupmey rurbogh `<your-key>`, `xxx`, `.env.example` je: perbe'lu'.

**nuq ta' per.** `contains-secrets` ghajbogh ghItlhHom, wanI' tlhegh, pagh laH: nIteb SIchbogh mIw Hoch vo' So'lu' — taHbogh qawHaq tetlh, rarbogh Qu', `search_memory`, qelwI' Qu', ram Sepmey boqmoHwI', laH lanwI', 'ej chenmoHlu'bogh pat ra'mey. chaw'lu'bogh mIw DubwI'vaD not nob, 'ej not lanlu'. qawHaq HaqDaq naQ Dalegh taH. mIwvaD DapoSmoHmeH, `config/local.yaml`Daq `memory.recall.includeSecrets: true` yIcher 'ej yItaghqa' — [cher](/docs/tlh/deploy/configuration/) yIlegh.

**nIteb chelmoH lojmIt 'oH, teywI' pat qoD 'oHbe'.** per bot: perlu'bogh Doch nIteb ra'meyDaq 'elbe'. teywI' laD janmey ghajbogh ghoqwI' 'e' botbe': DaqDaq teywI' Hal laDlaH, 'ej pagh So'moH. janvamDaq pegh tu'nISbe'chugh, yIchoHqa': tlhapwI' Qu' 'oH pegh ra'mey Sappu'be'bogh vo' So', SIchlaHbe'moH 'oHbe'.

**cha' Segh So'be'lu', pa'Daq De' ra'mey *'oH*.** tlhaplu'bogh ghoqwI' qa' 'ej chaw'lu'bogh workspace chut teywI' **QaHwI' ra'meyDaq ngIq mu' mu' lo'lu'**, vaj qoDDaq pegh Hoch tlheDDaq mIw SIch, 'ej qaw chIw pa'Daq Qapbe' — So'lu'chugh, tlhappu'bogh ghoqwI' chu'Ha'lu'. `contains-secrets` per Suq je, vaj DatunlaH, 'ej tlheghmeyvamDaq mu' rap jatlh ghojmoHwI': tlhappa' yIlegh.

**pegh rurbogh teywI'mey** — `.env`, `credentials.json`, ngaQHom teywI'mey — tlheghlu' 'ej tlhaplaH, 'ach **wIvbe'lu'**. ngaQHom *ngaSbogh* neH ghItlhHom, chut, laH, pagh qon: kindDaj pol, wIvtaH, 'ej per Suq.

## tIn

Hoch wIvmeH Doch wa' De' pa' tlhegh 'oH, vaj not tetlh naQ 'uch ghojmoHwI', not 'uch De'wI'.

**tlhopbe'Daq nej qaS.** SIbI' jang, 'ej lengtaHvIS pa' Sor teb — pa'mey 'ellu', tevwI'mey leghlu', tlheghmey tlheghlu' ja'. juH pa' naQ tup law' poQ. DamevlaH, 'ej tlheghlu'pu'bogh Hoch leghlaHtaH.

**legh mIw: pa' Sor, tlhegh tetlh Dal, 'ej leghpa'.** Hoch pa' tlheghlu', 'elbe'lu'bogh Seghmey je — tevwI' mI'chaj 'ej 'elbe'moHbogh Segh 'ang. **Hoch tlhaplaHbogh yIwIv**, **pagh tIwIv**, **chuplu'boghDaq yIchegh** je: nej naQvaD Qap. bIngDaq wIvmeH mIw lo'lu', tlhegh tlhegh ghobe': Hoch pa' Hoch Segh je wej Dotlh SeHwI' ghaj, vaj wa' 'uy' Hoch pa'Daq Hoch qon wIvHa'. SeHwI' retlhDaq mI': jIH SeHlaHbogh wIvvaD De'wI' jangbogh 'oH, vaj DalaDbogh 'oH tlhapwI' polbogh'e'. leghpa': teywI' wa'DIch 64 KiB 'ang; tlhap naQ taH.

**tlhap lengtaH.** 100 Dochmey boqmey lengtaH, Hoch boq lanlu', 100 Dochmey Hoch tlhoS Dotlh ja'lu', 'ej nej tetlh wa'logh neH rIn chenqa'moHlu'. DaH boq rInDI' DamevlaH — lanlu'pu'bogh Hoch ratlh 'ej cheghlaH. tlhap qaStaHvIS De'wI' taghqa'chugh, Qu' lanlu'pu'bogh boq QeqDaq taghqa', tagh'a'be'. nej poH tlhap poH je 'anglu'.

**wa' teywI' tIn 'oH qawHaq veH'e', Sor naQ 'oHbe'.** boq teywI' — ja'chuq qon, ja'chuq ngeH, Codex De' pa' — tlhapDI', tInDaj law'logh rurbogh poH nI'be' qawHaq natlh, teywI' wa' buffer rur 'uchlu'DI' 'ej qoDDaq Hoch 'ay' chenmoHlu'mo'. arlogh? teywI' Segh Dep: Hoch tlheDvaD wa' tlhegh ghajbogh qonvaD tlhoS wejlogh; ja'chuq ngeHvaD Sochlogh pagh law', naQ wa' Doch Sor moj mojaq. tlhap mIw natlh law', nej natlh puS — 19 MB qon nejtaHvIS 100 MiB juvlu', tlhaptaHvIS 235 MiB. 90 MB ja'chuq ngeH 'aqroS tlhoS 900 MiB ratlhtaH; Helm chart 1Gi motlhvaD yap, 512Mi ngugh starter yapbe'.

**tlhegh tlhegh qawHaq natlh rar 'oH, tlhegh mI' 'ach.** nej rInDI' pagh pollu': 26 000 tlhegh ghajbogh Sor rap cha'DIch nejlu'DI', heapDaq pagh chellu'. 'ach ratlhtaHbogh qawHaq DaH tIn law' rur, allocator patvo' tlhoblu'pu'bogh pa'mey pol — allocator 'oH, nej 'oHbe'. teywI' tIn law' Hoch teywI' tIn puS veH cher, Sor tInDaj cherbe'.

**tlhapqa'DI', chu' neH chellu'.** tu'lu'bogh Hoch **choHbe'** ghItlh, 'ej ret tlhap not qaSHa'moH tugh tlhap.

cha' mIqta' De', vaj pagh SoHvaD Dogh:

- 200 000 ngutlh tIn law'bogh laH boq teywI' laH porghDaq Daqvetlh SIch lanlu', 'ej per naQ qonlu'bogh 'ang. laH boq pa'Daq qonlu'bogh naQ byte pup 'ej naQ.
- mIqta' 'uchlaHbogh wa' mu'mey De' tIn law'bogh wa' mu' teywI' (tlhoS 512 MiB) tlheghlu', hashlu', 'ej latlh rur wIvlaH, 'ach *mIqta' 'uchlaHbogh wa' mu'mey De' tIn law'* meq tlhej ja'lu', lanbe'lu'. qatlh 'ang tlhegh.

**wa' qech qa' qelmeH.** qeplu'meH poHmey laHmey je: He qa' Hutlh — De'chaj digest tu'lu'. vaj tlhappu'ghach ret Hal teywI'Daq ngutlh chIm neH choHlu'chugh, *cha'DIch* wanI' tlhegh chenmoH (boq teywI'mey ngaSchugh, cha'DIch laH je), wa'DIch choHbe'. vault ghItlhHommey — He qa' ghaj — DaqchajDaq choHqa'lu'.

## SeHwI'mey

<h2 id="wizard">tlhap ghojmoHwI'</h2>

mIwmey: **source → scanning → review → running → done**.

| SeHwI' | qech |
|--------|------|
| **Hal pat** | Dung tetlhDaq profile |
| **De'wI' He** | He naQ — pa' pagh juH pa' naQ. **nIteb tu'** ghobe'bogh **Hal pat** DawIvDI', lanwI'vo' **Daq motlh** tetlh 'anglu' |
| **boq pagh tevwI' yIlI'** | ngugh ngeH ZIP, pagh wa' markdown/JSON tevwI'. 50 MiB 'aqroS lI' neH Sam; He nejvaD 'aqroS tu'be' |
| **ra'mey** | chaw'lu' — nuq nejlu'. potlh mIw neH Dev; ghaHmo' pagh chIllu' |
| **yInej** | tlhopbe'Daq Sor tlheghmoH — pa'mey 'ellu', tevwI'mey leghlu', tlheghmey tlheghlu', 'ej **nej yImev** |
| nej tu'bogh pa'mey | nej tlheghmoHbogh Hoch pa', pa' SeHwI'mey tlhej, Sor 'ay' mI'mey, 'ej **pa'vamDaq tlheghmey meqmey** — tlhaplaH pagh tlhaplaHbe', 'elbe'lu'bogh pa' Segh je |
| Segh wIv | **Hoch / qawHaq / qawHaq tetlh / qeplu'meH poHmey / laHmey / chutmey / 'angwI' / ghoqwI' qa'mey / Sov / ngoq / tlhaplaHbe'** |
| **Hoch tlhaplaHbogh yIwIv / pagh tIwIv / chuplu'boghDaq yIchegh** | nej naQvaD ghom wIv, DaqHom neH ghobe' |
| pa' Segh SeHwI'mey je | wej Dotlh — wa' 'uy': pa' bIngDaq tlhaplaHbogh Hoch, pagh Hoch pa'Daq Seghvetlh Hoch tlhegh, wIv pagh wIvHa' |
| **leghpa'** | tevwI' wa'DIch 64 KiB — tlhap naQ taH |
| **mIw DubwI' lo' — De' De' neH** | motlh chu'Ha'lu' — wIvlaH, De' De' neH, porgh not, perlu'bogh Doch not |
| **N Dochmey tItlhap** | tlhopbe' Qu' taghmoH |
| **tlhapvam yImev** | DaH boq rInDI' mev; lanlu'pu'bogh ratlh |
| Doch mI' | **wIvlu' / lo'lu' / choHbe' / chupmey / tlhapHa' / Qaghmey** |
| **tlhapHa'lu', meq tlhej** | meq perDaq Doch mI' (bIngDaq yIlegh) |
| **nejlu' / tlhaplu' poH** | Hoch mIw poH |
| **boq yIchaw' / yIlujmoH** | Qu' pa' chupmey — not nIteb boqlu' |
| **tlhapvam yIcheghmoH** | Qu' naQ qaSHa'moH — Data PortDaq `delete` poQ |
| **tlhap ret** | Qu'mey vagh QeqHa', Hoch cheghmoH per ghaj |

nej chIm: *DaqvamDaq tlhaplaHbogh pagh tu'lu'.*

## meq permey

legh tetlhDaq Hoch tlhegh meq ghaj, 'ej lo'lu'be'bogh Hoch Doch **tlhapHa'lu', meq tlhej** tetlhDaq togh. cha' Hoch wa' mu' tetlh ngaDvo' Hegh — not mu' tlhab — vaj ghojmoHwI' per 'ang, 'ach API 'ej qonmey per De' qeng.

| per | qech |
|------|---------------|
| `directory-skipped` | not 'ellu'bogh pa' Segh — wa' toghlu'bogh tlhegh, tevwI' mI'Daj SeghDaj je tlhej |
| `binary` | cha' mI' tevwI' |
| `outside-root` | pa' wIvlu'bogh HurDaq |
| `duplicate-content` | De' rap |
| `unreadable` | laDlaHbe'lu' |
| `empty` | tevwI' chIm |
| `derived-index` | chenmoHlu'pu'bogh tetlh |
| `transcript` | ja'chuq qon (naQ tlhaplu') |
| `session-summary` | qep Dellu' |
| `session-artifact` | qep retlhDaq pollu'bogh jan Hal |
| `persona` | ghoqwI' qa' |
| `slash-command` | slash ra' |
| `cursor-rule` | Cursor chut tevwI' |
| `memory-note` | qawHaq qon |
| `memory-index` | qawHaq tetlh |
| `skill-package` | laH boq |
| `skill` | laH tevwI' |
| `orphan-asset` | tlhapbe'lu'bogh laH tevwI' |
| `rules-file` | chut tevwI' |
| `config` | pat cher tevwI' |
| `source-code` | ngoq tevwI' — tlhaplaH, wIvbe'lu' |
| `data-file` | De' pagh cherwI' mu'mey — tlhaplaH, wIvbe'lu' |
| `symlink-upload` | symlink lI'lu'pu' |
| `needs-bun` | Bun poQ |
| `not-downloaded` | 'engDaq pollu', qemlu'be' — teywI' pat Sovbogh vo' tlheghlu', not tlhoblu' |
| `invalid-json` | JSON lughbe' |
| `unknown-json` | JSON Sovbe'lu' |
| `unrecognised` | Sovbe'lu' |
| `app-state` | ghun Dotlh |
| `identity` | 'angwI' tevwI' |
| `not-durable` | latlh pagh motlh mu'mey — per neH |
| `tools-policy` | jan chut |
| `not-importable` | tlhaplaHbogh pagh |
| `missing-unit` | tevwI' 'ay'Daj Hutlh |
| `unsupported-target` | Daq lo'laHbe' |
| `service-unavailable` | lI'wI' ngeHbe'lu' |
| `not-a-persona` | ghoqwI' qa' ghobe' |
| `no-agent` | ghoqwI' Hutlh |
| `exceeds-string-limit` | mIqta' 'uchlaHbogh wa' mu'mey De' tIn law' — tlheghlu', wej pollu' |
| `unchanged` | tlhappu'; choHbe' |
| `error` | Qagh |

`not-durable` `transcript` je: per neH — pagh wIvHa'. **Sovbe'lu'** Segh chenmoHqa'be'lu' — chu'choHvam qaSpa' chenmoHlu'bogh nejmeyDaq neH taH.

## latlh

- [qawHaq](/docs/tlh/knowledge/memory/)
- [laHmey](/docs/tlh/automation/skills/)
- [qon](/docs/tlh/admin/backup/)
- [ghoqwI'pu' — workspace](/docs/tlh/agents/identity-workspace/)
