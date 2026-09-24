---
title: Hub 'ej pegh
description: Hub lojmIt, wanI' He, chov qun, pegh chut je — jan pa' 'ej jan 'em.
---

**nuq 'oH.** wej SeHwI' Daq ghaj bomvam. **Hub lojmIt** Qap poH chut 'oH: jan ra' *Qappa'* chaw', lajQo' pagh vIHmoH. **Hub wanI'mey** (`/security`) wuqmeyvetlh He 'oH. **chov** (`/audit`) ta' qun choHlaHbe'bogh 'oH (cheghmoH DawIvlaH). **pegh** (`/privacy`) — naDev pegh chut DachoH 'ej Dachov: ghItlh EYAS mejDI' Hop patDaq, 'Iv ghot De' So'lu', 'Iv QIn chu' lajQo'lu' — 'ej rap So'wI' nI' qawHaq capture vault ghItlh *pa'* lo'.

## ghorgh yIlo'

- jan ra' lajQo'lu', 'ej checkpoint, Qob, meq je DaSovnIS.
- private pagh metadata janDaq Internet janmey SIchlaHbe' 'e' DatobmoHnIS (SSRF).
- SeH'egh Dachu'moH, 'ej nuq vIHmoH lojmIt DaleghnIS.
- log, vault ghItlhHom, mej mu'tlhegh je PII mejtaH'a' DachovnIS.
- mu'tlheghDaq QIn Daq, IBAN pagh tax mI' tu'lu'DI' Hop pat nuq Suq 'e' DaSovnIS.
- *Memory outside EYAS …* pagh *… is read and written only by EYAS* ja'taHvIS He lajQo'lu' patvaD, 'ej qatlh DaSovnIS — pagh De'wI'vamDaq nuqDaq tuchlu' DaleghnIS.
- AI ra' janmey (Claude Code, Grok, Kimi, OpenCode) De'wI' SeH'eghvo' chay' Haw'moHlu', chay' 'oH tobmoHlu', 'ej kernel teywI' Hungchaj Qap'a' DaSovnIS.
- *QIn ngeHlu'be' — pegh* tlhej QIn lajQo'lu', pagh 'Iv De' So'lu' pagh lajQo'lu' DachoHnIS.
- EYAS nIteb Hutlh Qappu' pat 'ej Hoch patvo' qawHaqDaj So'nIS ([nobwI' qawHaq yIbotmoH](#quarantine-a-providers-memory)).

## motlh mIw

1. **Hub** (`/security`) yIpoSmoH. Dung **EYAS Hur qawHaq** 'emwI' tu'lu' (joH SeHwI' je). wuq (**yIchaw' / yIqIl / yIghurtaH**), Qob, chovwI' je lo'taHvIS wanI'mey yISeH.
2. **chov** (`/audit`) yIpoSmoH: 'Iv nuq ta', patHom, chovnatlh (**Qapla' / Qagh / qIllu' / cheghmoHlu'**), Dil. nobDI' cheghmoH, chaw' tlhej.
3. **pegh** (`/privacy`) yIpoSmoH: lengwI' mI'mey yIlaD, chut yIchoH (Segh Hoch Qu', mIw DIchenmoHbogh, naDev jabwI'mey) 'ej **chut yIpol**, ghIq **PII nejwI' yIchov** ghItlh chovnatlh tlhej — **Hop model Hevbogh rur** 'oH Hop pat Suqbogh'e'.
4. [SeH'egh](/docs/tlh/agents/autonomy/) (chaw'mey) 'ej [peghmey](/docs/tlh/admin/secrets/) je yIlo'.
5. latlh De'wI'mey SSH: [Nodes](/docs/tlh/admin/nodes/) — QIH pabmey force flag poQ.

## laHmey

| Daq | He / QIj |
|-----|----------|
| **Hub lojmIt** | QIHbogh janmey Qappa' Qap poH chut |
| **Hub wanI'mey** | `/security` wanI' He, **EYAS Hur qawHaq** 'emwI' tlhej |
| **chov** | `/audit` ta' qun choHlaHbe'bogh |
| **pegh** | `/privacy` lengwI' mI'mey, pegh chut choHwI', nejwI' chov |

### Internet jan SSRF Hub {#browser-ssrf-protection}

**private / metadata** janmeyDaq tlhobmey bot Internet janmey (chal metadata, loopback, RFC1918, latlh je), De'wI' tlhob ngeb QIH machmoHmeH. mIw neH poQchugh ghoqwI'pu', mIllogh ghobe' — `browser_snapshot` yIlo' (mI'lu'bogh Dochmey). jaHDI' mI'mey Hegh. Headless profile EYAS ghaj (`data/browser/profile`); jaj Chrome profile lajQo'lu' (Chrome 136+ Default profile CDP bot). `browser_evaluate` navDaq Qap, Node ghobe'. `browser_totp` **SuD**: peghmey/Keychainvo' ngoq laD 'ej poH ngaj mI' neH nob (`browser_fill`Daq yIngeH). action cache JSON locator neH pol, pegh pagh ghItlhlu'bogh De' not. chaw'lu'bogh [Browser Use](/docs/tlh/automation/browser-use/) sidecarmey (QaQ: agent-browser, `data/browser/agent-browser/profile`; ngo' Python CLI) Chromium Hung chu'Ha'moHbe' not, `chat` / AI Gateway ra'be' not, 'ej jaj Chrome profileDaq rarbe' not.

### laD neH git, chaw' Hutlh {#read-only-git-without-a-click}

`git_status` `git_diff` je SuD. `run_command` / `Bash` ngeHchugh pat 'ej argv Sovlu'bogh `git status` pagh `git diff` 'oHchugh (metachar Hutlh, `-C` / `--git-dir` / `--no-index` Hutlh, He naQ Hutlh), janmeyvetlhDaq ra' vIHmoH lojmIt 'ej **chaw'** — chaw' tlhegh pagh. `git commit`, `git add`, `ls`, metachar ghajbogh Hoch ra' je Doq taH pagh lajQo'lu'. [janmey](/docs/tlh/automation/tools/).

### Hub noHwI' {#security-judge}

SuD Doq je jan ra'mey Qappa' AI chov Suq. chovvetlh EYAS 'em patDaq wa' nIteb ra' mach 'oH — jan pagh, ja'chuq qun pagh, CLI qawHaq SeH je laDbogh CLI session not. **Heartbeat** He patlh lo', ghIq **Quick**, ghIq lIng motlh, ghIq latlh lo'laHbogh nobwI'pu' (Hoch API nobwI', Claude Code, Grok CLI — nobwI' lIngDI' (tagh, lIng chu', chu'qa') nIteb chovDaj pagh mIw session tagh QapDI' — Kimi Code CLI je — De'wI'vamDaq session taghta'DI'; EYASvaD 'ellu'pu'DI' lIngDI' model nejmeH ghoch 'oH je). cha'DIch pat nIDlu' ghom, poH natlh, ngeb, pagh Do 'aqroS Qagh ret neH.

pat lo'laHbe'lu'chugh (Grok neH lIng, nIteb wej chovlu'bogh rur), Huch mevlu'chugh, pagh Hoch nID luj, ra' **chaw'lIjDaq vIHlu'** (chaw' tlhob tetlhDaq) — not chaw'lu'. ngo', AI chov lujDI' ra' botlu' naQ. ghoqwI' SeH'egh Segh patlh 3 (**Auto**) 'oHchugh, tlhobbe'taHvIS ra' Qap EYAS — AI nobwI' cherlu'be'DI' ngo' ta'bogh rur. chov laDlaHbe'bogh jang ra' lajQo' taH. Claude Code neH pat 'oHbogh lIngDaq, Hoch AI chov wa' Claude Code Qap mach nIteb tagh.

### EYAS Hur qawHaq {#memory-outside-eyas}

EYAS Hur qawHaq lajQo' Hub lojmIt — **laD ghItlh je** — Hoch patvaD 'ej chovbogh Hoch jan ra'vaD. lajQo'lu':

- latlh QaHwI'pu' qawHaq Dotlh je: Claude Code (`~/.claude`, `~/.claude.json`), Grok, Codex, Gemini, Kimi, Cursor, Windsurf, OpenCode pa'mey, nobchuqbogh ghoqwI' laH pa'mey, Copilot, latlh lo'wI'pu' juH pa'Daq rap pa'mey, Hoch `ai-memory` pa', 'ej jan pa' qoDDaq Hoch qawHaq pa';
- Obsidian vaultmey (`.obsidian` pa'chaj pagh Obsidian vault tetlh lo'taHvIS tu'lu') 'ej Obsidian ghun SeHmey;
- `security.foreignMemoryPaths` tetlhDaq Hoch He (taghDI' laDlu'; naQ He 'oHbe'bogh Dochmey buSHa'lu', logDaq ghuHmoHwI' tlhej);
- EYAS De' pa''egh — vault, De' pa' (`database.path` latlh DaqDaq 'oSDI' je), ngoqmey, browser lo'wI' De', 'ej EYAS ghajbogh CLI 'elmeH pa'mey (`data/cli-homes`);
- latlh ja'chuq vum pa', ra' vum pa'mey Sovlu'DI'.

chaw'lu' taH: ja'chuq vum pa''egh pa'meyDaj je, Studio Qu'mey (`data/studio`), browser qem (`data/browser/downloads`), 'ej motlh Qu' teywI'mey — `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.claude/agents`, `docs/MEMORY.md` rur. Hemeyvam *ja'bogh* neH teywI' QaQ — He noH lojmIt, ngaSbogh ghobe' — 'ej Grep nejmeH mIw He rur not buSlu'.

**nuqDaq Qap:** EYAS ghoqwI' mIw'egh Qapbogh EYAS janmey (API nobwI'pu'); jan rarwI' lo'taHvIS Grok Kimi je ra'bogh EYAS janmey (mIw pa'mey Sov rarwI' De'wI'Daq, 'ej tlhob pa'mey Daj pong not); chaw' tlhobbogh Hoch Claude Code jan ra'; Claude Code janmey'egh (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch, …) — Hoch **Qappa'** wa' chov Suq, vum pa'Daj qoDDaq Claude Code chaw''eghbogh laDmey je; Hoch Grok/Kimi chaw' tlhob (Hoch janmeyDaj'egh tlhob Grok, laDmey je); 'ej EYAS lo'taHvIS Grok pagh Kimi laDbogh ghItlhbogh Hoch teywI'. ja'chuq pa'mey 'Iv wuq EYAS — chovlu'DI' lughtaHbogh pa'meyDaj 'ej CLI taghbogh pa' — nuqDaq CLI 'oH ja'bogh ghobe' not. OpenCode Qu'mey mIw rap chovlu', Qu' pa'mey tlhej. EYAS ghajbogh juH'eghDaq Qap Grok, Kimi, OpenCode je; juHvetlh 'oS `~` `$HOME` je: chaH lo'bogh He, juHvetlh 'ej juHlIj je rurmo' chovlu', vaj EYAS De' pagh latlh CLI 'el pa' SuchlaHbe' `~/../../vault` pagh `$HOME/../../sqlite`.

**nuq ngaSbogh pa', vaj pa' noHlu'.** vum pa'Daj qoDDaq tlhobbe'taHvIS laD nej je Claude Code rurbogh CLI — QapwI' netDaq tobmoH nob chov: laDmeyvetlh chaw' mIwDaq ghoSbe' not. vaj ja'chuq, Qu', Qu' Segh **pa'** lajQo'lu', Dung Daqmey qoDDaq tu'lu'DI' neH ghobe', wa' **ngaS**DI' je: EYAS juH'egh, De' pa''egh, De' pa', vummeH Daqmey pa' je (`data/` ngaSbogh EYAS Hal lIng rur), latlh AI jan polmeH Daq pagh EYAS CLI 'el pa', ghItlhHom vault, `ai-memory` pa', pagh `security.foreignMemoryPaths` Doch (vault ngaSbogh `~/Documents` rur). ngo' qonlu'bogh 'ej DaH lajQo'lu'bogh pa'mey Hoch Qapvo' chIllu', ja'chuqDaq QIj tlhej. [ja'chuqmey — pa'mey](/docs/tlh/daily/conversations/#working-folders). Claude CodeDaq, vum pa'Daj qoDDaq Claude Code chaw''eghbogh laDmey lajQo' qawHaq chut chov je — naQ pagh naQbe'bogh He, symbolic link, Grep, Glob, LS, pagh shell `cat` lo'taHvIS SIchlu'bogh vault pagh EYAS De'; QapwI' netDaq tobmoHlu'.

**nej, nuq SIchlaH, vaj noHlu'.** CLI janmey'egh nej lajQo'lu', pa'Daj Hublu'DI' neH ghobe', nejlu'bogh pa' Hublu'bogh Daq **ngaS**DI' 'ej 'el globmeyDaj SIchlaHDI' je: Daqvetlh buSHa'meH CLI ra'laHbe'lu', vaj Qappa' ra' lajQo'lu'. Claude Code Grep, Glob, LS je; Grok grep list_dir je; OpenCode grep, glob, list je; 'ej Claude Code Bash, Grok shell, EYAS `run_command` je lo'taHvIS Qapbogh, qoDDaq nejbogh shell ra'mey — `grep -r`/`-R`, `rg`, `ag`, `ack`, `find`, `fd`, `tree`, `du`, `ls -R`, qoDDaq Qapbogh `cp`/`rsync`/`scp`/`zip`/`tar`/`ditto`, `locate`/`mdfind`, `git grep --no-index` — pagh `cat ~/.*/projects/*/memory/*.md` rurbogh glob mu'mey lo'bogh ra'mey je chovlu'. Hublu'bogh Daqmey: Dung tetlhlu'bogh Daqmey.

- **lajQo'lu'**, rur: `~`Daq Grep, glob `**/memory/*.md` tlhej; `~`Daq `**/MEMORY.md`vaD Glob; `grep -r token ~`; vault qoDDaq tu'lu'DI' `~/Documents`Daq Grep; EYAS Hal lIng pagh lIng Dung pa' He 'oHbogh Grep, `grep -rn x ~/GitHub` rur, lIng ngaSDI' (`data/` ngaS lIng).
- **chaw'lu' taH:** Hublu'bogh Daq SIchlaHbe'bogh pa'Daj pagh globDaj ghajbogh nej — lIng `src` pa' He 'oHbogh, pagh lIng He 'oHtaHvIS glob `src/**/*.ts` rur — 'ej motlh Qu' pa'Daq Hoch nej. here-document lo'taHvIS teywI' ghItlhlu'chugh (`cat > a.ts <<'EOF'` … `EOF`) nej 'oHbe': De' neH 'oH tlheghmeyDaj, glob mu'mey pagh ra'mey 'oHbe' not. nej machmoHbe' chIlmeH globmey (`!…`). ripgrep rur, Hoch patlhDaq rap `/` Hutlhbogh glob (`*.md`), vaj Hoch pa'HomDaq SIch; shell glob mu'mey ghItlhlu'bogh DaqDaq rarlu'.
- **lajQo' rap.** latlh qawHaq He lajQo' Hoch rur 'oH, ral 'ej reH rap: AI noHwI' pagh, chaw' tlhob pagh, chaw' nob poSmoHlaHbe', 3-lajQo' ngaQDaq toghlu'be', 'ej Hub lojmIt chu'Ha'lu'DI' je Qap. **Hub wanI'mey**Daq wa' **yIqIl** tlhegh ghItlh (checkpoint `deterministic`) 'ej [EYAS Hur qawHaq 'emwI'](#memory-outside-eyas-card) lajQo' mI'Daq toghlu'.
- **chay' Daqmey tu'lu'.** EYAS ponglu'bogh Daqmey Sovbogh reH chovlu': latlh jan pa'mey, qonlu'bogh Obsidian vaultmey, `security.foreignMemoryPaths`, EYAS De' pa''egh De' pa' je, CLI juHmey, latlh ja'chuq vum pa'mey je. `.obsidian` pa'chajvo' neH Sovlu'bogh vaultmey, `ai-memory` pa'mey, jan pa'mey qoDDaq qawHaq pa'mey, 'ej Hublu'bogh DaqDaq ghoSbogh symbolic linkmey nejlu'bogh pa'Daq 'aqroS ghajbogh nej tu'lu': wa'DIch 2,000 pa'mey, 8 patlh 'ach, `node_modules` pagh `.git`/`.hg`/`.svn` qoDDaq not. 'aqroSvetlh Hur ponglu'bogh Daqmey neH chovlu'. shell ra' laD nID neH 'oH: Dochmey (variables) tlha'lu'be'; `cd`, `eval`, `sh -c`, here-documentvo' ghItlhDaj laDbogh shell, ponglu'pu'bogh mu'mey (`if`, `then`, `do`, `{`, `!`), `2>/dev/null` rurbogh He choHmey, `~/{.,}` rurbogh wIv mu'mey je tlha'lu'. `xargs` pagh `parallel` QapmoHbogh nej, ra' tlhegh 'anglu'be'bogh 'elvo' pa'mey Suq, vaj `/` nej 'oH.
- **EYAS `grep` `glob` je'egh** pa'vetlhvaD lajQo'lu' not: Hublu'bogh pa'mey chIl, 'ej DaH Hublu'bogh teywI'mey je — nejlu'bogh pa'Daq pollu'bogh De' pa', pagh `security.foreignMemoryPaths`Daq tetlhlu'bogh teywI', ponglu'DI' je.
- **Kimi Code CLI** (kimi-cli 1.52.0 Halvo'; qachDaq chovlu'be'): EYAS tlhob not Kimi Grep Glob je'egh, vaj Hublu'bogh Daq Dung taghbogh Kimi nej lajQo'laHbe' EYAS. vum pa'Daj qoD taH Kimi Glob, 'ach Hoch pa' laj Grep, 'ej kernel teywI' Hung ghajbe' Kimi. EYAS tlhob Kimi shell ra'mey, 'ach He chov laDlaHbogh mIw ra' qengbe' tlhob, vaj AI noHwI' pagh ghot wuq.

**chay' lajQo':** SIbI' 'ej reH rap. AI noHwI' pagh, chaw' tlhob pagh, 'ej chaw' pagh nob poSmoHlaHbe'. lajQo'vam 3-lajQo' ngaQDaq toghlu'be', vaj lajQo'lu'bogh He nIDqa'bogh pat 10 tup latlh janmey ngaQmoHbe'. Hub lojmIt chu'Ha'lu'DI' je Qap. Hoch lajQo' **Hub wanI'mey**Daq wa' tlhegh 'oH — wuq **yIqIl**, checkpoint `deterministic`, meq je. chov luj ngaQ: jangchoHlaHbe'chugh, ra' lajQo'lu'. jan Hutlhbogh wa'logh 'em ra' neH Qap chov Hutlh.

**pat ja'lu'bogh:**

- *Memory outside EYAS (&lt;store&gt;) — use memory_search / memory_expand from EYAS*
- *EYAS data directory (&lt;part&gt;) is read and written only by EYAS*
- *EYAS-owned CLI home (cli-homes) is read and written only by EYAS*
- *Not this conversation's workspace (…) — work in this conversation's folders*
- *Search too broad [memory-path:search-scope:&lt;target&gt;]: the folder searched contains &lt;what&gt;, and this tool cannot leave it out — search a narrower folder that does not contain it* — latlh jan qawHaqvaD chellu' *; for memory use memory_search / memory_expand from EYAS*. target: `foreign-memory`, `eyas-data`, `provider-home` pagh `other-workspace`. ja'chuq **lajQo'lu'** jan tlhegh mughlu'bogh tlheghDaq moj, rur *nej tIn law': latlh jan qawHaq ngaS pa'vam; EYAS neH laDlaH. pa' mach nejmeH model tlhoblu'.* — pagh EYAS De', EYAS CLI 'elmeH De', pagh latlh ja'chuq vummeH pa'.

meq patDajDaq ngeHbe' Grok CLI: Grok jan ra' lajQo'DI' EYAS, jangvetlh rInmoH Grok, 'ej lajQo'lu'bogh jan tlhegh 'ang ja'chuq, ghIq pagh. mIwvetlh Hutlh yItlhobqa' — *nej tIn law'* lajQo'DI', pa' mach tlhej. Claude Code taH 'ej meq Suq, vaj pa' machDaq nejqa''eghlaH. [nobwI'pu' — Grok CLI Kimi Code CLI je](/docs/tlh/ai/providers/#grok-cli-and-kimi-code-cli).

**kernel 'ay'.** ra' ghItlh 'angbe'bogh He SIchlaH shell ra'mey, 'ej CLI janmey 'op EYAS tlhobbe' not. chaHvaD, OS teywI' Hung (macOS Seatbelt, Linux bubblewrap) qoDDaq Qap Claude Code shell Grok CLI janmey'egh je, 'ej kernelDaq Daqmey rap bot: latlh jan qawHaq, EYAS De' pegh, latlh ja'chuq vum pa'mey je. `security.cliSandbox: auto` (motlh) tlhej, tu'lu'be'DI' Hung Hutlh Qap CLI 'ej wa'logh ja' ja'chuq; `required` tlhej, mIwmeyvetlh lajQo'lu'. `auto`Daq, Hung Hur Qap 'e' tlhobbogh Claude Code ra' reH ghot chaw' loS — AI noHwI' not, SeH'egh patlh not. kernel teywI' Hung ghajbe' Kimi Code CLI, vaj EYAS leghDI' neH chovlu' laD, grep, glob janmeyDaj'egh. [nobwI'pu' — kernel teywI' Hung](/docs/tlh/ai/providers/#kernel-file-sandbox). [De' tlhap](/docs/tlh/admin/data-port/) choHbe'lu': latlh jan pa'mey laD'egh, pat jan lo'be'.

**vIHmoH.** ngo' `~/.claude/CLAUDE.md`, `~/.grok` qawHaq, vault ghItlhHommey, pagh `data/` bIng teywI'mey laDbogh ghoqwI'pu' DaH lajQo'lu' (Hub wanI'mey 'ang). De' tlhap lo'taHvIS wa'logh Sovvetlh EYASDaq yIqem. CLI janmey'egh lo'taHvIS juH naQ pagh Dung pa' nejbogh ghoqwI'pu' pagh motlhmey lajQo'lu' je: pa'HomDaq yIghoSmoH, pagh Hublu'bogh Daqmey chIlbogh EYAS `grep`/`glob` yIlo'. Hublu'bogh Daq ngaSbogh **pa'** — EYAS Hal lIng, vault ngaSbogh `~/Documents` — lajlu'be'choH: pa' mach yIwIv, `~/Documents` qoDDaq Qu' pa' pagh Qu' qach cha'logh rur. EYAS Hur qawHaq polbogh MCP De'wI'mey botlu' je — [MCP](/docs/tlh/ai/mcp/#memory-store-servers-are-blocked).

### EYAS Hur qawHaq 'emwI' {#memory-outside-eyas-card}

**Hub wanI'mey** nav (`/security`) **EYAS Hur qawHaq** 'emwI' tlhej poS. joH SeHwI' je neH legh, De'wI'Daq He naQ 'angmo'; latlh lo'wI'pu' tagh Qagh Suq, He pagh. 'ang:

- **Qav 24 repvaD cha' mI'.** *qawHaq chut qIlmey* — Hoch HeDaq qawHaq chut lajQo'bogh jan ra'mey: latlh jan qawHaq, Obsidian vault, EYAS De' pa''egh, De' pa', CLI 'elmey, pagh latlh ja'chuq vum pa' laD pagh ghItlh, 'ej pa'chaj wa' ngaSmo' tIn law'bogh nej rur lajQo'lu'bogh nejmey. *Hung mej 'e' tlhobbogh ra'mey* — kernel Hung Hur Qap 'e' tlhobbogh 'ej ghotvaD chaw'meH vIHlu'bogh shell ra'mey.
- **QInvamDaq latlh jan qawHaq** — naDev tu'lu'bogh latlh AI jan ghItlhHom ghun je Sovlu'bogh pa'mey (`~/.claude`, `~/.grok`, `~/.codex`, OpenCode pa'mey, Obsidian ghun SeHmey rur), Hemeychaj tlhej, 'ej tu'lu'choHDI' Hublu'bogh latlh Sovlu'bogh Daqmey mI'. wa' mu'tlhegh ja' latlh nuq Hublu' nuqDaq 'ach: `.obsidian` pa' ngaSbogh Hoch pa' (Obsidian vault), `ai-memory` ponglu'bogh pa'mey, 'ej `.claude`, `.grok`, `.codex` rurbogh jan pa'mey qoDDaq qawHaq pa'mey.
- **Obsidian vault tu'lu'pu'bogh** — Obsidian vault tetlh'eghvo' vaultmey, 'ej jan ra'mey chovtaHvIS `.obsidian` pa'chajvo' EYAS Sovbogh vaultmey. tetlhbe'lu'bogh vault `.obsidian` pa'Daj Hub taH.
- **chel'meylIj (security.foreignMemoryPaths)** — SeHvo' latlh Hemey. wej tu'lu'be'bogh Hemey *QInvamDaq tu'lu'be' naDev* per ghaj; naQ He 'oHbe'bogh Dochmey *buSHa'lu'* per ghaj. latlh pa' pagh teywI' DaHubmeH, SeH teywI'Daq `security.foreignMemoryPaths` Daq He naQDaj yIchel 'ej EYAS yItaghqa' (taghDI' tetlh laDlu').
- **EYAS De' mach** — De' pa', De' pol, CLI 'elmey (EYAS ghajbogh CLI juHmey). EYAS neH laD ghItlh je chaH; ja'chuq vum pa'chaj, Studio Qu'mey, browser qemmey je lo'laH patmey.
- **ja'chuq Qu' Daqmey** — vum pa'mey Hur. naDev Hoch ja'chuq pat vum pa'Daj neH legh.
- **CLI nobwI' kernel teywI' Hung** — `security.cliSandbox` mIw (`auto` pagh `required`), 'ej Hoch chu'lu'bogh CLI nobwI'vaD (Claude Code, Grok CLI, Kimi Code CLI) kernel HungDaq janmeyDaj'egh Qap'a': *Qap*, *tu'lu'be'* pagh *QaHbe'*, meq tlhej (bubblewrap chellu'be', socat Hutlh — Claude Code poQ —, user namespace chu'Ha'lu', OS QaHbe'lu', pagh Hung nobbe' CLI). `required` tlhej Hung Hutlh, CLIvetlhDaq janmey ghajbogh mIwmey lajQo'lu' ja' 'emwI'. `auto`Daq *tu'lu'be'* pagh *QaHbe'* tlhej, Hung Hutlh Qap CLI janmey'egh 'ej leghbogh Hoch jan ra' chov EYAS taH. `auto` tlhej 'ej Claude Code Hung Qap, Hung Hur Qap 'e' tlhobbogh Claude Code ra' reH ghot chaw' loS.

**API.** `GET /api/v1/security/memory-policy` (`SecurityEvent` laD). SeH chu' pagh, env chu' pagh.

### AI ra' janmey nIteb Qap {#ai-command-line-tools-run-isolated}

- **Claude Code** reH nIteb Qap: qach `settings.json`, `CLAUDE.md`, laHmey, MCP De'wI'mey, auto-qawHaq pagh; qachDaq ja'chuq qon pagh; chaw'lu'bogh tetlh neH env; 'ej latlh laDlu'chugh Qap mevmoHbogh tagh chov. [nobwI'pu' — Claude Code nIteb](/docs/tlh/ai/providers/#claude-code-isolation).
- **Grok CLI Kimi Code CLI je** EYAS ghajbogh juHmeyDaq Qap (`data/cli-homes/…`, EYASvaD 'elmeychaj ngaSbogh), janmeychaj'egh Qappa' EYAS tlhob, 'ej nIteb chaH 'e' chovta'DI' EYAS neH Qap — chov lujbogh mIw mev, 'ej latlh patDaq vIHlu' not. [nobwI'pu' — Grok CLI Kimi Code CLI je](/docs/tlh/ai/providers/#grok-cli-and-kimi-code-cli).
- **OpenCode**, chaw'lu'bogh sidecar, EYAS ghajbogh pa'Daq Qap (`cli-homes/opencode`, 'elDaj ngaSbogh), 'ej qach QaHwI' ra'mey, laHmey, Qu' SeH je laDbe'. Hoch jan ra'pa' EYAS Hub lojmIt tlhob headless OpenCode Qu'mey. laD neHbogh `memory_search` / `memory_expand` neH lo'taHvIS EYAS qawHaq laD OpenCode; qawHaq ghItlhbogh jan ghajbe'. EYAS taghbogh Hoch OpenCode Qap ngoq'egh Suq teywI' ngu'wI' (file descriptor) 3Daq — env, ngoQ tetlh, teywI' je qoDDaq not — 'ej Qapvetlh tlhej Hegh ngoqvetlh. OpenCode mej not ngoq'egh: Hoch qawHaq ra' wa'logh tob ngeH, jan Qapbogh OpenCode poH wa'vaD, vaj model Qapbogh ra' pagh latlh Qap latlh poH qawHaq laDlaHbe'. ratlhbogh veHmey: env'eghvo' neH De'wI' mu'ghom laD OpenCode, vaj latlh Qap env laDlaHbogh OS lo'wI' rap Qap OpenCode API'egh lo'taHvIS OpenCode De'wI'vetlh poHmey SeHlaH; kernel teywI' Hung ghajbe' OpenCode; 'ej latlh Qap qawHaq laDlaHbogh Qap ngoq SIchlaH. Hur OpenCode De'wI'vaD rar URL nIteb 'oHbe', 'ej EYAS qawHaq SIchlaHbe'. [OpenCode](/docs/tlh/automation/opencode/#eyas-memory-inside-opencode).
- **kernel teywI' Hung.** tu'lu'DI', OS teywI' HungDaq Qap Claude Code shell ra'mey Grok CLI janmey'egh je (`security.cliSandbox`); ghajbe' Kimi Code CLI. [nobwI'pu' — kernel teywI' Hung](/docs/tlh/ai/providers/#kernel-file-sandbox).

### chay' nIteb tobmoHlu' {#how-isolation-is-proven}

Hoch CLI Qap taghDI' chovlu' (Dung yIlegh). 'ej EYAS QaHbogh Hoch CLI chovnatlh chu' nobpa' **nob chov** tobmoH: `bun run test:live-cli`, QaptaHbogh ghunwI'pu' nobmeH yepwI'pu' je. EYAS nobwI'pu''egh lo'taHvIS Claude Code Grok CLI je teH tagh (Kimi Code CLI je, chellu'DI'), Qopbogh juHDaq, mIQtaHghachmey tlhej: Hoch chaw'bogh qach SeHmey, Qapchugh ghItlh lIjbe'bogh hookmey MCP De'wI'mey je, `CLAUDE.md`, `AGENTS.md`, laHmey, Obsidian rurbogh vault, SeH'egh ghajbogh Qu' pa' je. Dil Hutlhbogh 'ay' Hoch pat tlhob juH De'wI'Daq ngebbogh patDaq ngeH: chelwI' poQbe' 'ej token lo'be'. Dil poQbogh 'ay' teH pat mIwmey Qap, joH 'el'egh lo'taHvIS; Hoch Qapvetlh chaw'nIS.

tobmoH chov:

- qach pagh Qu' SeH, ra' teywI', hook, MCP De'wI' je laDlu'be';
- Grok laDbogh Hoch teywI' EYAS lo'taHvIS tlhoblu', 'ej Hur taH vault;
- vault EYAS De' pa''egh je lajQo' EYAS qawHaq chut;
- Claude Code shellDaq So'lu'bogh vault laD mevmoH OS teywI' Hung;
- motlh vum pa' laD Qap taH;
- EYAS CLI juHmeyDaq session pol ratlhbe';
- qach juHDaq pagh choH Grok Kimi je;
- qachDaq wa' tetlh mach, mI'lu'bogh, De' qon teywI'mey neH ghItlh Claude Code — ja'chuq ngaS not;
- Claude Code ngaj pa' — 'em shell ra'mey ghum ghoSnISbogh — EYASDaq Qap pa''egh 'oH, 'ej Qap rInDI' ghoS — qach `/tmp/claude-<uid>`Daq pagh ratlh.

tetlhvetlh: `~/.claude.json`, tagh qon ngoqmey neH (wa'DIch tagh, vIHmoHmey, feature-flag cache, plugin lo' mI'mey), 'ej qa'meyDaj ngaQ pa'Daj je; `~/.claude` `~/.config/anthropic` je bIngDaq session per pa'mey chImbogh; ja'chuq ngaSbe'bogh shell mIlloghmey; `~/.npm/_logs`Daq `npm root --global` npm log'egh; PATHDaq `node` Bun 'oHDI', Bun cache; 'ej Keychain ghajbe'bogh qachDaq, 'el chu'qa' teywI'. ja'chuq qon, Qu' tetlh, teywI' qun, nab, mu'tlhegh qun je not.

**qawHaq chov.** Claude Code Grok CLI je DaqDaq, teH Hub lojmIt lo'taHvIS qawHaq chut chov je. `security.foreignMemoryPaths`Daq neH ghItlhlu'bogh pa' lajQo'lu' — pat teywI' laD'egh 'ej shell `cat` je — 'ej EYAS vaultDaq ghItlh lajQo'lu'. Hoch lajQo' Hub wanI'meyDaq qawHaq chutvo' wa' **yIqIl** tlhegh neH 'oH (checkpoint `deterministic`, Do 'aqroS ngaQ not) 'ej lajQo'lu'bogh wa' jan tlhegh. lajQo'meyvetlh ret vum pa' laD Qap taH, 'ej lajQo'lu'bogh pa'vo' pagh patDaq ghoS. nej chov cha' latlh Dil Hutlhbogh mIw: Claude Code Grep, Glob, `grep -r` je, 'ej Grok grep list_dir je, weQ ngaSbogh juHDaq taghlu'DI', Hoch lajQo' qawHaq chut Hub lojmIt net lo'taHvIS — qonlu', lajQo'lu'bogh jan tlhegh tlhej — 'ach Qu' pa' nej Qap taH. wejDIch mIw 'ang: EYAS chaw' chov tlhobbe'taHvIS vum pa'Daj qoDDaq teywI' laD Claude Code, 'ej vaultDaq ghoSDI' laDvetlh lajQo' qawHaq chut chov.

**tobmoHlu'bogh chovnatlhmey:** Claude Code 2.1.281, Grok CLI 1.0.41 je, Dil Hutlhbogh 'ay' neH. wej tobmoHlu' Kimi Code CLI, 'ej qawHaq chov ghajbe'. tagh chovmeyDaq cha' tu'mey chellu':

- `agents-md` `telemetry` je — binaryDaq chenmoHlu'bogh cha' plugin ja' Claude Code 2.1.281. `<pong>@builtin` rur neH lajlu', EYAS nIteb bIngDaq Qobbe' chaH 'e' tobmoHmo' chov: vum pa'vo' pagh pa' Hommo' `AGENTS.md` patDaq ghoSbe'. latlh Hoch plugin — Claude Code chovnatlh ret chu' builtin je — Qap mevmoH taH.
- nobwI' SeHlu'bogh SeHmey cache (`managed_config.toml`) EYAS juHDajDaq ghItlh Grok CLI 1.0.41; motlh chelwI'vaD chIm. chImbogh lajlu'; SeH ghajbogh mIw mevmoH taH.

**`eyas doctor`** Hoch CLI nobwI'vaD wa' tlhegh 'ang: *CLI isolation (Claude Code)*, *CLI isolation (Grok CLI)*, *CLI isolation (Kimi Code CLI)*. Hoch EYAS Qapbogh binary pong — chay' tu'lu' (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, PATHDaq, pagh SDK ngaSbogh), HeDaj, chovnatlhDaj je — 'ej chovnatlhvetlh tobmoH'a' nob chov. latlh chovnatlh, chovnatlh ja'be'bogh binary, pagh not tobmoHlu'bogh CLI — ghuHmoH 'oH, mev ghobe': taghDI' Hoch session chov EYAS taH. chellu'be'bogh CLI QaQ; lughbe'bogh `EYAS_*_BIN` luj. Grok Kimi jevaD, EYAS juHchaj chov je tlhegh, `<De' pa'>/cli-homes/<nobwI'>`: wej chenmoHlu'be'chugh QaQ; symbolic link pagh pa' 'oHbe'chugh luj (CLI Qapbe' EYAS; yIteq, veb Qap chenmoHqa'); latlh lo'wI'pu' laDlaHchugh ghuHmoH, CLI 'el ngaSmo' (`chmod 700 <pa'>`); naDev EYAS SeHbogh teywI' choHlu'pu'chugh EYAS ghItlhpu'DI', ghuHmoH — veb Qappa' teywI'meyvetlh ghItlhqa' EYAS, vaj cha' Qap joj choH 'oHchugh, pa'vetlh choH latlh Doch. laD neH doctor: `--version` neH Qap. [CLI](/docs/tlh/deploy/cli/).

### nobwI' qawHaq yIbotmoH {#quarantine-a-providers-memory}

EYAS nIteb Hutlh Qappu'chugh pat — motlh Grok CLI, Kimi CLI pagh Claude Code rurbogh CLI — EYAS Hur qawHaqvo' janglaHpu', 'ej latlh mIw rur EYAS qawHaqDaq jangmeyDaj pollu'. wa' nobwI' ghItlhbogh Hoch patvo' So'laH joH — jangmeyDaj jan jangmey je, chaHvo' tu'lu'bogh vItmey Dovmey je, ja'chuqmeyDaj capture ghItlhHommey je — 'ej ghIq tlhabmoHlaH. pagh teqlu', 'ej joH QInmey'egh Hotlu' not. **qawHaq → Hoch Del**Daq 'emwI' tu'lu'; [qawHaq — nobwI' qawHaq yIbotmoH](/docs/tlh/knowledge/memory/#quarantine-a-providers-memory). Hoch botmoH tlhabmoH je chov logDaq ghItlhlu' (`memory.quarantine.apply` / `memory.quarantine.release`).

### Hop node SSH {#remote-node-ssh}

Hop node **SSH ra'** (Nodes lo'taHvIS) Hublu'bogh ra'mey Qap; **QIHbogh** ra' pabmey force flag naQ poQ. SSH 'oHbe'bogh node Seghmey ra'vaD "not-implemented" jang.

### qawHaq ratlhtaHvIS {#memory-at-rest}

vault ghItlhHommey pegh patHom So' *teywI'Daq ghItlhpa'*, laDDI' ghobe' — laDDI' So'lu'chugh, teywI'Daq 'ej FTS indexDaq ghItlh tlhol ratlh. Hop pat ngeHmeH rap mIw, rap chutmey: jajmey ratlh, 'ej mask- block-Segh De' qa'lu' — ghItlhHomDaq IBAN `[IBAN]` moj (ngo' chovnatlhmey ghItlhHommeyDaq QIn Daq ghogh mI' je neH qa'). ja'chuq qon tlhol, ja'chuq Dovmey, vItmey je EYAS qoDDaq So'be'lu'; EYAS mejDI' neH So'lu'. capture'egh chu'moH `config/default.yaml`Daq `memory.capture.enabled` (motlh **chu'**). [qawHaq](/docs/tlh/knowledge/memory/), [FAQ](/docs/tlh/reference/faq/).

**pat ghItlhbogh ghItlhHommey ra' SeHwI' lu'el.** pat ghItlhbogh vault ghItlhHommey — Hoch mIw qawHaq capture, ram boq Dovmey, ghom qep Dovmey je — vItmey Dovmey jevaD EYAS lo'bogh SeHwI' rap lu'el. QaHwI'vaD ra' rurbogh ghItlh (*ignore previous instructions*, *from now on you are…*, `<system>` per ngeb, *delete all memory* — DIvI' Hol, Hungarian, German, Spanish, French je) ghItlhlu' not. De'wI' logDaq lajQo'mey 'ang, SeHwI' pong tlhej, ghItlh ghobe' not. frontmatterDaq `origin` ghaj Hoch ghItlhHomvetlh je, 'ej pat ghItlhbogh rur qawlu', mu'meylIj rur not. [qawHaq — qatlh mu'tlheghmey 'op lajQo'lu'](/docs/tlh/knowledge/memory/#why-some-sentences-are-refused).

## pegh chut {#privacy-policy}

EYAS De'Daj tlhol pol, 'ej **ghItlh EYAS mejDI' Hop patDaq ghot De' So'**. wa' mIw, reH rap, So' — mu'tlheghmey, qawHaq jan jangmey, embeddingmey, vault ghItlhHommey je.

### chay' tu'lu' {#how-detection-works}

chutmey lo', reH rap: ghItlh rap reH rap jang ghaj, 'ej ghot De' tu'meH patDaq pagh ngeHlu'be' not. **tlhegh ngaQ**: cha' tlheghDaq pe'lu'bogh De' tu'lu'be', 'ej ghogh mu' pagh tax mu' mI' rap tlheghDaq neH Qap.

ghot De' 'oHbe' not: jajmey Hoch motlh mIwDaq (`2026-09-08`, `2026.09.30.`, `2026. 09. 30.`, `22.09.2026`, `09/22/2026`), tlhaq poHmey, ISO poH, IP Daqmey, chovnatlh mI' (`1.0.40`, `0.8.29-beta`), Huch mI'mey (mI'Hom, pagh Huch Segh retlh: HUF/Ft/EUR/€/$), 'ej tetlh, ticket, build, commit, poH IDmey, UUID, ULID, hash. mu'tlheghDaq *Current date* tlhegh Hoch patDaq naQ SIch.

### nuq tu'lu' {#what-is-detected}

| Segh | chay' Sovlu' 'ej chovlu' |
|------|--------------------------|
| `email` | motlh QIn Daq mIllogh |
| `phone` | `+` taghbogh qo' mI' (8–15 mI'); bID ghItlhDaq Sep mI' ngaSbogh mI'; Magyar Sep mIw (06/36 + Sep mI' + 6–7 mI'); pagh 7–15 mI', rap tlheghDaq 40 ngutlh nungDaq ghogh mu' ghajbogh. ghogh mu'mey mu' naQ neH: phone, tel, mobile, cell, call, fax, WhatsApp, telefon, mobil, hívj, Handy, Telefonnummer, teléfono, móvil, téléphone, Tél., portable, 'ej latlh. `+` Hutlhbogh, Sep mIw Hutlhbogh, ghogh mu' Hutlhbogh mI' — tu'lu'be' 'e' wIwIv. |
| `iban` | Hoch Sep IBAN, mach pagh loghmey ghajbogh ghommey, mod-97 checksum 'ej Sep 'aqroS lugh chovlu' (ngo' Magyar IBAN neH tu'lu') |
| `bank_account` | Magyar giro mI', 8-8 pagh 8-8-8 mI' (logh pagh tlhegh), 9-7-3-1 checksum chovlu' |
| `credit_card` | 13–19 mI', Huch 'echlet ghom mI' tagh, Luhn chovlu' |
| `ssn` | US SSN `AAA-GG-SSSS`, Sep/ghom/mI' lugh |
| `personal_id` | Magyar ghot ID 'echlet mI' (6 mI' + 2 tIn ngutlh), wa' mu' rur |
| `tax_number` | Magyar tax mI' (adószám, `12345676-2-42`): chov mI' lugh, VAT mI' 1–5, Sep mI' lugh; Magyar EU VAT mI' (`HU12345676`); 'ej Magyar ghot tax ID (adóazonosító jel, 10 mI', 8 tagh) — chov mI' lugh **'ej** nungDaq tax ID mu' (adóazonosító, adószám, tax ID, TIN, Steuer-ID, NIF, numéro fiscal, …) ghajchugh neH. mu' naQ neH: *routine* qoDDaq `tin` pagh *syntax* qoDDaq `tax` pagh QapmoH, 'ej *tax* retlh 10 mI' Duj tax mI' 'oHbe'. |
| `taj_number` | Magyar TAJ mI', chov mI' lugh |

pongmey 'ej QIn Daqmey tu'lu'be'. chaHvaD 'ej latlh ghom De'vaD [mIw DIchenmoHbogh](#custom-patterns) yIlo'.

pat lo'bogh nejwI' tu'lu'be'. ngo' NER nejwI' — juH Ollamavo' mu'tlhegh ngeHbogh, peghlu'taHvIS — teqlu'. `config/personality/privacy.yaml`Daq `privacy.scanners` bIngDaq `ner` taHchugh, buSHa'lu' 'ej logDaq ghuHmoHwI' ghItlhlu'.

### ta'mey {#actions}

wa' ta' Hoch tu'lu'bogh SeghvaD:

| ta' | Qap |
|-----|-----|
| `off` | buSHa'lu' |
| `warn` | toghlu' 'ej logDaq ghItlhlu'; ghItlh choHlu'be' |
| `mask` | EYAS mejDI' Hop patDaq, `[EMAIL]` pagh `[IBAN]` rur Daq pong qa' |
| `block` | mejDI' rap So'lu'; 'ej Hop patDaq ghoSmeH ngaSbogh **chu'** ja'chuq pagh He QIn pollu'pa' lajQo'lu' ([lajQo'lu'bogh QInmey](#refused-messages)) |

motlh: `email`, `phone` **mask**; `iban`, `bank_account`, `tax_number`, `personal_id`, `credit_card`, `ssn` **block**; `taj_number` **warn**.

**So'ghach pat ra' mevmoHbe' not.** mu'tlheghDaq block-Segh De' (qawHaq ghItlhHomDaq IBAN rur) So'lu' 'ej mIw taH; qawHaq capture je lujbe' mIwmeyvamDaq. `block` latlh Qap wa' neH ghaj: DangeHbogh **chu'** QIn lajQo'.

### lajQo'lu'bogh QInmey {#refused-messages}

lo'wI' ngeHbogh **chu'** QIn neH lajQo'laHlu' — ja'chuqDaq, God Mode ja'chuqDaq, pagh HeDaq (Telegram, Slack, Discord, QIn Daq, WhatsApp, Signal, …). patDaq EYAS ngeHbogh latlh Hoch (qun, qawHaq, jan jangmey, ghItlhmey ngaSbogh ghItlh, embeddingmey) lajQo'lu' not; mejDI' So'lu'.

block-Segh De' ngaSDI' QIn **'ej** Hop patDaq ghoSmeHDI' lajQo'lu'. juH: pat jan loopback (`localhost`, `127.x`, `::1`) 'oH, pagh chut local hosts tetlhDaq tu'lu'; CLI nobwI'pu' (Claude Code, Grok CLI, Kimi CLI) 'ej Sovbe'lu'bogh Daqmey Hop rur toghlu'. ghoS: QIn Qapbogh pat (wa' mIwvaD pat choH, ja'chuq ngaQlu'bogh pat, pagh jup pat). Auto cherlu'bogh ja'chuq reH Hop rur toghlu', chov ret Hoch QInvaD patDaj wIvlu'mo' — Hoch DaqDaq Auto He chu'Ha'lu'DI' neH, pollu'bogh patDaj noHlu'. God ModevaD Hoch tetlh ghoqwI' noHlu'; wa' Hop 'oHchugh pagh tetlh chImchugh, QIn lajQo'lu'. chut pagh pegh 'ay' chu'Ha'taHvIS, pagh lajQo'lu'.

- **ja'chuqDaq,** lajQo'lu'bogh QIn pollu'be': qun Doch pagh, pong choH pagh, qawHaq pagh, pat ra' pagh, God Mode qaD pagh. ghItlhwI' Dung **QIn ngeHlu'be' — pegh** 'emwI' Seghmey tetlh (De' ghobe' not) 'ej **De'vam So'lu'DI' yIngeH**, **QIn yIchoH**, **yIwoD** je nob. [ja'chuqmey — lajQo'lu'bogh QInmey](/docs/tlh/daily/conversations/#refused-messages-privacy).
- **HeDaq,** ghItlhmeH lo'bogh Holvetlh (DIvI' Hol, Hungarian, German, Spanish, French, pagh tlhIngan Hol; SovlaHbe'lu'chugh DIvI' Hol) lo'taHvIS nIteb jang Suq ngeHwI', Seghmey pongbogh, De' ghobe' not, 'ej De'vetlh Hutlh ngeHqa' 'e' tlhobbogh. ja'chuq, QIn, ghoqwI' Qap je chenmoHlu'be'; 'el wanI' Dotlh **Haw'** ghaj, Qagh `privacy_blocked` tlhej, 'ej So'lu'bogh ghItlhDaj neH pollu'. [Hemey](/docs/tlh/communication/channels/#refused-messages).
- chut choHpa' pollu'pu'bogh QInmey ghIq lajQo'lu' not.

Hoch lajQo' chov ta' `privacy.inbound_refused` ghItlh, 'ej Hoch *So'lu'DI' ngeH* `privacy.inbound_masked` ghItlh; Seghmey, ja'chuq (ja'chuq) pagh 'el wanI' ID (Hemey), lo'wI' je qon cha' — De' not.

### mIw DIchenmoHbogh {#custom-patterns}

Hoch mIw DIchenmoHbogh ghaj: `name`, `regex`, `type` (ngutlh mach; Daq pong moj, `[INTERNAL_PROJECT]` rur), 'ej `action` Daj. [pegh nav](#privacy)Daq yIchel (50 'aqroS); Segh rap ghajbogh mIwmey wa'DIch mIw Qu' lo'. tlhegh ngaQ: tlhegh pe'wI' juS not, 'ej `^` / `$` tlhegh tagh/Dor. QIHbogh (catastrophic backtracking) pagh chenlaHbe'bogh mIw Skiplu' 'ej De'wI' logDaq ja'lu'. ghItlh chIm rapbogh mIw nejwI' mevmoHbe' DaH.

### naDev jabwI'mey: 'Iv So'be'lu'bogh ghItlh Suq {#local-hosts-who-receives-text-unmasked}

pat Daq De'wI'vamDaq tu'lu'DI' neH ghItlh So'be'lu': loopback (`localhost`, `127.x.x.x`, `::1`) pagh chut **naDev jabwI'mey** tetlhDaq jan (32 'aqroS pong pagh IP, scheme/lojmIt Hutlh). nobwI' ngeHbogh jan wuq — nobwI' pong ghobe' not:

- juH Ollama pagh LM Studio So'be'lu'; **Hop `OLLAMA_HOST` So'lu'**. Hop Ollama janvaD ngo' Ollama chaw' Dalo'chugh, janvetlh naDev jabwI'meyDaq yIchel.
- tetlhDaq Hutlhbogh LAN jan, chal API, Sovbe'lu'bogh Daq, 'ej Hoch CLI nobwI' (Claude Code, Grok CLI, Kimi CLI) Hop 'oH — CLI De' nuqDaq ngeH 'e' leghlaHbe' EYAS.
- ngo' `auto_local` ta' (juH Ollamavo' He choH) teqlu'; ngo' `auto_local` chut `mask` rur Qap, logDaq ghuHmoHwI' tlhej.

### pollu'bogh jangmey (OpenAI) {#stored-completions-openai}

ngaSlu'bogh **OpenAI** nobwI'Daq tlhobmey OpenAI *stored completions* lajQo' naQ — ja'chuq, stream, jan ra'mey je. vaj OpenAI distillation pagh chov laHmeyvaD EYAS ja'chuqmey polbe' OpenAI, OpenAI chelwI'lIj pagh Qu'lIjDaq *store completions* chu'lu'DI' je. SeH poQbe'lu'. `OPENAI_BASE_URL` ngaSlu'bogh OpenAI nobwI' vIHmoHDI' je Qap. OpenAI rap nobwI'pu' (xAI, Mistral, Groq, DeepSeek, rap tetlh latlh je, OpenRouter, Kimi API, LM Studio) per Suqbe', Sovbe'lu'bogh Dochmey lajQo' De'wI'mey 'opmo'; nuq pol chaH — chelwI' SeHmeychaj mabmeychaj je wuq. embeddingmey choHbe'lu'.

### nuqDaq So'lu' {#where-masking-applies}

pat He'a' qoDDaq So'lu', **Hoch nIDDaq, jangbogh nobwI'vaD**. ra' nIDqa'lu'chugh pagh patlh Fallback nobwI'Daq vIHchugh, Hoch nID ghoSDajvaD So'lu': juH Ollama wa'DIch ghItlh tlhol Suq; lujchugh 'ej chal Fallback ghoSchugh, chal nobwI' So'lu'bogh ghItlh Suq. ja'chuq mIw nungbogh He chov mach je So'lu'.

Hop ghoSvaD, So' EYAS:

- pat mu'tlhegh, 'ay' 'ay': qawHaq, persona 'ej ghoqwI' teywI'mey, Qu' De', laHmey, Deghmey, 'ej 'ay'Daq lanlaHbe'bogh ghItlh Hoch;
- ja'chuq qun;
- EYAS qawHaq jan jangmey, Qagh ghItlhchaj je: `memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`;
- Hop embedding nobwI'Daq ngeHlu'bogh ghItlhmey.

So'be'lu':

- EYAS ghItlh'eghbogh 'ay'mey — qa', potlh chutmey, jaj 'ej poH ngaSbogh Qap 'ay', vum pa'mey, jan/laH/ghoqwI' tetlhmey, SeH ra' — vaj DaHjaj jaj 'ej pa'meyDaj mu' mu' laD pat reH;
- vum pa' jan jangmey (teywI'mey, shell, git, grep, Internet jan, ghItlhmey, ngogh nej). CLI Daj janmey So'laHbe'lu', 'ej So'lu'chugh pat choHbogh teywI'meyDaq `[EMAIL]` rur Daq pongmey ghItlhqa'lu'.

EYAS mu'tlheghDaq chelDI' pagh pat qawHaq janvo' SuqDI', qawHaq Doch rap rap So'lu' — mIw rap 'oH. EYAS qawHaq laDmeH pat lo'laHbogh **Hoch HeDaq** teH:

- EYAS qoDDaq jan mIw Qapbogh nobwI'pu' (API 'ej juH nobwI'pu');
- Claude Code in-process EYAS janmey (`mcp__eyas__*`);
- EYAS MCP rarwI' lo'taHvIS Grok CLI Kimi CLI je;
- EYAS MCP De'wI''egh ra'bogh Hur MCP rarwI'pu' (`POST /api/v1/mcp/tools/call`);
- OpenCode sidecar: `opencode_run` Qu' prompt 'ej pat ghItlh rur ngeHlu'bogh qawqa'lu'bogh qawHaq OpenCodeDaq ghoSpa' So'lu' (So'lu'bogh promptvo' OpenCode session pong ghoS), 'ej OpenCode qoDDaq `memory_search` / `memory_expand` jangmey So'lu' je.

CLI, Hur MCP rarwI', OpenCode je reH Hop rur toghlu', Hoch pat QaplaHmo': tlhobDaq pagh juH chenmoHlaH, 'ej naDev jabwI'mey tetlh chaH ngaQHa'moHbe'. mask- block-Segh De' `[TYPE]` Daq pongmey moj; jajmey, poHmey, IDmey, mI'mey, JSON mIw je ratlh.

**luj ngaQ.** pegh nej'egh lujchugh, qawHaq jan jang ngeHlu'be': *Error: memory tool result withheld (privacy scan failed)* Suq pat, 'ej OpenCode Qu' luj *privacy scan failed — the task was not sent to OpenCode* tlhej — OpenCodeDaq pagh ghoS. Seghmey, mI'mey, ngu' je (ja'chuq, Qap, ghoqwI', mIw, jan, ngeH) neH qon log, De' not: *Privacy: masked values in a tool result sent past the model gateway*, pagh *warn-class values in a tool result sent past the model gateway*.

chut choHlu'DI', veb mIwDaq Qap. QaptaHbogh mIw taghDI' chutDaj pol, vaj jan mIw rap So'lu'.

### nuqDaq chut yIn {#where-the-policy-lives}

chut EYAS De' pa'Daq pollu'. `config/personality/privacy.yaml` tIr 'oH: teywI' choHlu'DI' nIteb tlhapqa'lu', taghqa' Hutlh — [pegh nav](#privacy)Daq wa'DIch pollu'pa'. ghIq polta'bogh chut Qap, 'ej teywI' choHmey buSHa'lu', logDaq ghuHmoHwI' tlhej.

`privacy.yaml` Hutlhchugh pagh lughbe'chugh, peghlu'taHvIS motlhDaq cheghbe' DaH: Qagh logDaq ghItlhlu', teywI' He naQ 'ej meqmey tlhej, 'ej Qav QaQ chut Qap taH. wa'DIch lIngDaq laDlaHbogh teywI' tu'lu'be'chugh, motlh Qap.

ngo' mIw (`scanners` / `rules` / `custom_patterns`) laj taH:

- Hoch SeghvaD wa'DIch rapbogh chut wuq; chut rapbe'bogh Segh `warn` 'oH.
- `sanitize` `mask` moj; `auto_local` `mask` moj ghuHmoHwI' tlhej; `ner` buSHa'lu' ghuHmoHwI' tlhej.
- `scanners` tetlhDaq Hutlhbogh nejwI' — tu'meyDaj chu'Ha'.
- lo'laHbe'bogh chutmey pagh mIwmey chIllu', ghuHmoHwI' tlhej.

**chov.** `audit` chu'DI', vay' So'bogh (pagh ghuHmoHbogh) Hoch pat ra' **wa'** chov Doch ghItlh, ta' `privacy.egress`, ja'chuqDaq DoSlu'bogh. ngo' Hoch rapvaD wa' `privacy.detected` Doch tam; DaH ghItlhlu'be'. Doch tetlh: ja'chuq, Qap, ghoqwI', chellu'ghach (pagh mIw) IDmey; nobwI'; ghoS (Hop); ngeH (`gateway`, `embed`, `mcp-bridge`, `mcp-external`, `opencode`); chut mI'; So'lu'bogh ghuHmoHlu'bogh mI'mey; Hoch SeghvaD mI'mey; mu'tlhegh 'ay'mey (`unattributed` = qonlu'bogh 'ay'mey Hur pat ghItlh); ja'chuq qunDaq rapmey mI'; qawHaq janmey je. ghoSwI' Hur ngeHlu'bogh qawHaq jan jang Doch'egh Suq. tu'lu'bogh De' log pollu' not. reH `privacy.policy.updated` rur chovlu' chut choHmey (mI', Hal, choHlu'bogh Seghmey, polbogh lo'wI' je — De' not). log tlheghmey: *Privacy: masked values in outgoing model traffic* pagh *warn-class values in outgoing model traffic*, 'ej DaH ja'chuq, chellu'ghach, 'ay'mey, janmey je pong. Hoch mu'tlhegh 'ay'vaD nuq So'lu' 'ang De' chellu'ghach nav — [ja'chuqmey — De' chellu'ghach](/docs/tlh/daily/conversations/#context-composition).

**chu'choH.** pagh ta'nISlu': ngo' mIw `privacy.yaml` teywI'mey Qap taH, 'ej naDev wa'DIch polpa' chut tIr taH tu'lu'bogh `privacy.yaml`. ngo' nejwI' `[PHONE]`Daq jaj qa'moHpu'bogh pollu'ta'bogh ghItlh — vault ghItlhHomDaq rur — nIteb tI'lu'be', wa'DIch De' Hegh'pu'mo'; Halvo' tlhapqa'lu'chugh cheghmoHlu'.

## mIwmey 'ej SeHwI'mey

### Hub wanI'mey (`/security`) {#security-events}

tlhegh mach: *jan Qap wuq 'ej Hub QonoS.*

**EYAS Hur qawHaq** 'emwI' tlhej poS nav (joH SeHwI' je) — [Dung](#memory-outside-eyas-card) yIlegh.

| SeHwI' | QIj |
|--------|-----|
| mI'mey | **Hoch wanI'mey**, **qIl mI'**, **botlu'bogh jan potlh** |
| wuq SeHwI' | **Hoch / yIchaw' / yIqIl / yIghurtaH** |
| Qob SeHwI' | **Hoch / puj / rap / HoS / Qobqu'** |
| chovwI' SeHwI' | ghItlh motlh (*chovwI' yInej…*) — EYAS Hur qawHaq rurbogh He lajQo'meyvaD `deterministic` |
| tlheghmey | poH, jan, wuq, chovwI', Qob, ghoqwI', meq |

chImDI': *Hub wanI' tu'lu'be'.*

### chov (`/audit`) {#audit}

tlhegh mach: *ta' QonoS, chovnatlhmey, 'ej cheghmoH tlha'.*

| SeHwI' | QIj |
|--------|-----|
| mI'mey | **Hoch ghItlhmey**, **ta'mey / jaj**, **potlh patHom**, **Hoch Dil** |
| SeHwI'mey | **ta'**, **patHom**, **vo'**, **Daq** |
| tlheghmey | poH, lo'wI', ta', patHom, DoS, chovnatlh, Dil |
| **yIcheghmoH** | chovnatlhvo' cheghmoH (chaw' tlhej) |

chovnatlhmey: **Qapla' / Qagh / qIllu' / cheghmoHlu'**.

### pegh (`/privacy`) {#privacy}

wej 'ay' ghaj nav. (chovnatlhvampa' Hoch pegh API ra' 'ellu'be'bogh rur lajQo'lu', vaj 'el HaSta Daq cheghlaH nav; DaH tI'lu'.)

**1. mI'mey** (nav Dung). De'wI' taghDI' ngeH naDev mI'mey — qawHaqDaq pollu', vaj taghqa'DI' teqlu'; *jabwI' taghDI': &lt;poH&gt;* ghorgh tagh 'ang, 'ej **yIchu'qa'** chu'qa'. nejwI' chov Qapmey toghlu' not.

| mI' | QIj |
|-----|-----|
| **Hop ghuy'meH nejlu'bogh** | Hop DaqvaD nejlu'bogh mej ngeHmey: Hoch pat ra' nID (nIDqa'mey patlh Fallback je pIm toghlu'), Hop lanwI'Daq ngeHlu'bogh embeddingmey, 'ej lojmIt Hurvo' ngeHlu'bogh qawHaq jan jangmey (Claude Code / Grok / Kimi rarwI'mey, Hur MCP rarwI'pu', OpenCode sidecar). juH DaqDaq ra'mey nejlu'be' 'ej toghlu'be' |
| **So'lu'bogh De' ghajbogh ghuy'** | chaHvo', wa' De' qa'lu'bogh 'ar |
| **QIn ngeHlu'be'bogh** | block-Segh De'mo' lajQo'lu'bogh chu' ja'chuq, God Mode, He QInmey |
| **tlhoblu'DI' So'lu'bogh ngeHlu'** | **De'vam So'lu'DI' yIngeH** lo'taHvIS ngeHwI' ngeHqa'bogh lajQo'lu'bogh ja'chuq QInmey |
| **tu'lu'bogh PII Seghmey** | Hoch SeghvaD tu'mey, *nejwI' tu'lu'bogh* (regex / custom) tlhej |

**2. pegh chut choHwI'.** Dung chut mI' (*nIqHom N*) 'ej nuqvo' ghoS: *config/personality/privacy.yaml vo' lulIHlu'…* (teywI' choHlu'DI' tlhapqa'lu', naDev Dapolpa'), *naDev chut lo'lu'. privacy.yaml choHmey buSbe'lu'.*, pagh *Hoch ghom lo'lu': privacy.yaml laDlaHbe'lu'.* teywI'vo' chut ghoStaHvIS, Hutlhbogh pagh lughbe'bogh teywI' 'ang Doq banner *privacy.yaml Qagh: &lt;Qagh&gt;*, He naQ tlhej.

| SeHwI' | QIj |
|--------|-----|
| **pegh chut chu'lu'** | chu'Ha'DI': pagh tu'lu'be', pagh So'lu'be', pagh lajQo'lu'be' |
| **chov** | So'lu'bogh pagh ghuHmoHlu'bogh De' ghajbogh Hoch pat ra' pagh qawHaq jan jang chov logDaq yIqon (Seghmey mI'mey je, De' not). reH chovlu' chut choHmey |
| **Segh Hoch Qu'** | loS ta' per (**Qotlh**, **ghuH**, **So'**, **bot**, Hoch QIjlu'), 'ej Hoch ngaSlu'bogh SeghvaD wa' tlhegh (`email`, `phone`, `iban`, `bank_account`, `credit_card`, `ssn`, `personal_id`, `tax_number`, `taj_number`) pongDaj, nuq tu'lu' QIjbogh wa' tlhegh, ta' wIvwI' je tlhej |
| **mIw DIchenmoHbogh** | **pong**, **ghItlh mIw**, **Segh** (ngutlh mach, `project_code` rur; ngutlh tInDaq Daq pong moj, `[PROJECT_CODE]` rur), **Qu'** tlheghmey; **mIw yIchel** / **mIw yIteq**; 50 'aqroS. wa'logh wa' tlhegh rap mIwmey; Segh rap ghajbogh mIwmey wa'DIch mIw Qu' lo'. QIHbogh (catastrophic backtracking) pagh lughbe'bogh ghItlh mIw qonDI' lajQo'lu', meq Doch bIngDaq tlhej |
| **naDev jabwI'mey** | jabwI' pongmey pagh IP Daqmey (scheme, lojmIt, He Hutlh; 32 'aqroS) — pat jangmeychaj So'be'lu'bogh ghItlh Suq, localhost rur. lughbe'bogh qonpa' lajQo'lu' |
| **chut yIpol** / **choHmey yIwoD** | *choHmey pollu'be'bogh* per tlhej. qonDI' chut naQ tam 'ej De' pa'Daq pol; ghIq naDev chut SeHlu' 'ej `privacy.yaml` choHmey buSHa'lu' (logDaq ghuHmoHwI'). veb pat ra' Qap — QaptaHbogh mIw taghDI' chutDaj pol. chut lajQo'chugh De'wI', pagh choH 'ej Hoch Qagh DochDajDaq 'anglu' |

joH neH chut choHlaH. SeHwI'pu' laD neH legh, *chut Dalegh 'e' DaDelh. chut choH ghap nejwI' yIchov 'e' ta'laH pIn neH.* tlhej. Hoch chu'Ha'moHlaH SeHwI'; choHvetlh chovlu'.

**3. PII nejwI' yIchov** (joH neH). 100,000 ngutlh 'aqroS yIchel 'ej **ghItlh yInej**. reH **pollu'bogh** chut lo' (choHwI' choHmey pollu'be'bogh ghajtaHvIS Qub 'ang). chovnatlh: chu' QInvaD wuq — *ghItlhvam ghajbogh QIn chu' lajQo'lu'ta'jaj: &lt;Seghmey&gt;.* pagh *ghItlhvam ghajbogh QIn chu' laj'lu'ta'jaj.*; Hoch tu' SeghDaj, DaqDaj, nejwI'Daj, ta'Daj je tlhej; 'ej **Hop model Hevbogh rur** — mask- block-Segh De' qa'lu'bogh ghItlh (warn-Segh De' ratlh). chut chu'Ha'lu'DI': *pegh chut Qotlhlu': pagh tu'lu'.*

**API (rarwI'pu').**

- `GET /api/v1/privacy/policy` (joH SeHwI' je) → `{policy: {enabled, actions, customPatterns, localHosts, audit}, version, source ('yaml'|'ui'|'defaults'), seedError, updatedAt, rulesetVersion, builtinTypes, actions, limits: {customPatterns: 50, localHosts: 32}, canManage}`.
- `PUT /api/v1/privacy/policy` (joH) — porgh chut naQ 'oH (chIllu'bogh Dochmey motlhchaj Suq; Sovbe'lu'bogh ngoQmey lajQo'lu') → `GET` rap, pagh `400 {code: 'invalid_policy', issues: [{path, code, message}]}` 'ej pagh choH (ngoqmey: `unsafeRegex`, `invalidRegex`, `invalidHost`, `invalid_enum_value`, `too_big`, `unrecognized_keys`, latlh je).
- `POST /api/v1/privacy/scan` (joH; `text` chImbe', 100,000 ngutlh 'aqroS) → `{enabled, rulesetVersion, matches: [{type, start, end, scanner, action, value: '***'}], inbound: {refused, types}, egressPreview}`. `blocked`, `blockedTypes`, `warnings`, `sanitizedText`, `confidence` teqlu'. mI'meyDaq toghlu'be'.
- `GET /api/v1/privacy/stats` (joH SeHwI' je) → `{since, egress: {calls, maskedCalls, byType}, inbound: {checked, refused, masked}, byScanner}`; `totalScans`, `totalDetections`, `detectionsByType`, `detectionsByScanner`, `detectionsByAction` teqlu'.
- session cookie lo'bogh choHmeH ra'mey `/api/v1/privacy/*` `X-Eyas-Request` nach poQ, latlh pIn APImey rur (ngeH web UI; API ngoqmey Bearer tokenmey je choHbe'lu').

## latlh

- [SeH'egh](/docs/tlh/agents/autonomy/)
- [lo'wI'pu'](/docs/tlh/admin/users/)
- [janmey](/docs/tlh/automation/tools/)
- [bejlaH](/docs/tlh/admin/observability/)
- [Nodes](/docs/tlh/admin/nodes/)
- [qawHaq](/docs/tlh/knowledge/memory/)
- [OpenCode](/docs/tlh/automation/opencode/)
- [CLI](/docs/tlh/deploy/cli/)
