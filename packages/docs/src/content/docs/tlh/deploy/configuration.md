---
title: SeH
description: YAML motlh, juH overlay, env patlh — lIng He wIvpu'DI'.
---

**nuq 'oH.** SeH lo'taHvIS Qoy pong, patmey, SeH'egh, qawHaq capture, ghoqwI' verify ra'mey je DachoH, chenqa'be'lu'. `local.yaml` 'ej `EYAS_*` env yIchoH — `config/default.yaml` lonlaHchugh yIlon (chu'choHDI' motlh SeHmey qa'lu'). [juH](/docs/tlh/deploy/native/), [Docker](/docs/tlh/deploy/docker/), pagh [Kubernetes](/docs/tlh/deploy/kubernetes/) DawIvpu' 'e' Sovlu'.

## ghorgh yIlo' {#when-to-use-it}

- jan/lojmIt, log patlh, pat chu'Ha'.
- **`model` ra' capture** chu'Ha' (`memory.capture.enabled: false`) — motlh chu'. capture tlhol mevbe'vam: `memory.l0.enabled` SeHwI' pIm 'oH, motlh chu' je.
- **capture tlhol** chu'Ha' (`memory.l0.enabled: false`) — Hoch QIn mu' mu' cha'DIch qon Daq pa'Daq DaneHbe'chugh.
- motlh pa'mey neH latlh laH / persona pa'mey (`skills.importRoots` / `agent.importRoots`) — latlh QaHwI' pa''egh buSHa'lu'.
- `agent.verifyCommands` ghItlh Qap «rIn» chovpa' be'.
- law' Odoo checkout `EYAS_ODOO_SOURCES_JSON`.
- lugh juH poH pat yIja' (`i18n.timezone`).
- De' paq (`EYAS_DATA_DIR`) pagh ja'chuq vum pa'mey (`EYAS_WORKSPACES_DIR`) yIvIH, pagh Claude Code, Grok, Kimi QapwI' yIQan (`EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`).
- latlh qawHaq pa'mey patvo' yIHub (`security.foreignMemoryPaths`), pagh CLImey janmey'eghvaD kernel teywI' Hung yIpoQ (`security.cliSandbox: required`).
- tamtaHghachmo' mevpa' CLI mIwmey poH law' pagh puS yInob (`model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`).

## motlh mIw {#typical-workflow}

1. motlh SeHmey retlh `local.yaml` yIqon pagh yIchenmoH (pagh `EYAS_HOME` yIcher, vaj lIngvam tlhej taH).
2. poQbogh ngoq neH yIchoH. yIHon: `eyas config validate`.
3. yItaghqa' (`eyas restart`). `default.yaml` 'ej `local.yaml` taghDI' wa'logh laD EYAS; `eyas config reload` teywI'meyvam cha' laDqa' **not**. `config/personality/` bIngDaq ja'bogh teywI'mey (`privacy.yaml` rur) taghqa' Hutlh Suqlu'.
4. **SeHmey**Daq 'ej `eyas doctor` lo'taHvIS yIHon.

## pat {#features}

| teywI' | Qu' |
|--------|-----|
| `config/default.yaml` | ngeHlu'bogh motlh SeHmey |
| `local.yaml` | Dung 'ay' (DuD) |
| `.env` | pegh chut (commit not) |

patlh: CLI flags → `EYAS_*` env → juH YAML → motlh YAML.

default.yamlDaq ngaQmey chovnatlh: `server.host/port`, `database.path`, `log.level`, `i18n.timezone`, `modules.disabled`, `autonomy.identitySelfUpdate`, `security.foreignMemoryPaths`, `security.cliSandbox`, `model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`, `memory.capture.enabled`, `memory.l0.enabled`.

### pat tlhaq poH yoS {#time-zone-of-the-models-clock}

```yaml
i18n:
  timezone: "America/New_York"   # IANA pong; chIm = De'wI' poH yoS
```

Hoch mIw DaH jaj 'ej poH pat ja'. `i18n.timezone` poH yoS cher: IANA pong, `America/New_York`, `Europe/Berlin`, `UTC` rur. chIm (motlh) = De'wI' poH yoS — `TZ` env, pagh Qap pat SeH. Docker ngaSwI'mey motlh UTCDaq Qap, `TZ` cherlu'be'chugh.

jaj 'ej poH reH rap poH yoSvo', 'ej poH tlhegh poH yoS UTC offset je pong: `Current time: 23:30 (America/New_York, UTC-04:00)`. ngo' chovnatlhmey Central Europe poH yoS ngaQDaq poH ja', UTCvo' jaj Suq; vaj ram retlh cha' ghoHlaH, 'ej poH yoSvetlh Hurbogh Hoch lIng juH poH muj Suq.

lughbe'bogh mI' tagh mev, SeH Qagh tlhej: *i18n.timezone: Unknown time zone — use an IANA name such as Europe/Berlin or UTC*. `local.yaml`Daq yIcher; taghqa'DI' Qap.

### De' paq 'ej vault {#data-directory-and-vault}

De' paq De' pa', qawHaq vault, ghoqwI' teywI'mey, qonmey, 'ej latlh pat Dotlh ngaS. motlh `<EYAS home>/data` 'oH, pagh `EYAS_DATA_DIR` ponglu'bogh paq.

qawHaq vault reH `<data dir>/vault`Daq yIn, 'ej He SeH Daj ghajbe': vIHmeH, `EYAS_DATA_DIR` lo' De' paq yIvIH. (ngo' `config/personality/memory.yaml`Daq `memory.vault.path` ngaQ pagh ta' not, 'ej teqlu'.)

`EYAS_DATA_DIR` Hutlhbogh lIngmey — ngeHlu'bogh Docker ghItlh 'ej Helm tetlh je, motlh `/app/data` lanbogh — vault rap Daq pol. ngo' chovnatlhmey `<EYAS home>/data/vault`Daq vault pol, latlh DaqDaq `EYAS_DATA_DIR` 'oSDI' je. `EYAS_DATA_DIR` cherbogh lIngDaq, chu'choH wa'DIch taghDI' ngo' vault wa'logh cha'loghlu' — De' paq vault `.md` ghItlhHom ngaSbe'taHvIS 'ej ngo' `<EYAS home>/data/vault` ghItlhHommey ngaSDI' neH:

- **cha'loghlu', vIHlu' not**: ngo' paq choHlu'be', teywI' ngaS 'ej choH poH pollu', 'ej chu' vaultDaq tu'lu'bogh qa'lu' not. log ghuHmoHwI' ja': cha'logh ta'lu', 'ej cha'logh DachovDI' ngo' paq Qaw'laH.
- cha'logh lujchugh (De' paq ghItlhlaHbe'lu', rur), chu' vault chIm taH, Qagh tI'meH mIw tlhej logDaq ghItlhlu', 'ej veb taghDI' cha'logh nIDqa'lu'.
- cha' paqmey ghItlhHommey ngaSchugh, pagh cha'loghlu' pagh boqlu'. `<data dir>/vault` neH lo' EYAS 'ej ngo' paq teqlu'pa' Hoch taghDI' ghuHmoH; poQbogh ghItlhHom vaultDaq ghop yIcha'logh.

`eyas doctor` **Vault** tlheghDaq vault He 'ang 'ej vIHlu'bogh De' paq retlh ngo' vault ghuHmoH — [CLI](/docs/tlh/deploy/cli/#what-doctor-checks). [qon](/docs/tlh/admin/backup/) ngaSbogh `<EYAS home>/data` qon; latlh DaqDaq `EYAS_DATA_DIR` 'oSchugh, paqvetlh qonmeylIjDaq yIchel.

### ja'chuq vum pa'mey {#conversation-workspaces}

pa'mey Daj ghajbe'bogh ja'chuq **EYAS vum pa'**Daj lo' ([ja'chuqmey — pa'mey](/docs/tlh/daily/conversations/#working-folders)). git checkout qoDDaq vum pa'mey lanlu' not: git qach qoDDaq taghbogh CLI pat (Claude Code, Grok, Kimi) qachvetlh Qu'Daj rur buS — ra' teywI'meyDaj, git Dotlh, chaw' chutmey, Qu' qawHaq je laD. vum pa'mey Daq, mIwvam:

1. `EYAS_WORKSPACES_DIR`, cherlu'chugh. naQ He yIlo'.
2. pagh `<data dir>/workspaces`, git checkout qoDDaq De' paq tu'lu'be'chugh (Docker 'ej Kubernetes ghItlhmey, ngaSlu'bogh lIngmey — naDev choHlu'be').
3. pagh (git clonevo' Qapbogh Hal lIng) lo'wI' ghun De' paqDaq Hoch patvaD paq:
   - macOS: `~/Library/Application Support/eyas/<instance>/workspaces`
   - Linux: `$XDG_DATA_HOME/eyas/<instance>/workspaces`, motlh `~/.local/share/eyas/<instance>/workspaces`
   - Windows: `%LOCALAPPDATA%\eyas\<instance>\workspaces`

`<instance>` = EYAS home paq pong 'ej De' paq hash mach, vaj wa' De'wI'Daq cha' pat (dev 'ej yIn rur) vum pa'mey nobchuq not.

**chu'choH (nIteb, wa'logh).** Daq choHlu'DI' — git checkout qoDDaq De' paq, pagh latlh DaqDaq `EYAS_WORKSPACES_DIR` — wa'DIch taghDI' `<data dir>/workspaces`vo' nIteb chenmoHlu'bogh vum pa'mey chu' DaqDaq vIHlu', 'ej lo'bogh ja'chuqmey chu' He Suq. SoH wIvbogh pa'mey vIHlu' pagh choHlu' not. chu' DaqDaq rap pong ghajbogh pa' tu'lu'chugh, ngo' pa' Daq ratlh, ja'chuqvetlh lo' taH, 'ej ghuHmoHwI' logDaq ghItlhlu'. taghqa'chugh — pagh choH.

De' paq Hurbogh vum pa'mey Daq De' qon ngaSbe'; ghoqwI' chenmoHbogh teywI'mey ratlh taH, ja'chuq chellu'bogh ghItlhmeyDaq cha'loghlu'mo'. [qon](/docs/tlh/admin/backup/).

### EYAS Hur qawHaq {#memory-outside-eyas}

```yaml
security:
  foreignMemoryPaths: []   # pat laDlaHbe'/ghItlhlaHbe'bogh latlh naQ He'mey
  cliSandbox: auto         # auto | required
```

EYAS pa'meyDaj neH qawHaq laD 'ej ghItlh. `security.foreignMemoryPaths` Qap: taghDI' laDlu', 'ej naDev Hoch pat laD ghItlh je lajQo' Hub lojmIt. CLImey janmey'eghvaD kernel teywI' Hung tu'lu'be'DI' nuq qaS, wuq `security.cliSandbox`.

| ngaQ | motlh | QIj |
|------|-------|-----|
| `security.foreignMemoryPaths` | **`[]`** | bIng tetlh motlh Dung, pat laDlaHbe' ghItlhlaHbe' latlh pa'mey. naQ He'mey; `~` taghbogh chaw'lu'; mu'tlhegh chIm lajQo'lu'. tetlhlu'bogh paq bIngDaj Hoch je Hublu'. naQ He 'oHbe'bogh buSHa'lu', logDaq ghuHmoHwI' tlhej. taghDI' laDlu' — taghqa' poQ. tetlhvam lo'taHvIS 'oSbogh MCP De'wI'mey, qoDDaq ja'chuq pa'mey, qoDDaq tlhap Sormey je botlu', 'ej kernel teywI' Hung lajQo' tetlh 'ay' 'oH. **Hub wanI'mey → Memory outside EYAS** DochmeylIj tetlh 'ej Hutlhbogh buSHa'lu'bogh je per. |
| `security.cliSandbox` | **`auto`** | Claude Code shell Grok CLI janmey'egh jevaD kernel teywI' Hung (macOS Seatbelt, Linux bubblewrap). `auto`: tu'lu'DI' lo'lu'; tu'lu'be'DI' janmeyDaj Qap CLI taH, 'ej Hoch ja'chuqvaD wa'logh QIj 'ang ja'chuq, 'ej Hung Hurvo' Qap 'e' tlhobbogh Claude Code ra' reH ghot chaw' loS. `required`: Hung tu'lu'be'DI', CLI taghpa' janmey ghajbogh CLI mIw lajQo'lu' (Hung ghajbe' Kimi Code CLI, vaj janmey ghajbogh mIwmeyDaj reH lajQo'lu'), 'ej Hurvo' ra' Qap not Claude Code. `off` tu'lu'be'; latlh mI' SeH Qagh 'oH, 'ej tagh EYAS 'e' lajQo'. Hung Hutlhmo' janmey Hutlhbogh 'em ra'mey lajQo'lu' not. [nobwI'pu' — kernel teywI' Hung](/docs/tlh/ai/providers/#kernel-file-sandbox). |

SeH Hutlh Hub chut:

- latlh QaHwI'pu' juH paq Dotlh: `~/.claude` 'ej `~/.claude.json` (Claude Code), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium` (Windsurf), `~/.agents` 'ej `~/.config/agents` (nobchuqbogh laHmey), `~/.copilot`;
- OpenCode SeH, De', Dotlh pa'mey (XDG Daqmey 'ej `~/.config`, `~/.local/share`, `~/.local/state` Qav);
- Obsidian ghun SeH, 'ej Hoch Obsidian vault, `.obsidian` pa'Daj pagh Obsidian vault tetlhvo' tu'lu' (EYAS QaptaHvIS chenmoHlu'bogh vault tlhoS 30 lupDaq Suqlu');
- `ai-memory` ponglu'bogh Hoch pa', 'ej jan ngutlh-paq (`.claude`, `.grok`, `.codex`, `.gemini`, `.kimi`, `.cursor`, `.codeium`, `.windsurf`) bIngDaq Hoch `memory` pagh `memories` pa' — Qu' qoDDaq je;
- latlh lo'wI'pu' juH paqmeyDaq rap ngutlh-paqmey.

motlh Qu' teywI'mey lo'laH taH: Qu' `.claude/settings.json` 'ej `.claude/agents`, `CLAUDE.md`, `docs/MEMORY.md`.

EYAS De' paqDaj pegh je. pat lo'laH neH: ja'chuq vum pa'mey — Hoch ja'chuq Daj neH, `EYAS_WORKSPACES_DIR` De' paq Hurvo' vIHDI' je — mIw pa' Qu'mey (`data/studio`), Internet jan Suqmey (`data/browser/downloads`). vault, De' pa', ngoqmey, Internet jan profile, 'ej EYAS ghajbogh CLI 'el paqmey (`data/cli-homes`) EYAS neH; `database.path` De' paq Hurvo' 'oSDI' je De' pa' teywI' Hublu'. symlink lo'lu'chugh je Hub juSlaHbe'lu': He ghItlhlu'bogh rur 'ej ghoSqu'bogh Daq rur je wuqlu'.

**nuq Qap.** Hub lojmIt leghbogh Hoch jan ra' Hoch He chutvam Suq — API nobwI'Daq EYAS janmey, jan rarwI' lo'taHvIS Grok Kimi je ra'bogh EYAS janmey, chaw' tlhobbogh Hoch Claude Code jan ra', Claude Code janmey'egh (Hoch Qappa' Qapbogh chov), 'ej Hoch Grok/Kimi chaw' teywI' tlhob je. Hublu'bogh He SIbI' lajQo'lu', laD ghItlh je: AI noHwI' pagh, chaw' tlhob pagh, nob poSmoHlaHbe', 'ej 3-lajQo' ngaQDaq toghlu'be'. Hub lojmIt chu'Ha'lu'DI' je Qap. Hoch lajQo' **Hub wanI'mey**Daq wa' tlhegh. [Hub 'ej pegh — EYAS Hur qawHaq](/docs/tlh/admin/security-privacy/#memory-outside-eyas).

chut rap pa'vetlh ja'chuq pa' pagh Qu' vum pa' rur qonmeH lajQo' je ([ja'chuqmey — pa'mey](/docs/tlh/daily/conversations/#working-folders)), 'oSbogh MCP De'wI'mey bot ([MCP](/docs/tlh/ai/mcp/#memory-store-servers-are-blocked)), 'ej qoDDaq tlhap Sormey buSHa' (bIng). vum pa' qoDDaq Hurvo' 'oSbogh symlink lajQo' EYAS teywI' janmey — ghoSDaj tu'lu'be'chugh je.

**kernel 'ay'.** ra' ghItlh 'angbe'bogh shell DoSmey, 'ej EYAS tlhobbe'bogh CLI laDmey, kernel teywI' Hung Qapbogh DaqDaq ngaQlu' (Claude Code shell, Grok CLI janmey'egh). LinuxDaq bubblewrap (`bwrap`) — Claude CodevaD `socat` je — 'ej De'wI' SeHbe'bogh lo'wI' namespacemey poQ; ngaSbe' EYAS ghItlh (LGPL bubblewrap; lIngmeH SeHwI' wIv). `eyas doctor` **CLI sandbox** tlheghDaq Dotlh 'ang. kernel teywI' Hung ghajbe' Kimi Code CLI, vaj EYAS leghDI' neH ngaQlu' laD, grep, glob janmeyDaj'egh.

### CLI nobwI'pu': juHmey env je {#cli-providers-homes-and-environment}

tetlh mach chaw'lu'bogh env tlhej AI ra' janmey tagh EYAS, De'wI' env naQ tlhej not:

| CLI | juH | nuq Suq |
|-----|-----|---------|
| Claude Code | qach `HOME` ('el neH nobchuq) | `PATH`, Hol poH yoS je, proxymey CA boqmey je, `HOME`, Anthropic / Claude OAuth / Bedrock / Vertex 'el Dochmey, 'ej `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `DISABLE_AUTOUPDATER=1` |
| Grok CLI | `<data dir>/cli-homes/grok-cli` | `PATH`, Hol poH yoS je, `TMPDIR`, `TERM`, `USER`, `LOGNAME`, `SHELL`, proxy CA boq je Dochmey, 'ej EYAS nIteb SeHwI'mey |
| Kimi Code CLI | `<data dir>/cli-homes/kimi-cli` | Grok rap |
| OpenCode | `<data dir>/cli-homes/opencode` | [OpenCode](/docs/tlh/automation/opencode/) |

ngeHlu'be': latlh nobwI' API ngoqmey, EYAS peghmey, `XAI_API_KEY`, `CLAUDE_CONFIG_DIR`, 'ej De'wI' Hoch latlh `CLAUDE_CODE_*`, `GROK_*`, `KIMI_*`, `XDG_*` SeH. `data/cli-homes` bIngDaq EYAS ghajbogh juHmey EYASvaD Grok Kimi 'elmey ngaS 'ej Hoch patvo' Hublu'. Qap EYAS chaH, chu'choH'eghbe' Claude Code Grok je; CLImey SoH'egh yIchu'choHmoH. Dochvam SeH tu'lu'be'. [nobwI'pu'](/docs/tlh/ai/providers/#claude-code-isolation).

### CLI mIw poH 'aqroS {#cli-turn-timeouts}

```yaml
model:
  cli:
    idleTimeoutMs: 600000     # 10 tup tam, jan Qapbe'taHvIS
    toolTimeoutMs: 1200000    # 20 tup tam, jan QaptaHvIS
```

ngaQlu'bogh poH retlh Claude Code, Grok CLI, Kimi Code CLI mIwmey mevmoHlu'be'. CLI tamDI' neH CLI mIw mevmoHlu': `idleTimeoutMs` QIn Hutlh jan Qapbe'taHvIS, pagh `toolTimeoutMs` QIn Hutlh jan QaptaHvIS. CLIvo' Hoch QIn — ghItlh yIn, jan tagh pagh rIn, chaw' tlhob — poH taghqa'moH, 'ej mIw naQvaD 'aqroS tu'lu'be'; **mev** reH mIw rInmoHlaH, 'ej Qap qamchoHbogh nejwI' Qap taH. tammo' mevmoHlu'bogh mIw poH natlh ja' — nIDqa'laHbogh: pagh ngeHlu'pa' neH wa'logh nIDqa' pagh latlh nobwI'Daq vIH lojmIt, 'ej 'em Qap nIDqa'laH nIteb nIDqa' SeHwI'.

Hoch mI' millisecondmey 'oH 'ej naQbogh mI' lughbogh 'oHnIS; pagh, teH mI', 'ay' mI', ghItlh je SeH laDDI' lajQo'lu'. Hoch CLI mIw taghDI' QaptaHbogh SeHvo' laDlu', vaj EYAS taghqa'DI' mI' choHlu'bogh Qap. `run_specialist` taghbogh laHwI'pu' pe'be'meH, 15 tup Dung `toolTimeoutMs` yIpol.

### nI' qawHaq capture {#durable-memory-capture}

```yaml
memory:
  capture:
    enabled: true          # false = mIw ret vault ghItlhHom pagh
    minUserChars: 40
    maxPerConversation: 20
    maxInputChars: 4000
```

| ngaQ | motlh | QIj |
|------|-------|-----|
| `memory.capture.enabled` | **`true`** | lughbogh Qap ret, EYAS 'em patDaq mach pat ra' nI' wanI' tu''a' wuq, 'ej cha' vault ghItlhHom 'aqroS ghItlh — jang potlh HeDaq not. EYAS pat QapmoHmeH Hoch mIwDaq Qap: ja'chuq mIwmey, 'em Qu' nav Qapmey, laHwI' Qu' noblu'bogh Qapmey je (pipeline mIwmey je), A2A Qu'mey, ghom ghoqwI'pu', He jangmey je. `false` Hoch mev; bIng capture tlhol SeHwI' pIm 'oH. |
| `memory.capture.minUserChars` | **`40`** | QIn machqu' (ngutlhmey) pat ra' not. He QIn pagh A2A Qu'vaD ngeHwI' mu''egh neH toghlu', vaj Hevo' "ok" puS pat ra' DIlbe'. |
| `memory.capture.maxPerConversation` | **`20`** | wa' ja'chuqvaD capture pat ra' 'aqroS. ja'chuq Hom'eghDaq Qap laHwI' pagh ghom ghoqwI', vaj 'aqroS'egh ghaj; He ja'chuq Hoch QInmeyDaj wa' 'aqroS nobchuq. |
| `memory.capture.maxInputChars` | **`4000`** | capture pat leghpa', QInlIj jang je Hoch ngutlhmeyvam mI' Dung pe'lu'. |

API nobwI' pagh nIteb QaplaHbogh CLI Qap ra', nIteb QaplaHbe'bogh not; lo'laHbogh pat tu'lu'be'chugh, chIl qon capture 'ej ra'be'. pagh jangbogh Qap capture tlhegh ghItlhbe'. **Huch:** `minUserChars` 'ej law' ra'Daj tIqghach ghajbogh Hoch laHwI', ghom ghoqwI', He jang je DaH wa' latlh 'em pat ra' DIllaH. 'Iv QIn ghItlh, vaj chay' laDlu' wuqlu': ghoqwI' ghItlhlaHbogh Qu' ra' rur laDlu' Qu' noblu'bogh, ghom ra', Qu' nav ngoQ je, 'ej latlh ghot mu'mey rur laDlu' He QIn A2A Qu' je — SoH 'Iv pagh chay' vum ja'bogh ghItlhHom chenmoH not chaH, 'ej ghItlhHommeychaj ghomwI' voq patlhDaq pollu'. `memory_capture_runs` qon `entry_path` tut Suq (`interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team`, `channel`; chu'choHvam qaSpa' ghItlhlu'bogh tlheghmeyDaq chIm), nIteb chellu'. SeH chu' pagh. [qawHaq — capture motlh chu'](/docs/tlh/knowledge/memory/#capture-is-on-by-default) 'ej [FAQ](/docs/tlh/reference/faq/).

### capture tlhol {#raw-capture}

```yaml
memory:
  engine: legacy           # nIteb tu' neH SeH; qawqa'meH mIw rap
  l0:
    enabled: true          # false = pagh qon tlhol pollu'
    captureToolResults: false
    captureThinking: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

`memory.capture` rap **'oHbe'**. capture vault ghItlhHommey ghItlh 'ej `model` ra' mach Dil; capture tlhol **Hoch QIn qonlu'bogh mu' mu' cha'DIch pol** — machmoHlu' 'ej hashDaq lanlu' — `model` ra' pagh, API Huch pagh. motlh chu'.

| ngaQ | motlh | QIj |
|------|-------|-----|
| `memory.l0.enabled` | **`true`** | capture tlhol potlh SeHwI'. `false` — pagh qonlu', pagh bufferlu'. |
| `memory.l0.extractInLegacy` | **`true`** | Hoch qon ret nIteb mIw Qap (vItmey, Dov, Dochmey, topicmey, potlh chovnatlh), `engine` `legacy` taHvIS je. `false` — mu'mey pol 'ach pagh tu'. |
| `memory.engine` | **`legacy`** | `legacy` pagh `v2`. nIteb vIt tu' Qap'a' neH wuq: `v2` reH tu'; `memory.l0.extractInLegacy` chu'taHvIS (motlh) tu' `legacy`. 'Iv mI' cherlu' 'ach reH patlh qawqa' 'oH qawqa'. |
| `memory.l0.chunkTokens` | **`8000`** | tIn qonmoHwI': juvlu'bogh token mI' SIchDI', ja'chuq buffer qonlu'. |
| `memory.l0.idleFlushMinutes` | **`30`** | poH qonmoHwI': Hoch tup nejtaHbogh mIw Qongbogh buffer qon. ja'chuq SoQmoHlu'DI' 'ej EYAS mevDI' je qonlu', vaj taghqa' Say' pagh chIl. |
| `memory.l0.captureToolResults` | **`false`** | ghoqwI' Qap ra'bogh Hoch jan jang je qon, 'Iv pat 'ach: EYAS janmey'egh, rarwI' lo'taHvIS CLI ra'bogh EYAS janmey, Claude Code Grok Kimi je janmey'egh, `opencode_run` Qu' qoDDaq OpenCode Qapbogh janmey, 'ej OpenCode QonoS 'emwI' ghum. Qapbogh ra'mey neH qonlu' (lujbogh — Qagh per tlhej); lajQo'lu'bogh, Skiplu'bogh, chaw' loSbogh ra'mey, jang chImmey, cha'logh ra'mey je qonlu'be', 'ej ghoqwI' Qap Hurvo' jan ra'mey qonlu'be'. **Dachu'pa' veb 'ay' yIlaD.** |
| `memory.l0.captureThinking` | **`false`** | ja'bogh Hoch pat meq ("thinking") pol, Hoch pat ra'vaD wa' Doch. chov neH: vItmey moj not, qawqa'lu' not. mu' mu', So'be'lu' pollu'; chu'taHvIS Hoch taghDI' ghuHmoHwI' ghItlhlu'. |
| `memory.l0.toolResultMaxBytes` | **`8192`** | qonlu'bogh jan ra' nobbogh qon byte 'aqroS — jan pong, jang, Qagh per, rIn, 'Iv Qap je — UTF-8 veHDaq pe'lu' 'ej pe'ta' degh leghlu'bogh ghaj. ra' Dochmey toghlu'be': qon retlh pollu', wa'DIch 2,048 ngutlhchaj pe'lu'. jan jangmey neH; QInmey 'aqroS Hutlh. |

Hoch Qap taghDI' QaptaHbogh SeHvo' `captureToolResults` `captureThinking` je laDlu'; `local.yaml` latlh rur, EYAS taghqa'DI' choH Qap.

**meqmo' chu'Ha'lu' `captureToolResults`.** qonlu'bogh jan jang naQ 'oH — mu' mu', So'be'lu' — 'ej ra' Dochmey wa'DIch 2,048 ngutlh tlhej: `run_command` stdout, `read_file` ngaSbogh, 'ej `browser_totp` wa'logh mI' yIntaHbogh — Hoch 'ay' tlholDaq motlh mu'mey rur. pagh So'lu', pagh pegh — machmoHghach peghbe'. flag chu'DI', Hoch taghDI' ghuHmoHwI' ghItlh. De'wI'vamvaD lo'laHchugh neH yIchu'. qonlu'bogh ra' qawqa'lu' not, promptDaq ja'qa'lu' not je — mIwDaq chellu'bogh qawHaqDaq ghobe', `memory_search`, `memory_expand`, qawHaq nav nej, ja'chuq Dov je lo'taHvIS ghobe'. ja'chuqvo' EYAS tlhapbogh qechmey pongmey je choH jang neH; Dochmey qon retlh mung rur pollu' 'ej nejmeH tetlhDaq ghoS not, tlhaplu' not ([qawHaq — jan jangmey qonbe'lu'](/docs/tlh/knowledge/memory/#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).

**tlhegh tlholmeyvam 'angbogh nav pagh.** tetlh tlholvaD UI nav pagh, API He pagh, `eyas memory` ra' pagh. qawqa' lo'taHvIS neH SIch QaHwI' — vo' chenmoHlu'bogh Dovmey vItmey je, 'ej `memory_expand` poSmoHbogh tlhol tlheghmey. **qawHaq → Hoch Del**Daq **qawmoHwI' QuQ** 'emwI' 'ang: tetlh tlhol, jan ghum qon, Qub qon je chu''a'.

**capture tlhol tInchoHtaH, 'ej pagh pe'.** chu'choHvamDaq poH 'aqroS SeHwI' pagh, Say'moHwI' Qu' pagh; wa' QIn qonlu'ta'bogh tlhoS 5 KB Daq natlh, indexmeyDaj tlhej. DaH Dil DaneHbe'chugh: `memory.l0.enabled: false`. [qawHaq](/docs/tlh/knowledge/memory/) yIbej.

### qawHaq tetlh, qaw je {#memory-index-and-recall}

| ngaQ | motlh | QIj |
|------|-------|-----|
| `memory.index.budgetChars` | **`2400`** | Hoch mIwvaD qawqa' 'ay' naQ ngutlh 'aqroS (≈ 600 token), per 'ay' je: taHbogh ghItlhHommey, QInvaD Suqlu'bogh ghItlhHommey, naQ ghItlh Sammey je. 100k token context logh ghajbogh patvaD tIn; jangbogh pat logh rur tInchoH (250k tokenvo' 2.5× 'aqroS, 29k token bIng mach) — OpenCode Qu' (`opencode_run`) je, wIvlu'bogh patvaD OpenCode tetlhbogh logh rur, pagh loghvetlh Sovbe'lu'DI' mI'vam net. taHbogh ghItlhHommey Suqlu'bogh vaD 'ay' bID 'aqroS lon. ngaSlaHbe'bogh ghItlhHommey Qav tlheghDaq toghlu' (*… N more notes not shown*) 'ej qawHaq nejvo' SIchlaH taH. `user` `feedback` ghItlhHommeylIj ngaSlaHbe'chugh yInIvmoH. taghqa'nISlu'. |
| `memory.recall.includeSecrets` | **`false`** | `contains-secrets` per ghajbogh ghItlhHommey, wanI' tlheghmey, laHmey je (tlhapwI' pegh tu'bogh teywI'mey, ngIq mu' mu' pollu'bogh) — 'ej vo' chenmoHlu'bogh tlhol tlheghmey, vItmey, Dovmey je — qawqa', `memory_search`, `memory_expand` lo'taHvIS patDaq ghoS'a', 'ej nej vectormey Suq'a'. chu'Ha'lu'DI' pollu' 'ej qawHaq HaqDaq leghlu', 'ach ra'meyDaq not SIch. taghqa'nISlu'. |

qawqa' — nuq ngaS, chay' nejmeH mu'tlheghDaj chenmoHlu', 'ej chay' Hoch patDaq ghoS — [qawHaq — chay' qawqa' patDaq ghoS](/docs/tlh/knowledge/memory/#how-recall-reaches-the-model) Del. **qawHaq → Hoch Del**Daq **qawmoHwI' QuQ** 'emwI' EYAS QaptaHbogh Huch `includeSecrets` SeHwI' je 'ang ([qawHaq — qawmoHwI' QuQ](/docs/tlh/knowledge/memory/#recall-engine)).

**teqlu': `memory.relatedWork.*`.** *Related prior work* 'ay' pIm (`enabled`, `minQueryChars`, `maxHits`, `budgetChars`, `maxSnippetChars`) teqlu'; DaH qawqa' 'ay' qoDDaq ghoS ngo' vum, `memory.index.budgetChars` cherbogh tIn. ngaQmeyvam cherbogh `local.yaml` tu'lu'bogh laDlu' taH; buSHa'lu'.

**chu'choH ghItlh.** ngo' chovnatlhmey `config/default.yaml`Daq `memory.index.budgetChars: 8000` ngeH; DaH ngeHlu'bogh mI' `2400` 'oH, motlh qoD rap. ngo' tIn DapolmeH, `config/local.yaml`Daq yIchel 'ej yItaghqa':

```yaml
memory:
  index:
    budgetChars: 8000
```

### De' pa' ratlhtaHghach {#database-durability}

0.8.23-beta tagh, EYAS De' pa' rarwI' Hoch `PRAGMA synchronous = NORMAL` Qap, SQLite motlh `FULL` 'oHbe'. reH EYAS lo'bogh WAL tlhej:

- **Qap** Hegh — EYAS HoHlu', Qagh SeHlu'be' — commit ta'lu'ta'bogh chIlbe'.
- **De'wI' pat** Hegh pagh HoS chIl commit poHDaq — Qav jabbI'ID chIllaH.

WAL motlh Dil 'oH, 'ej **Hoch** patmey SIch, qawHaq neH ghobe'. Dachenqa'laHbe'bogh vum ngaSchugh lIng, ratlhtaHghach mo' 'oH [qon 'ej qaSqa'](/docs/tlh/admin/backup/)'e', commit mIw 'oHbe'.

### latlh laH qa' Sormey je {#extra-skill-and-persona-roots}

```yaml
skills:
  importRoots: []
agent:
  importRoots: []
```

lIng tetlh chIm. He'mey `local.yaml`Daq, Hal ngoqDaq not. Sormeyvam **Hoch taghDI'** laDlu', vaj yIn Hal 'oH chaH — motlh pa'meyvaD neH (ghom pa' `/opt/team-skills` rur). import laH bundled qa' Qap. [laHmey](/docs/tlh/automation/skills/#import-roots).

**buSHa'bogh EYAS Sormey.** latlh QaHwI' pagh ghItlhHom ghun pa''egh qoDDaq tu'lu'bogh, pagh ngaSbogh, Sor nejlu'be':

- latlh jan juH pa'mey: `~/.claude` (vaj `~/.claude/skills`, `~/.claude/agents`, `~/.claude/plugins/…` je), `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot`, 'ej nobchuqbogh laH pa'mey `~/.agents` `~/.config/agents` je;
- OpenCode SeH, De', Dotlh pa'mey;
- Obsidian ghun SeHmey 'ej Hoch Obsidian vault;
- `security.foreignMemoryPaths`Daq tetlhlu'bogh pa'mey;
- EYAS CLI juHmey'egh (`data/cli-homes`).

juH pa'lIj naQ rurbogh Sor buSHa'lu' je, pa'meyvam ngaSmo'. taghDI' Hoch buSHa'lu'bogh SorvaD ghuHmoHwI' log De'wI', chovnatlh *skills.importRoots: /Users/me/.claude/skills is inside Claude Code (~/.claude) — not scanned; import these files once with Settings → System → Data portability → Import data*, 'ej SeH pa' je pongbogh **Import roots** ghuHmoHwI' 'ang `eyas doctor`.

**nuq yIta'.** pa'vetlhvo' tlhaplu'pu'bogh laHmey ghoqwI'pu' je EYASDaq taH; pa'vetlhvo' chu'qa'be' neH. De'vetlh DaqemmeH, pagh Dachu'qa'meH, pa' [De' tlhap](/docs/tlh/admin/data-port/) wa'logh yIQap — Hal qonlu'taHvIS EYASDaq qonqa'lu' — ghIq `local.yaml`vo' Doch yIteq.

**EYASDaq choHlu'bogh qa'mey** `agent.importRoots` teywI'chaj **qa'moHbe' not**. wa'DIch taghDI' ghoqwI'Daj chenmoH teywI', 'ej ghoqwI' pong, Qu', Del, pat mu'tlhegh, janmey je Qav tlhapDI' rur taHchugh neH choH; [ghoqwI'pu' — SeH](/docs/tlh/agents/configure/#imported-personas).

## ghoqwI' verify 'ej env ngaQmey {#agent-verify-and-environment-variables}

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  # 'em Qap ret nIteb chovmey (chIm = chu'Ha')
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /absolute/path/to/repo   # motlh: process.cwd()
```

| ngaQ | QIj |
|------|-----|
| `agent.verifyCommands` | `{ name, command, args?, timeoutMs? }` tetlh — **shell Hutlh**; lujchugh, Qagh Dov tlhej ghoqwI' poSmoHqa'lu' |
| `agent.verifyCwd` | ra'meyvam vum pa' |
| `EYAS_ODOO_SOURCE_PATHS` | `:` pagh `;` chevbogh juH Odoo checkout Sormey — `odoo_search_*` janmey tI' 'ej Hal tagh chut |
| `EYAS_ODOO_SOURCES_JSON` | law' Segh tagh (QaQqu'): `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` JSON tetlh — Hemeyvam wej qonlu'chugh, taghDI' Qapbe'bogh **nej Halmey** chenmoH |
| `EYAS_AUTO_FAILOVER` | DaneHchugh, chImbogh He patlh fallbackmey cha'DIch Qapbogh nobwI' lo' tev |
| `EYAS_BROWSER_USER_DATA_DIR` | headless `browser_*` vaD EYAS Chromium profile (motlh `data/browser/profile`). jaj Chrome/Edge profile lajQo'lu' |
| `EYAS_AGENT_BROWSER_BIN` | Vercel agent-browser CLI He (chut). chIm = PATH. cherlu' 'ach Hutlh = fail-closed (PATH Qav pagh). profile: `data/browser/agent-browser/profile` |
| `EYAS_DATA_DIR` | De' paq (De' pa', vault, ghoqwI' teywI'mey, …). motlh `<EYAS home>/data`. [De' paq 'ej vault](#data-directory-and-vault) |
| `EYAS_WORKSPACES_DIR` | ja'chuq vum pa'mey naQ He. motlh: [ja'chuq vum pa'mey](#conversation-workspaces) |
| `EYAS_CLAUDE_CODE_BIN` | EYAS Qapbogh `claude` naQ He. chIm = PATH `claude`, ghIq SDK ngaSbogh copy (doctor ghuHmoH). cherlu' 'ach lughbe' = fail-closed (Qav pagh). [nobwI'pu' — Claude Code Qap](/docs/tlh/ai/providers/#claude-code-runtime) |
| `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` | EYAS Qapbogh `grok` / `kimi` naQ He. chIm = PATHDaq QapwI'. cherlu' 'ach lughbe' = fail-closed: nobwI' qonlu'be'. [nobwI'pu' — Grok CLI Kimi Code CLI je](/docs/tlh/ai/providers/#grok-cli-and-kimi-code-cli) |
| `LM_STUDIO_URL` | LM Studio De'wI' (motlh `http://localhost:1234`; `/` Dor QaQ) |
| `EYAS_OPENCODE_PLUGIN_TOKEN` | tu'lu'be'choH: laDbe' 'ej cherbe' EYAS. EYAS taghbogh Hoch OpenCode Qap ('em De'wI' 'ej Hoch OpenCode QonoS) ngoqDaj Suq teywI' ngu'wI' 3Daq, envDaq not, 'ej Hoch qawHaq ra' wa'logh poH tob ngeH; Qapvetlh rInDI' pagh taghqa'DI' ngoq teqlu'. `EYAS_OPENCODE_KEY_FD=3` neH ngaS OpenCode env, EYAS'egh cherbogh. [OpenCode](/docs/tlh/automation/opencode/#eyas-memory-inside-opencode) |

### law' Segh Odoo chovnatlh {#multi-version-odoo-example}

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

ghIq **nej Halmey** yIpoSmoH, Hoch HalvaD **tetlhqa'** yIQap, 'ej Hoch [Qu'](/docs/tlh/daily/projects/)Daq **motlh De'wI' mung** yIcher. ja'chuqmey **mungmey** navDaq Halmey ngaQmoH — [nej](/docs/tlh/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

Hoch jan ra'Daq (PreToolUse / PostToolUse) ToolExecutor lo'taHvIS jan chut hookmey Qap — [janmey](/docs/tlh/automation/tools/).

## latlh {#related}

- [CLI](/docs/tlh/deploy/cli/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
- [He 'ej Huch](/docs/tlh/ai/routing-budget/)
- [qawHaq](/docs/tlh/knowledge/memory/)
