---
title: nobwI'pu'
description: AI 'em pat — API, juH CLI, juH QapwI'. De'wI' SeH'eghvo' nIteb Qap CLImey.
---

**nuq 'oH.** nobwI'pu' LLM 'em pat 'oH: chal API, juH CLI (Claude Code, Grok, Kimi), juH QapwI' (Ollama, LM Studio, vLLM) je. nobwI' Dachu'moH, ngoqDaj Dapol, patmey DawIv, ghIq lo' He. naDev ja'lu' je chay' De'wI' SeH'eghvo' CLImey Haw'moH EYAS: reH nIteb Qap Claude Code, EYAS juHDajDaq Qap Grok Kimi je 'ej EYASvaD 'ellu', 'ej nIteb Qap 'e' chovlaHbe'DI' EYAS mIw mev.

**He:** `/providers`. Dech: **He mI' · nobwI'pu' · Huch · QI' poj**. nav: **nobwI'pu'**.

## ghorgh yIlo'

- tagh rInDI': nobwI' **chu'**, ngoq, patmey.
- `claude` / `grok` / `kimi` juHDaq, CLI ngoq Hutlh.
- Grok CLI pagh Kimi Code CLI **yI'el poQlu'** 'ang — EYASvaD yI'el ([EYASvaD Grok Kimi je yI'el](#sign-in-grok-and-kimi-for-eyas)).
- DaneHbogh CLI lIng Qap EYAS (`EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`) — [Claude Code Qap](#claude-code-runtime), [Grok CLI Kimi Code CLI je](#grok-cli-and-kimi-code-cli).
- CLI nIteb Qagh tlhej mIw mev, 'ej juHDaq nuq DachoHnIS DaSovnIS.
- Claude Code, Grok CLI, pagh Kimi Code CLI Dachu'choHmoH, 'ej chovnatlhvetlhDaq EYAS nIteb tobta''a' DaSovnIS ([tobta'bogh CLI chovnatlhmey](#proven-cli-versions)).
- CLI nobwI' navDaq **kernel teywI' Hung** *QInvamDaq tu'lu'be'* 'oH, pagh CLI mIwmeyvaD Hung DapoQ DaneH ([kernel teywI' Hung](#kernel-file-sandbox)).
- pat tlhegh **Qav chu'qa'meH, pat nob Hutlh** ja', pagh tlhegh Qapbogh pat naQ DaSovnIS.
- pat 'Iv meq vum patlhmey nob, patvaD **auto** nuq QIj, 'ej chay' Hoch nobwI' patlh lo' DaSovnIS ([meq vum](#reasoning-effort), [chay' Hoch nobwI' vum patlh lo'](#effort-by-provider)).

## motlh mIw

1. **nobwI'pu'** (`/providers`) → Dech **nobwI'pu'**.
2. nav yIwIv. **chu' / chu'Ha'** HevaD chu'moH. **'ol**: API ngoq ([peghmey](/docs/tlh/admin/secrets/)Daq So'lu'); Claude Code De'wI'vam Claude Code 'el lo'; Grok CLI Kimi Code CLI je **EYASvaD yI'el** chovnatlh 'ang.
3. patmey chu'. **patmey yIchu'qa'** nobwI' pat tetlh chu'qa' — Hoch nobwI'vaD rap Degh, API pagh CLI. nobwI' nobbe'bogh patmey chu'Ha'lu' 'ej perlu', teqlu' not.
4. patlh + Huch: [He 'ej Huch](/docs/tlh/ai/routing-budget/).

## laHmey

Hoch nav ngu', Dotlh, chu'/chu'Ha' SeHwI' je 'ang.

| Doch | QIj |
|------|-----|
| **chu' / chu'Ha'** | HevaD nobwI' chu'moH |
| **N/M pat chu'** | 'ar patmey Qap |
| **CLI tu'lu'be'** | juH QapwI' Hutlh |
| **API ngoq Hutlh** | ngoq poQ |
| **'ol Qagh** | 'ol luj — ngoq pagh 'el yIchelqa' |
| **yI'el poQlu'** | Grok CLI / Kimi Code CLI navDaq Doq Degh: EYASvaD CLI 'ellu'be' (QIj: *EYASvaD &lt;CLI&gt; 'ellu'be'. yI'elmeH nobwI' yIpoSmoH.*) |

### ngaSlu'bogh nobwI'pu' (navDaq tetlhlu'bogh rur) {#built-in-providers}

| nobwI' | Qu' |
|--------|-----|
| Anthropic | Claude — API ngoqlIj lo'laHbogh patmey, Anthropic pat tetlhvo' laDlu' (ngaSlu'bogh Qav tetlh: Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, Sonnet 5, Sonnet 4.6, Haiku 4.5) |
| OpenAI | ngaSlu' GPT-5.6, GPT-5.5, GPT-5.4, GPT-5 mini, o3-mini, GPT-4o, GPT-4o mini; latlh tetlh **patmey yIchu'qa'** |
| OpenRouter | nobwI' law' He (patmey 100+) |
| Gemini | Google Gemini 3.x (chu'qa' ret 2.5, ngoqlIj SIch taHchugh) |
| Kimi | Moonshot API (K3, K2.7 Code, K2.6) |
| Claude Code CLI | De'wI'vam Claude Code CLI (`claude`), reH nIteb — [Claude Code nIteb](#claude-code-isolation) |
| Grok CLI | ACP (`grok agent --no-leader stdio`) EYAS juHDajDaq — [CLI MCP rap](/docs/tlh/ai/mcp/#cli-mcp-tool-parity-grok--kimi) lo'taHvIS EYAS janmey |
| Kimi Code CLI | ACP (`kimi acp`) EYAS juHDajDaq — rap rar |
| Ollama / LM Studio / vLLM | juH QapwI'mey — [juH QapwI'mey](#local-runtimes) |
| xAI, Mistral, Groq, Together, DeepSeek, Cerebras, Venice, Hugging Face, NVIDIA, Z.AI, Kilo Gateway, Vercel AI Gateway, Qianfan, MiniMax, Synthetic, Xiaomi MiMo, … | navDaq tetlhlu'bogh chal API |

**Hoch DaqDaq wa' pong.** Hoch HaSta Daq EYAS 'angbogh pongmey 'oH tetlhvam pongmey'e': nobwI' nav 'emwI' je, He patlh nobwI' wIvwI'mey, ja'chuq pat wIvwI' Dung tlhegh je, Hoch jang bIngDaq *jangpu'* tlhegh, ja'chuq Qagh QInmey, jup pat wIvwI', SeHmeyDaq **pat nobmey** 'emwI', tagh ghojmoHwI', Grok/Kimi 'el 'emwI' jIH Daq banner je. reH **Claude Code CLI** 'oH Claude Code. Kimi Code CLI, Kimi, rap nobwI'pu' je (xAI, Mistral, Groq, MiniMax, Xiaomi MiMo, …) Doch pongchaj 'ang, `kimi-cli` rurbogh ID ghobe' not. pat tetlh laDlaHbe'bogh legh (lo'wI' Segh 'ey) nobwI' IDmey legh.

**API (rarwI'pu').** `GET /api/v1/model/providers` Hoch tlhegh 'ej `GET /api/v1/model/providers/:id` De' je Doch pong `name` 'ej `kind` ngaS: `cli` (Claude Code, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM), pagh `api` (Hoch chal API 'ej Hoch Sovbe'lu'bogh ID).

### ja'chuq taHtaHghach {#conversation-continuity}

ja'chuq pol EYAS, nobwI' ghobe'. Hoch mIw, ja'chuq naQ pa'Dajvo' patDaq ngeH EYAS. CLI nobwI' session Daj pol pagh taHqa' not: Claude Code, Grok CLI, Kimi Code CLI Hoch mIw chu' tagh 'ej ngo' mIwmey ja'chuq qun 'ay'Daq Suq. Grok Kimi je reH chu' ACP session poSmoH, ngo' session laD not.

vaj nobwI' pagh pat DachoHDI' ja'chuq De'Daj pol, 'ej CLI session pa' De' pagh qawHaq Hal 'oHbe' not. Hoch nobwI'vaD rap taHtaHghach.

ngo' mIwmeyDaq chellu'bogh mIllogh qunvetlh 'ay' 'oH Grok CLI Kimi Code CLI jeDaq je, ja'chuqDaq ngeHlu'bogh DaqDaq. [Grok Kimi je nuq Suq](#what-grok-and-kimi-receive).

Claude Code ja'bogh mIw Huch mIwvam Huch 'oH, 'ej rap chellu'.

**pat API tlhol (rarwI'pu').** `POST /api/v1/model/complete` 'ej `POST /api/v1/model/stream` (chaw' `use Model`) porghchaj chov. lajlu'bogh Dochmey: `provider`, `model`, `messages` (1–1000; `user` pagh `assistant`; mu'tlhegh pagh ghItlh/mIllogh 'ay' tetlh), `system`, `maxTokens` (mI' lugh), `temperature` (0–2), `stopSequences` (16 'aqroS), 'ej chaw'lu'bogh `effort` (`none`vo' `max`Daq patlh, pagh `auto`). latlh ngaQ Hoch chIllu' — `sessionId`, `metadata`, `cwd`, `isolated`, `tools`, `thinking` je. vaj ra'meyvam nIteb Qaplu' ([nIteb vang](/docs/tlh/agents/autonomy/) patlh Qap), nobwI' session taHqa'laHbe', 'ej naDev `thinking` pagh Qap. jang, stream `done` wanI' je, `effortOutcome` ngaS: tlhoblu'bogh patlh, patDaq ngeHlu'bogh patlh, Hal je (`request`). lughbe'bogh porgh: `400` 'ej `{ error: 'ValidationError', issues }`.

### patmey 'ej patmey yIchu'qa' {#models-and-refresh-models}

**patmey yIchu'qa'** nobwI' tlhob: 'Iv patmey nob? 'ej Hoch tlheghvaD Qapbogh pat naQ pol (Grok pat ID, pagh Claude Code lo'bogh pong latlh rur). chu'qa'meH tu'lu'bogh pat EYAS taghqa'DI' Qap taH.

- pat naQ tlhegh ID rurbe'DI', pat tlhegh **&lt;pat&gt; Qap** tlhegh mach 'ang.
- chu'qa' Qapbogh patmey chel neH ghobe'. nobwI' DaH nobbe'bogh pat chu'Ha'lu' 'ej **Qav chu'qa'meH, pat nob Hutlh** per Suq. teqlu' not. veb chu'qa' nobqa'chugh, nIteb chu'qa'lu' — SoH'egh Dachu'Ha'pu'chugh ghobe'. perlu'bogh pat ghop Dachu'laH; ghIq SoH DaSeH.
- chu'qa' lujchugh (nobwI' SIchlaHbe'lu', 'ellu'be', ngoq Hutlh) pagh pat tetlh chImchugh, pagh choHlu' 'ej nav ja': *chu'qa' luj. patmey tetlh choHbe'lu'.* OpenAI, Gemini, OpenRouter, Kimi (API), OpenAI rap Daqmey je Qaghvam ja' — EYAS ngaSlu'bogh pat tetlh tamtaHvIS 'angbe'.

**pat neH pongbogh ghoqwI'pu'.** nobwI' Hutlhbogh pat ID pongbogh ghoqwI', laHwI', pagh He Daq — chu'lu'bogh pat tetlhDaj patvetlh ghajbogh nobwI' SIch: chu'qa'meH tu'lu'bogh Grok pat, pagh OpenAI pat chu' rur. chu'Ha'lu'bogh pagh Sovbe'lu'bogh pat, nobwI' chu'Ha'lu'bogh pat, cha' nobwI' nobbogh pat ID je — *No provider found for model* luj taH. Qubbe' EYAS not.

**CLI 'Iv pat Qap.**

- **Grok CLI:** **Grok CLI (&lt;pat&gt;)** motlh tlhegh — lIngbogh Grok CLI'egh motlh pat Qap. latlh Grok tlhegh Hoch — ponglu'bogh pat naQ Qap, taghqa'DI' je. CLI DaH nobbe'bogh Grok patDaq Qanlu'bogh ja'chuq pagh ghoqwI' — ngeHpa' luj: *Model '&lt;id&gt;' cannot be run by this CLI: Grok CLI does not offer it (the session would run &lt;default&gt;)*. latlh pat yIwIv pagh tetlh yIchu'qa'.
- **Claude Code:** EYAS Qapbogh Claude Code QapwI'vo' pat tetlh ghoS ([Claude Code patmey vum je](#claude-code-models-and-effort)). Hoch tlhegh pong latlhDaj Qapbogh Claude pat naQ pong, *opus* — *claude-opus-5-5* Qap rur. **Claude Code (Default)** tlhegh QapwI' motlh lo'bogh pat Qap. pat pong naQ Qap je.
- **Kimi Code CLI:** Kimi'eghvo' pat tetlh ghoS, 'ej DawIvbogh patDaq Hoch session vIHmoH EYAS ([Kimi patmey Qub je](#kimi-models-and-thinking)). **Kimi Code CLI** motlh tlhegh DaH Kimi cherlu'bogh pat Qap.
- pat ponglu'be'bogh pat ID (`grok-cli-` neH rur) mIw luj Qagh lugh tlhej, latlh Doch Qapbe'.

**API pat tetlhmey.**

- **Anthropic:** API ngoq DachelDI', ngoqvetlh lo'laHbogh patmey Anthropic Models APIvo' laD EYAS. tetlh ra' Hutlh Huch 'oH, pat ra' 'oHbe', 'ej Hoch pat context logh, mej 'aqroS, vum patlhmey je qem. Models API SIchlaHbe'lu'chugh, ngaSlu'bogh tetlh lo'lu'. **patmey yIchu'qa'** Da'uypa' pollu'bogh tetlhchaj pol lIngmey tu'lu'bogh; ghIq Opus 5.5, Opus 5, Sonnet 5, Fable 5.1 rurbogh patmey chu' 'anglu', 'ej pollu'taHvIS Qap ngo' tlheghmey (Opus 4.7, Opus 4.6).
- **OpenAI:** wa'DIch chu'qa'pa', ngaSlu'bogh tetlh: GPT-5.6, GPT-5.5, GPT-5.4, GPT-5 mini, o3-mini, GPT-4o, GPT-4o mini. GPT-4 Turbo ngaSlu'be' DaH; OpenAI nobchugh **patmey yIchu'qa'** tetlh taH. EYAS Sovbogh pat chu'qa'lu'bogh context logh mej 'aqroS je pol.
- **OpenRouter:** OpenRouter meq lajbogh per patmey laD **patmey yIchu'qa'** je. ngaSlu'bogh tetlh: Claude Sonnet 4.6, Claude Opus 4.6, GPT-5.5, Gemini 3.1 Pro preview, GPT-4o.
- **Kimi API:** Kimi K2.5 ngaSlu'be' DaH; **patmey yIchu'qa'**Daq Moonshot tetlh taHchugh neH 'anglu'.
- **Gemini:** DaH 3.x patmey ngaS ngaSlu'bogh tetlh; teqlu'bogh `gemini-2.0-flash`, `gemini-2.5-pro-preview-05-06`, `gemini-2.5-flash-preview-05-20` tu'lu'be'. **patmey yIchu'qa'** Da'uypa' ngo' tlheghmeychaj pol lIngmey tu'lu'bogh; ghIq API nobbe'bogh chu'Ha'lu' 'ej perlu'. ngoqlIj SIch taHchugh neH chu'qa' ret 2.5 qorDu' 'anglu' (ngo' lo'pu'bogh Qu'mey neH 2.5 nob Google). Gemini pat pongbe'bogh tlhob `gemini-3.8-flash`Daq ghoS.
- **Ollama:** nobwI' chu'lu' 'ej SIchlaHlu'DI', Ollamavo' Hoch pat laHmey laD EYAS — laDDI', 'emDaq, **patmey yIchu'qa'** je. Ollama tetlhbe'choHbogh patmey *Qav chu'qa'meH, pat nob Hutlh* per Suq 'ej laD ret je chu'Ha'lu'. chu'Ha'lu'bogh pagh SIchlaHbe'lu'bogh Ollama SIchlu' not.

**API (rarwI'pu').** `GET /api/v1/model/providers/:id` 'ej `GET /api/v1/model/models` Hoch patvaD `realModelId`, `missing` (Qav chu'qa' nobbe'DI' teH), Qapbogh meq laH je nob. `POST /api/v1/model/providers/:id/models/refresh` `missing` `restored` je tetlh nob, pagh `502` `ModelDiscoveryFailed` / `ModelDiscoveryEmpty` tlhej.

### meq vum {#reasoning-effort}

Hoch patvaD meq vum wuqlu', pat jangDI'. pat choHDI' — He, nIDqa', pagh Fallback — pat chu'vaD patlh wuqqa' EYAS.

- pat lajbe'bogh patlh, lajbogh patlh Sumqu'Daq rarmoHlu'. *jenqu'*Daq rInbogh patDaq *'aqroS* — *jenqu'* rur Qap; *jenqu'* ghajbe'bogh patDaq *jenqu'* — *jen* rur Qap.
- meq chu'Ha'laHbe'bogh pat — *pagh* tlhoblu'DI' patlh machqu'Daj Suq.
- EYAS chovta'bogh De' ghajbe'bogh pat meq Doch Suqbe' (**auto**: pat motlh'egh). Qubbogh ngaQ ngeH EYAS not.
- token Huch lajbogh patmeyvaD (Claude Haiku 4.5 pagh Gemini 2.5 rur) Qub Huch pat output 'aqroS'eghvo' cherlu', 'ej reH jangvaD logh ratlhmoH — vaj pat 'aqroS juSlaHbe' *'aqroS*.

**patlh mIr.** patlh mIr naQ: **pagh, machqu', ram, motlh, jen, jenqu', 'aqroS**, 'ej **auto**. naDev pagh pol auto: ghIq bIng mIwDaq patlh ghoS, 'ej pagh cherlu'chugh, pagh ngeHlu' 'ej pat motlh'egh Qap.

**nuqvo' patlh ghoS** (wa'DIch rapbogh Qap):

1. ja'chuq **vum**'egh;
2. **Deep** mIwDaq ja'chuq taHchugh *'aqroS*;
3. ja'chuq jatlhbogh jup (ghoqwI') vum — ja'chuqDaq, ja'chuq jup, pagh Qu' motlh jup;
4. Qu' nobbogh Sumqu'bogh ja'chuq patlh (bIng ja'chuq vavDajvo' Suq, vagh patlh Dung 'aqroS);
5. He patlh motlh, patlh lo'taHvIS Helu'bogh QInvaD 'ej EYAS 'em ra'meyvaD ([He 'ej Huch — patlh motlh vum](/docs/tlh/ai/routing-budget/#tier-effort));
6. pat motlh'egh.

jup pagh laHwI' QapDI' Hoch DaqDaq rap mIw Qap: ja'chuq, jup juH ja'chuq, 'em poH SeHwI' Qapmey je, nIDqa'mey taHqa'mey je (taHqa'bogh Qap wa'DIch Qap lo'pu'bogh vum rap lo'), ghom ghoqwI'pu', nobbogh Qu'mey laHwI'pu' je, pipeline mIwmey, A2A Qu'mey, He jangmey, God Mode je. vaj jup vum'egh ja'chuqDaj HeDaj je Qap, 'ej vumDaj ghajbe'bogh ghom ghoqwI' pagh laHwI' nobbogh ja'chuq patlh Suq — vaj laHwI'pu'Daj *'aqroS*Daq ngeH **Deep** ja'chuq, Huch law'. vumDaj'egh ghajbogh ghoqwI' pagh laHwI' pol. God ModeDaq, ja'chuqDaq cherlu'bogh vum Hoch qaDwI'Daq cha'loghlu' 'ej Deep mIw ngeHlu'; ghIq Hoch qaDwI' patlh patDaj'eghvaD rarmoHlu', 'ej ja'chuq vum lo' latlh noH wuqmey je.

**wa' vum wIvwI', Hoch patvaD.** ja'chuq nach, jup choHwI', Hoch He patlh, poH SeHwI' ghoqwI' mIw je **vum** wIvwI' rap lo'. pat lajbogh patlhmey neH tetlh — *jenqu'* nobbogh patmeyDaq (Claude Opus 4.7/4.8/5.x, GPT-5.4/5.5/5.6), *pagh* *machqu'* je ghajbogh patmeyDaq rur. chu'/chu'Ha' pat **QapHa' / Qap** 'ang. vum SeH ghajbe'bogh pat, pagh EYAS chovta'bogh De' ghajbe'bogh pat, auto neH nob, 'ej qatlh ja' Qub; meq ghItlhDaj 'angbe'chugh pat ja' Qub je. autom Helu'bogh ja'chuqDaq, pagh pat ngaQlu'be'bogh jupvaD, wa' pat ngaQlu'be': wa' autom He patlh pat (nom, motlh, Qatlh, ngoq ta') lajbogh Hoch patlh nob wIvwI', 'ej Qapbogh patvaD Hoch QIn patlh rarmoHlu'.

**auto nuq QIj ja'.** wa'DIch 'oH auto 'ej naDev nuq lo' pong: `auto · 'aqroS (jeD)`, `auto · jen (ghoqwI')`, `auto · jenqu' (ja'chuq nobwI')`, pagh `auto · model motlh (motlh)` — pat ghajwI' motlh'egh.

**pat tlha' tetlh.** ja'chuq pat, Deep mIw, pagh jup choHDI', tetlh chu'choH. ja'chuq pollu'bogh vum qa'moH pat chu' not: pat chu' ghajbe'bogh patlh *jenqu' → jen (jenqu' nobbe' Opus 4.6)* rur 'anglu', 'ej Hoch mIw rarmoHlu' 'ej qonlu'. jup choHwI'Daq 'ej He patlhDaq, pollu'bogh patlh nobbe'bogh pat DawIvDI', qonpa' choHlu' 'ej ja'lu': *vum choHlu': jenqu' → jen. jenqu' nobbe' model wIvlu'bogh.* vum SeH ghajbe'bogh pat autovaD choH.

**qonlu'bogh patlhmey patvaD chovlu'.** ja'chuq, jup, pagh He patlhvaD vum DacherDI', Qapbogh patvaD patlh chov EYAS. patvetlh lajbe'bogh patlh lajQo'lu' 'ej pagh pollu' — lajbogh patlhmey tetlh ja'chuq, 'ej *vum patlhvam nobbe' model. pagh polta'lu'.* ja' He patlh tlhegh. auto reH lajlu', 'ej wej Sovlu'bogh patvaD Hoch patlh lajlu' je (autom Helu'bogh ja'chuq, pat ghajbe'bogh jup, EYAS chovta'bogh De' ghajbe'bogh pat); Hoch ra'Daq rarmoHlu' chaH. pat neH DachoHDI', qonlu'bogh vummo' luj not.

**Hoch jang nuq lo'pu'.** Hoch jang bIngDaq, *nobwI' · pat* retlh, mIw lo'pu'bogh vum 'ang Degh mach: *vum: jen*, pagh pat tlhoblu'bogh patlh nobbe'DI' *vum: jenqu' → jen*. 'Iv cher ja' Qubvetlh (ja'chuq, jeD, ghoqwI', ja'chuq nobwI', He patlh, model motlh). pagh tlhoblu'DI' pagh ngeHlu'DI', Degh pagh. Hoch pollu'bogh jang tlhoblu'bogh 'ej lo'lu'bogh vum, patlh Hal, 'ej rarmoHlu''a' je pol — ja'chuq, nobbogh laHwI' Qapmey, pipeline mIwmey, Hemey jevaD. Hoch AI ra' tlha' rap qon — [AI bej](/docs/tlh/admin/observability/).

**nobwI'pu' nav nuq 'ang.** Hoch pat tlhegh meq tlhegh ghaj, *Qub: ram, motlh, jen, jenqu', 'aqroS · motlh motlh* rur, De' nuqvo' ghoS ja'bogh Degh tlhej: *ja'pu' QapwI'* (nobwI' pagh QapwI' pat tetlh'egh), pagh *EYAS tetlh, tobta' YYYY-MM-DD* (EYAS meq De' tobta'bogh tetlh). vum SeH ghajbe'bogh pat *Qub: vum SeHlaHbe'* 'ang; EYAS Sovbe'bogh pat *Qub: Sovbe' EYAS (vum auto ratlh)* 'ang.

**API (rarwI'pu').** `GET /api/v1/model/effort-options?providerId&modelId` (Model laD) pat patlhmey nob; pat ID pagh pong latlh neH tlhej, wa' ghajwI' nobwI' pat patlhmey; pat Hutlh, autom He patlh boq. `GET /api/v1/conversations/:id/effort-options` (Conversation laD, ghajwI' neH) patlhmey, pollu'bogh patlh (`current`), auto nuq Suq (`inherited`) je nob. lajQo'lu'bogh patlh `400` nob, ngoq `EFFORT_UNSUPPORTED`, patlh, pat lajbogh `levels` je tlhej.

#### chay' Hoch nobwI' vum patlh lo' {#effort-by-provider}

Hoch ra'vaD wa' patlh wuq EYAS, Dung rur, 'ej patlh mugh neH Hoch nobwI'. Hoch DaqDaq, jangbogh pat lajbogh Sovlu'bogh neH ngeH EYAS; chovta'bogh De' ghajbe'bogh pat meq Doch Suqbe'.

| nobwI' | patlhvaD nuq ngeH EYAS | nuqvo' patlhmey ghoS | auto | jang bIngDaq Qapbogh patlh |
|--------|------------------------|----------------------|------|----------------------------|
| Anthropic API | pat vum SeH (ghajDI') Qub je — adaptive, pagh token Huch lajDI' pat; pat chaw'DI' Qub chu'Ha' *pagh* | Anthropic Models API, 'ej ja'be'bogh De' (motlh, reH chu', Huch veH) EYAS tetlhvo' | pagh; motlh Qubbogh 'ach meqDaj So'bogh pat Dov neH tlhoblu' | EYAS ngeHbogh patlh |
| Anthropic rap Daqmey (MiniMax, Synthetic, Xiaomi MiMo) | pagh | — (chovta'bogh De' Hutlh) | reH | — |
| OpenAI | `reasoning_effort`, `max_completion_tokens` rur mej 'aqroS, temperature Hutlh | EYAS tetlh | pagh | EYAS ngeHbogh patlh |
| OpenRouter | `reasoning: { effort }`; Dung patDaq ngeH OpenRouter 'ej rarmoHlaH | OpenRouter pat tetlh (meq HIja'/ghobe'); Sovlu'bogh qorDu'mey EYAS tetlhvo' | pagh | EYAS ngeHbogh patlh |
| Kimi API (Moonshot) | `reasoning_effort` (K3) pagh Qub chu'/chu'Ha' (K2.6); temperature Hutlh | EYAS tetlh | pagh | EYAS ngeHbogh patlh |
| OpenAI rap 'em 'opmey (xAI, Mistral, Groq, Together, DeepSeek, Cerebras, Venice, Hugging Face, NVIDIA, Z.AI, Kilo, Vercel AI Gateway, Qianfan, vLLM) | pagh — xAI Grok 3 MinivaD `reasoning_effort` ghobe' | xAIDaq Grok 3 MinivaD EYAS tetlh; latlh 'em 'op meq SeH wej chovlu'be' | reH, Grok 3 Mini ghobe' | EYAS ngeHbogh patlh (Grok 3 Mini); pagh — |
| Gemini | Qub patlh (Gemini 3) pagh Qub Huch (Gemini 2.5), Qub Dovmey tlhej | EYAS tetlh; Qub Hutlh per pat Google pat tetlh | pagh; motlh Qubbogh patmey Dovchaj neH tlhoblu' | EYAS ngeHbogh patlh |
| Ollama | `think`: chu'/chu'Ha', pagh pat patlh ponglu'bogh'egh | Ollama pat De' (*thinking* laH mI'Daj je); gpt-oss EYAS tetlhvo' | pagh | EYAS ngeHbogh patlh |
| LM Studio | pagh — LM StudioDaq meq cherlu' | — | reH; LM Studio SeH'egh 'ang nav | — |
| Claude Code CLI | QaptaHbogh QapwI' patvaD ja'bogh vum; pat chaw'DI' Qub chu'Ha' *pagh* | Claude Code QapwI''egh, mu'tlhegh Hutlh laDlu' | pagh | QapwI'vo' laDqa'lu' |
| Grok CLI | session meq vum SeH, mu'tlhegh qaSpa' cherlu' | Grok CLI'egh, mu'tlhegh Hutlh laDlu' | pagh; Grok lo'bogh patlh qon mIw | Hoch mIw Grokvo' laDqa'lu' |
| Kimi Code CLI | pat Qub mI' pagh motlh mI', sessionDaq wIvlu' | Kimi pat tetlh'egh | DaH Kimi Qapbogh mI' pol | Hoch mIw Kimivo' laDqa'lu' |

*EYAS ngeHbogh patlh* QIj: patvaD patlh rarmoHpu'DI' EYAS, jang bIngDaq Degh patlhvetlh 'ang. *laDqa'lu'* QIj: Qappu'bogh patlh net ja' CLI, 'ej Degh tlha' je qon patlhvetlh, EYAS tlhobbogh rurbe'chugh je.

**Hoch nobwI' De'.**

- **Anthropic API.** Claude patvaD wIvmey — lajbogh patlhmey neH: Fable, Opus 5.5, Opus 5, Opus 4.7, Opus 4.8, Sonnet 5 jeDaq *jenqu'* tu'lu', Opus 4.6 Sonnet 4.6 jeDaq ghobe'; meq chu'Ha'laHbogh patDaq neH *QapHa'* noblu' (Fable pagh Opus 5.5Daq ghobe'). vum SeH ghajbe' Haiku 4.5 Sonnet 4.5 je, vaj pat mej 'aqroS rurbogh Qub Huch moj patlh, 'ej jang 'aqroS nIvmoH EYAS, jang pe'be'meH meq. auto pagh ngeH (motlh motlh Opus 5.5; tlhoblu'be'chugh Qubbe' Opus 4.8). tlhoblu'be'chugh meqchaj So'bogh patmey (Fable, Opus 5.5, Opus 5, Opus 4.7, Opus 4.8, Sonnet 5) Qubchugh meq Dov tlhoblu' — auto jeDaq, motlh Qubbogh patmeyvaD — vaj ja'chuqDaq 'ang; nuq 'anglu' neH choH. lajQo'bogh patmeyDaq (Fable, Opus 5.5, Opus 5, Opus 4.7/4.8, Sonnet 5) temperature, `top_p`, `top_k` je ngeHbe' EYAS, 'ej chu'bogh Qub retlh not.
- **Anthropic rap Daqmey** (MiniMax, Synthetic, Xiaomi MiMo): auto neH. pat mIw chovlu'pa' meq SeH ngeHbe' EYAS; temperature cherlu'bogh rur ngeHlu'.
- **OpenAI.** Chat Completions API nobbogh GPT-5 qorDu' Hoch pat, o-qorDu' je, patlh Suq, Hoch veH'egh tlhej: GPT-6 Astra ram–'aqroS (chu'Ha'laHbe'); GPT-5.6 pagh–'aqroS, motlh motlh; GPT-5.5 pagh–jenqu', motlh motlh; GPT-5.4 pagh–jenqu', motlh pagh; GPT-5.4 mini / nano 'ej GPT-5.2 pagh–jenqu', motlh pagh; GPT-5.1 pagh–jen, motlh pagh; GPT-5 / GPT-5 mini / nano machqu'–jen, motlh motlh; GPT-5 pro jen neH; o1 / o3 / o3-mini / o4-mini ram–jen, motlh motlh. Hutlhbogh patlh Sumqu'bogh patlhDaq vIH (GPT-5.5Daq *'aqroS* — *jenqu'* rur Qap). meq patmeyvamvaD temperature ngeH EYAS not 'ej meq pat mej 'aqroS (`max_completion_tokens`) lo' — qawHaq capture rurbogh 'em ra'mey je; ngo', ra'meyvetlh lajQo'laH GPT-5.2 'ej GPT-5.4 mini / nano. patlh wIvlu'chugh, mach mej 'aqroS patlh poQbogh nIvmoHlu' (ram 8k, motlh 16k, jen 32k, jenqu'/'aqroS 64k tokens, pat 'aqroS'egh Dung not). chovta'bogh De' ghajbe'bogh patmey (GPT-4o, GPT-4o mini, latlh je) meq Doch Suqbe' 'ej `max_tokens` temperature je pol. OpenAI Responses APIDaq neH tu'lu' 'op OpenAI patmey, EYAS lo'bogh Chat Completions APIDaq ghobe': GPT-5.2 pro, GPT-5.4 pro, GPT-5.5 pro, Codex patmey (GPT-5 Codex, GPT-5.1 Codex / Codex Max, GPT-5.2 / 5.3 Codex, codex-mini), o1-pro, o3-pro, deep-research patmey je. OpenAI nobwI'Daq auto neH taH 'ej janglaHbe'; OpenRouter lo'taHvIS yIlo'. ghItlhlu'bogh vum patlhmey ghajbe' GPT-5.1 mini, vaj auto taH.
- **OpenRouter.** meq lajbogh per OpenRouter cherbogh patmey machqu'–'aqroS nob; meq Hutlh tetlhbogh patmey vum SeH ghajbe'. Sovlu'bogh qorDu'mey patlhchaj net 'ang: Claude Opus/Sonnet 4.6 (QapHa', ram, motlh, jen, 'aqroS), OpenAI GPT-5.x / GPT-6 Astra / o-qorDu' (OpenAIDaq rur), Gemini 3.x (Gemini Qub patlhmey, vaj *jenqu'* — *jen* rur Qap). Sovlu' je: GPT-5.2 pagh–jenqu' (motlh pagh); GPT-5.2 pro motlh–jenqu'; GPT-5.4 pro motlh–jenqu' (motlh motlh); GPT-5.5 pro motlh–jenqu' (motlh jen); GPT-5.4 mini / nano OpenAIDaq rur; GPT-5.2 / 5.3 Codex ram–jenqu'. meq chu'Ha'laHbogh qorDu'Daq neH *QapHa'* noblu'.
- **Kimi API (Moonshot).** Kimi K3: ram / jen / 'aqroS (motlh 'aqroS; motlh — ram rur Qap). Kimi K2.6: meq chu' (jen) pagh chu'Ha' (pagh). Kimi K2.7 Code 'ej K2.7 Code Highspeed reH meq 'ej vum SeH ghajbe'.
- **OpenAI rap 'em 'opmey:** auto neH, `openai/gpt-5.4` rurbogh Hal pong ghajbogh IDmey je. xAI API nobwI'Daq, vum SeH ghajbogh pat wa' neH 'oH Grok 3 Mini (Grok 3 Mini Fast je): **ram** pagh **jen** (*motlh* — ram rur Qap; *jenqu'* *'aqroS* je — jen rur Qap). reH meq, 'ej meqDaj 'anglu'. Grok 3 Mini tetlhbe'choH xAI, 'ej 2026-08-15 Grok 3 Mini lo'be'choH Oracle Cloud, vaj janglaHbe'choHlaw'. xAI APIDaq latlh Grok patmey xAI motlhDaq meq: Chat Completions lo'taHvIS xAIDaq jatlh EYAS, 'ej naDev chaHvaD vum Doch ghItlhbe' xAI. Grok CLI nobwI' vum SeHDaj pol.
- **Gemini.** Gemini 3 patmey (3.8/3.7/3.6/3.5 Flash, 3.5/3.1 Flash-Lite, 3.1 Pro Preview, 3 Flash Preview) Qub patlh Suq — machqu', ram, motlh, pagh jen. Hutlhbogh patlh Sumqu'bogh patlhDaq vIH (machqu' ghajbe' 3.8/3.7 Flash 3.1 Pro je, vaj ram moj; *jenqu'* *'aqroS* je jen moj). reH Qub Gemini 3 patmey, vaj *pagh* patlh machqu'chajDaq Qap. Gemini 2.5 patmey patlhvo' Qub Huch Suq, pat veH qoDDaq (2.5 Pro 128–32,768 tokens; 2.5 Flash 24,576 'aqroS; Flash-Lite 512–24,576); 2.5 Flash Flash-Lite jeDaq Qub chu'Ha' *pagh*, 'ach patlh machqu'Daq Qap 2.5 Pro. Qub tokens DIl Google 'ach. patlh ngaSmeH mach mej 'aqroS nIvmoHlu', pat 'aqroS'egh Dung not. Google tetlh Qub Hutlh per patmey (TTS rur) Qub Doch Suqbe'.
- **Ollama.** *thinking* laH ja'bogh patmey **Qap / QapHa'** Suq: Qub chu'Ha' *pagh*, Dungbogh Hoch patlh chu'. gpt-oss ram, motlh, jen lajbogh (motlh motlh) 'ej chu'Ha'laHbe' (*pagh* — ram moj). pat Qub mI'mey naQ ja'bogh Ollama chu' neH chaH nob, Ollama motlh per tlhej. auto pagh ngeH (motlh Qub Qub patmey). laH ghajbe'bogh pat, pagh laHmey laDlaHbe'lu'bogh pat, Qub SeH Suq not — tlhob lajQo'ta'jaj Ollama. patlh wIvlu'chugh, Qub Daq nobmeH mach max-tokens SeH nIvmoHlu'.
- **LM Studio.** LM StudioDaq meq pagh vum Doch ngeH EYAS not, vaj naDev Hoch patlh auto rur Qap. pat meq SeH ja'chugh LM Studio, Hoch patvaD 'ang LM Studio nav, *qwen/qwen3-8b — LM Studio'Daq De'wI' meq SeH (motlh: on). EYAS 'agh, 'ach choHbe'.* rur. ngo' LM Studio chovnatlhmey Qub 'angbe'.
- **Claude Code CLI, Grok CLI, Kimi Code CLI.** [Claude Code patmey vum je](#claude-code-models-and-effort), [Grok patmey vum je](#grok-models-and-effort), [Kimi patmey Qub je](#kimi-models-and-thinking).
- **OpenCode** jan sidecar 'oH, ja'chuq nobwI' 'oHbe': OpenCode navDaq pat Qub mI'Daj je cherlu' ([OpenCode — pat 'ej Qub](/docs/tlh/automation/opencode/#model-and-reasoning)).

**Sovlu'bogh pat chovnatlh chu'.** EYAS Sovbogh pat jaj per ghajbogh qonHom, `-latest` pong, pagh `[1m]` De' Segh patvetlh patlhmey Suq — `gpt-5.4-mini-2026-03-17` pagh `kimi-k3-0115` rur. latlh Segh (pro, codex, chat, preview, beta, fast, …) pagh Sovbe'lu'bogh pat qorDu' auto neH taH, EYAS chovta'bogh De' ghajpa'. wa' nobwI'vo' latlh nobwI'Daq patlhmey ghoS not.

### Claude Code Qap {#claude-code-runtime}

DalIngbogh Claude Code CLI Qap EYAS, 'ej **Hoch DochvaD wa' QapwI'** lo': 'el chov, nobwI' lo'laHghach, wa'DIch tagh SeH, pat tu'meH mIw, Hoch ja'chuq mIw. `eyas doctor` ja'bogh 'oH Qapbogh'e'. QapwI' wIvlu' mIwvam:

1. `EYAS_CLAUDE_CODE_BIN` — `claude` QapwI' naQ He.
2. De'wI' PATHDaq tu'lu'bogh `claude`.
3. Qav: EYAS Agent SDK ngaSbogh ngo' Claude Code (DaH 2.1.89). lo'lu'DI' ghuHmoH `eyas doctor`.

`EYAS_CLAUDE_CODE_BIN` env 'oH — ngoDmo', UI SeH ghobe'. Qu' PATH `claude` ghajbe'DI' (launchd/systemd Qu', ngaSwI'mey) pagh lIng pIm DaQanmeH yIlo'. cherlu' 'ach lughbe'chugh (naQ He ghobe', Hutlh, Qapbe'), Claude Code nobwI' chu'Ha' taH: PATH pagh ngaSlu'bogh copyDaq chegh **not**, 'ej luj ja' doctor.

**chovnatlh pIm.** Claude Code 2.1.89vaD chenlu' EYAS SDK rarwI'. CLI chu' rap lo'lu', 'ej *version skew* ghuHmoHwI' 'ang doctor. CLI chu' neH yajbogh SeHmey ghajbogh QapwI'meyDaq neH ngeHlu' (Qub Dov rur, 2.1.280vo'). Qap EYAS Claude Code, chu'choH'eghbe' Claude Code ([Claude Code nIteb](#claude-code-isolation)); motlh rur SoH'egh yIchu'choHmoH, ghIq doctor tlheghDaj yIlegh ([tobta'bogh CLI chovnatlhmey](#proven-cli-versions)).

**'ellu'ta', lIngta' neH ghobe'.** `claude auth status --json` lo' EYAS 'el chovmeH: juH ra' 'oH, session taghbe', mu'tlhegh ngeHbe', Huch pagh. QapwI'vetlh 'ellu'ta'DI' neH Claude Code nobwI' qonlu' — 'ej chu' lIngDaq nIteb chu'lu': claude.ai 'el, `ANTHROPIC_API_KEY`, pagh Bedrock/Vertex SeH. PATHDaq `claude` tu'lu' neH — yapbe'. tugh Da'elchugh, nobwI'pu'Daq nobwI' yIchu'Ha' 'ej yIchu'qa', pagh EYAS yItaghqa'. ra' ja'bogh QIn Daq 'ej ghom not log pagh pollu'.

**So'bogh pat ra' pagh.** juH CLIvaD chov mu'tlhegh ngeH not EYAS — chovmeH pagh patmey tetlhmeH. QapwI''eghvo' pat tetlh laDlu', mu'tlhegh Hutlh — bIng yIlegh.

**Qub.** Claude Code mIwmeyDaq Qub chu'Ha'moHbe' EYAS, *pagh* tlhoblu'be'chugh. vum tlhoblu'be'chugh, pat motlh Qap. tlhoblu'bogh patlh ngeHlu' patvaD QapwI' ja'bogh vum rur neH; Qub token Huch ngaQ ngeHlu'be'. patlh mIr 'ej nuqvo' patlh ghoS: [meq vum](#reasoning-effort).

#### Claude Code patmey vum je {#claude-code-models-and-effort}

**QapwI'vo' pat tetlh ghoS.** EYAS Qapbogh Claude Code QapwI' — `eyas doctor` ja'bogh QapwI' rap — tlhob EYAS: 'Iv patmey nob? Hoch nobwI' taghDI' 'ej **patmey yIchu'qa'** Da'uyDI' qaS. mu'tlhegh ngeHbe', Huch pagh, 'ej Claude Code SeHmeylIj'eghvo' nIteb Qap; jangDaq chelwI' De' laDlu' pollu' pagh not.

- Hoch Doch pong latlhDaj Qapbogh Claude pat naQ pong, *opus* — *claude-opus-5-5* Qap rur. **Claude Code (Default)** Doch QapwI' motlh lo'bogh pat Qap.
- nobbe'choH QapwI'chugh Dochmey chu'Ha'lu' 'ej perlu', teqlu' not — Sovbe'bogh QapwI'Daq Fable chu'Ha'lu' rur.
- **Hoch pat vum patlhmey QapwI' ja'bogh rur net**, nobDI' *jenqu'* je. vum SeH nobbe'bogh QapwI' pat (Haiku rur) auto neH nob. auto pagh ngeH, vaj pat motlh'egh Qap (Opus 5.5Daq motlh rur).
- QaptaHbogh QapwI' patvaD ja'be'bogh patlh ngeH not EYAS. latlh Claude Code chovnatlhvo' pollu'bogh patlhmey ghoSchugh, veb tagh pagh chu'qa' ret neH patlh ngeHlu'.
- Qub Dov (vaj ja'chuqDaq pat meq leghlu') Claude Code 2.1.280 pagh chu'vo' tlhoblu'. Claude Code ngo' — EYAS ngaSbogh 2.1.89 je — tlhobmeH mIw nobbe': tlhoblu'be'chugh Qubchaj So'bogh patmeyvaD (Fable, Opus 5.5, Opus 5, Opus 4.7/4.8, Sonnet 5) ja' vum wIvwI' *Qub ghItlh 'aghbe' modelvam.* vum patlhmey'egh choHbe'. meq DaleghmeH, Claude Code 2.1.280 pagh chu'Daq yIchu'choHmoH 'ej patmey yIchu'qa' (pagh EYAS yItaghqa').
- **Qorwagh.** Fable, Opus, Sonnet, Haiku Dochmey 200k Qorwagh tetlh — pongmeyvam nobbogh QapwI' Qorwagh — wa'DIch taghDI' je, pagh QapwI' pat tetlh laDlaHbe'lu'taHvIS je. QapwI''egh nobbogh 1M Segh neH (*Opus (1M context)* rur, pong `opus[1m]`) 1M rur tetlhlu' 'ej cherlu'. jangbogh patvaD Qorwagh tIn law' ja'chugh QapwI', Qorwaghvetlh lo' Qorwagh 'ar tebta' tlhegh taH. ngo' chovnatlh 1M rur pollu'bogh, 'ej ghIq pat laD chovbe'bogh Doch veb taghDI' 200kDaq tI'lu', pat laD luj taHvIS je; Dachu'Ha'pu'bogh Dochmey chu'Ha' taH.
- **lo'lu'bogh vum Hoch mIw QapwI'vo' laDqa'lu'**: *jenqu'* Datlhob 'ej *jen* Qap QapwI', 'ej ja' jang; auto tlhej pat lo'bogh patlh pong jang.
- **Hoch jang jangbogh pat naQ qon**, tlha'meyDaq qawHaq Hal je. pat wIvlu'be'bogh mIw *Claude Code (Default)*vaD ghoSlu'.

**CLIDaq 'em ra'mey.** 'em pat ra'mey (qawHaq capture, pongmey, Hub chovmey) He patlh Claude Code, Grok CLI, pagh Kimi Code CLI pat ngaQlu'bogh lo' CLIvetlh tu'bogh patvetlh nobDI' neH; pagh CLI motlh pat Qap. DaH nuqDaq ghoS EYAS 'em Qu' 'ang [He 'ej Huch — retlh pat ra'mey](/docs/tlh/ai/routing-budget/#background-model-calls-card).

**CLIDaq mej 'aqroSchaj pol 'em ra'mey.** EYAS wa'logh ra'mey mach'egh — ja'chuq pongmey, QIn Segh wIv, qawHaq capture, Hub noHwI' wuq, boq je rurbogh 'em mIwmey — jang tIqghach 'aqroS tlhob. EYASvo' mej 'aqroS Suqbe' CLImey, vaj Claude Code, Grok CLI, Kimi Code CLI jeDaq jang ghoStaHvIS jang mI' EYAS: tlhoblu'bogh Hoch tokenvaD loS ghItlh Hom Dung SIchDI' (`maxTokens` × 4 ghItlh Hom), CLI mevmoH EYAS (Claude Code: ra' SoQmoHlu'; Grok Kimi je: poH qIllu'). ghIq motlh rIn ra', DaqvetlhDaq jang tlhej 'ej mev meq *max tokens* (*mej veH paQlu'pu'*) tlhej, Qagh tlhej not — API nobwI'pu' rur. jang neH toghlu'; meq 'aqroS lo'be'. janmey ghajbogh ja'chuq ghoqwI' mIwmey choHbe'lu', CLI mIw wa' pat ra'mey law' Qapmo'. Claude Code 2.1.281 Grok CLI 1.0.41 jeDaq tob nob chov; code He rap lo' Kimi Code CLI 'ach wej QaptaHvIS chovlu'be'.

### Claude Code nIteb {#claude-code-isolation}

reH nIteb Qap Claude Code EYAS. SeHwI' tu'lu'be': ngo' **Load host Claude config** SeHwI' teqlu'. wa' tlheghDaq ja' nobwI' nav, 'ej qach `CLAUDE.md` De' qemmeH De' tlhap 'oS.

Hoch Claude Code Qap — ja'chuq, ghoqwI'pu', 'em Qu', nIteb wa'logh ra'mey je:

- qach `settings.json` laDbe' (vaj hooks pagh chaw' chutmey pagh), Hoch patlhDaq `CLAUDE.md` laDbe' (lo'wI', Qu', juH), qach laHmey laDbe', 'ej Qu' `.mcp.json`, teywI' pat, claude.ai MCP De'wI'mey laDbe'. jan De'wI'Daj wa' neH: EYAS `eyas` De'wI''egh; 'em wa'logh ra'mey pagh Suq;
- Claude Code auto-qawHaq'egh chu'Ha'lu'taHvIS Qap;
- ngaj teywI'meyDaj — 'em ra'Daj shell ra'mey ghum je — Qapvetlh pa''eghDaq pol, EYAS workspaces pa'Daq — qach `/tmp/claude-<uid>`Daq ghobe'. Qap rInDI' pa' Qaw'lu'; Qaw'DI' pa' ratlhbogh, veb taghDI' Qaw'lu';
- `~/.claude/projects` bIngDaq ja'chuq qon ghItlhbe' 'ej teywI' checkpoint cha'logh chenmoHbe', vaj `claude --resume`Daq 'angbe' EYAS Qapmey (ngo' EYAS chovnatlhmey ghItlhpu'bogh ja'chuq qonmey nIteb Qaw'lu'be');
- qach 'el pol: claude.ai chelwI', API ngoq, OAuth token, Bedrock pagh Vertex Qap taH.

ghom SeH chutmey (enterprise-managed policy), ghom lanchugh, Qap taH; patlhvetlh chu'Ha'laHbe' EYAS.

ja'chuq pa' qoDDaq Qu' ra' teywI'mey (`CLAUDE.md`, `AGENTS.md`) nIteb laDlu'be' je. teywI' janmeyDaj lo'taHvIS poSmoHlaH pat taH.

**vum pa'.** ja'chuq wa'DIch lughtaHbogh pa'Daq vum Claude Code, pagh ja'chuq EYAS vum pa''eghDaq. EYAS De'wI' pa''eghDaq Qap not (EYAS juH, ngoq teywI', vault, De' pa' je ghajbogh). ja'chuq ghajbe'bogh 'em ra'mey Qap wa' poH pa' lo', 7 jaj lo'be'lu'DI' teqlu'. DaH lughbe'bogh qonlu'bogh pa' buSHa'lu', De'wI' logDaq ghuHmoHwI' tlhej. [ja'chuqmey — pa'mey](/docs/tlh/daily/conversations/#working-folders).

**env.** chaw'lu'bogh env neH Suq Claude Code: `PATH`, Hol poH yoS je, proxymey CA boqmey je, `HOME`, 'ej Anthropic / Claude OAuth / Bedrock / Vertex 'el Dochmey. ghIq nIteb SeHwI'mey cher EYAS — `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `DISABLE_AUTOUPDATER=1` — Qap ngaj pa''eghDaq `CLAUDE_CODE_TMPDIR` ghoSmoH, 'ej Claude CodevaD `eyas` rur 'egh ngu'. latlh De'wI' Dochmey ngeHlu'be': latlh nobwI' API ngoqmey, EYAS peghmey, `CLAUDE_CONFIG_DIR`, 'ej EYAS taghmoHbogh Claude Code session `CLAUDE_CODE_*` SeHwI'mey. 'el chov (`claude auth status`) env rap lo'. `DISABLE_AUTOUPDATER`mo', Qap EYAS Claude Code, chu'choH'eghbe' Claude Code.

**tagh chov.** Hoch Qap taghDI' nuq laDpu' ja' Claude Code, 'ej jang 'ay' lo'pa' ja'vetlh chov EYAS. EYAS jan De'wI''egh neH rarlaH, chaw' mIw `default` 'oHnIS, vum pa' pIHlu'bogh 'oHnIS, 'ej plugin laDlaHbe' — Claude Code 2.1.281 ngaSbogh cha' plugin ghobe': `agents-md` 'ej `telemetry`, `agents-md@builtin` `telemetry@builtin` je rur neH lajlu'. EYAS nIteb bIngDaq Qobbe' chaH 'e' tob EYAS chu'choHpa' chov: vum pa'vo' pagh bIng pa'vo' `AGENTS.md` patDaq ghoSbe'. latlh Hoch plugin, Claude Code chu' ngaSbogh plugin chu' je, Qap mevmoH taH. latlh Doch 'anglu'chugh — qach SeHvo' MCP De'wI' pagh plugin, pagh latlh chaw' mIw ra'bogh ghom chut rur — SIbI' Qap mevmoH EYAS. Qapvetlhvo' pagh 'anglu', 'ej CLI nIteb Qagh tlhej mIw luj; HollIjDaq luj chovmey ponglu' — *Claude Code CLI mevmoHlu'pu': mob Qu'vam, 'e' 'ollaHbe' EYAS (EYAS wIvbogh vum qawHaq ghaHbe' vum qawHaq). latlh model nobbe'lu'.* rur. nIDqa'lu'be', latlh nobwI'Daq vIHlu'be'. juHDaq tI'meH: Qaghbogh ghom SeH pagh plugin yIteq, pagh `EYAS_CLAUDE_CODE_BIN` 'oSbogh QapwI' yIchov.

**Claude Code janmey'egh wa'DIch EYAS qawHaq chut Suq.** Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch, pagh latlh Claude Code jan Qappa', janvetlh Hoch He EYAS qawHaq chutDaq rapmoH wa' chov — vum pa'Daj qoDDaq Claude Code chaw''eghbogh laDmey je. latlh jan qawHaq (`~/.claude`, `~/.grok`, `~/.codex`, Obsidian vaultmey, tetlh latlh, `security.foreignMemoryPaths` je), EYAS De' pa''egh, latlh ja'chuq vum pa' je lajQo'lu'. lajQo'lu'bogh ra' Qapbe'; meq Suq Claude Code — *Memory outside EYAS (Obsidian) — use memory_search / memory_expand from EYAS* rur — 'ej EYAS qawHaq janmey lo'taHvIS taHlaH. SIchlaHbogh Hoch Doch lo'taHvIS Grep, Glob, LS, qoDDaq nejbogh Bash nej je noHlu': pa'Daj Hublu'bogh Daq ngaSchugh — `~` Grep, pagh `data/` ngaSbogh EYAS Hal lIng Grep rur — *Search too broad …* rur lajQo'lu', 'ej pa' machDaq nIDqa'laH Claude Code. [Hub 'ej pegh — EYAS Hur qawHaq](/docs/tlh/admin/security-privacy/#memory-outside-eyas). chovvetlh Dung, tu'lu'DI' OS teywI' HungDaq Qap Claude Code shell ra'mey — [kernel teywI' Hung](#kernel-file-sandbox).

**Claude CodeDaq EYAS janmey.** in-process `eyas` MCP De'wI' lo'taHvIS EYAS janmey SIch Claude Code, mu'tlheghDajDaq `mcp__eyas__<pong>` ponglu'. DaH Qu'vaD EYAS noblu'bogh janmey neH nob De'wI'vetlh: ghoqwI' **janmey** tetlh, `memory_search` `memory_expand` je (tetlh chIm — Hoch jan). **Solo** ja'chuqDaq ghoS janmey nobbe'. Claude Code janDaj'egh chaw'lu'bogh rap ghajbogh EYAS janmey noblu'be' — `read_file`, `grep`, `glob` je (Read, Glob, Grep je'egh), ghItlhlaHtaHvIS `write_file` `edit_file` je, 'ej shell lo'laHtaHvIS `run_command`, `git_status`, `git_diff` je: ghIq mIw pa'meyDaq, Hung qawHaq chut je bIngDaq, janmeyDaj'egh lo' Claude Code. `run_command` Hutlhbogh tetlhDaq, EYAS janmey rur noblu' `git_status` `git_diff` je. latlh EYAS jan Hoch noblu', EYAS Internet janmey je (`browser_*`, pollu'bogh sessionmey `browser_totp` je), `agent_browser_*`, `browser_use_*`, `opencode_*`; EYASDaq Qap chaH, API nobwI'Daq rur Hub lojmIt, chaw'mey, jan He je bIngDaq. latlh nobwI' Hoch rur, qawHaq nej **wa' jangvaD 3 ra'** 'oH. [MCP — CLI MCP jan rap](/docs/tlh/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

**CLI janmey'egh ngaQmoH ghoqwI' janmey tetlh je.** Claude Code, Grok CLI, Kimi Code CLI jeDaq rap, CLI janmey'egh 'Iv lo'laH pat wuq ghoqwI' **janmey** tetlh, rarwI' lo'taHvIS SIchbogh EYAS janmey neH ghobe' — API pat ngaQmoHbogh rur:

- **teywI' ghItlh** (Claude Code Write, Edit, NotebookEdit je; Grok Kimi je choHmeH vIHmeH janmey, 'ej CLIvaD EYAS nobbogh teywI' ghItlhmey): tetlhDaq `write_file` pagh `edit_file` tu'lu'DI' neH.
- **shell ra'mey** (Claude Code Bash; Grok Kimi je QapmeH janmey; Qaw' shell ra' rur toghlu' je, Hub lojmIt Segh wIvbogh rur): tetlhDaq `run_command` tu'lu'DI' neH. shell nobbe' `git_status` `git_diff` je.
- **web qem web nej je** (Claude Code WebFetch WebSearch je; Grok Kimi je qemmeH janmey, 'ej Grok web_fetch web_search je): tetlhDaq web jan — `research`, `browser_navigate`, `agent_browser_run` pagh `browser_use_exec` — tu'lu'DI' neH.
- **teywI' laD** (Claude Code Read, Glob, Grep je; Grok Kimi je laDmeH, nejmeH, tetlhmeH janmey) reH chaw'lu', tetlh nuq ja' 'ach. ja'chuq pa'mey qoD taH, qawHaq chut kernel teywI' Hung je bIngDaq. qawHaq nej reH lo'laH je.
- tetlh chIm — Hoch jan taH, CLI janmey'egh je.

Claude CodeDaq, noblu'be'bogh janmey patvaD noblu' not. Grok KimiDaq, CLI lo' 'e' nIDbogh noblu'be'bogh jan lajQo' EYAS, Hub lojmIt tlhoblu'pa': chaw' tlhob pagh, 'ej jan tlhegh **lajQo'lu'** 'ang (tlheghDaq lajQo' ghItlh'egh 'ang Grok). Kimi chaw' tlhobmey nuq jan Segh tlhob ja'be' (Kimi 1.52.0 Halvo' laDlu'; wej qachDaq chovlu'be'), vaj teywI' ghItlhmeH janmey pagh `run_command` Hutlhbogh tetlh ghajbogh ghoqwI'vaD Segh wIvlaHbe'lu'bogh Kimi tlhob lajQo' EYAS — ghoqwI'vetlh Kimi tlhobbogh janmey Hoch lo'laHbe' (teywI' ghItlh pagh tam, shell, 'em Qu'mey). Kimi web nej qem je EYAS tlhob not, vaj Hoch ghoqwI'vaD chaw'laHbe'lu'; lo'bogh mIw mevmoH EYAS nIteb chov taH. **vIHmoH:** tetlh mach ghajbogh ghoqwI'pu' tu'lu'bogh — `run_command` / `write_file` Hutlhbogh jIH QaHwI' rur — Claude Code, Grok, KimiDaq teywI'mey ghItlhlaHbe'choH 'ej ra'mey QaplaHbe'choH. Dachaw'meH, tetlhDaq `write_file` / `edit_file` 'ej/pagh `run_command` yIchel, pagh tetlh yIteq. [ghoqwI'pu' — janmey](/docs/tlh/agents/configure/#tools--constraints) yIbej.

**laHwI'pu'.** So'bogh ghoqwI'Hommey'egh taghbe' Claude Code (Task/Agent janDaj noblu'be'). Claude CodeDaq Qapbogh jup vum pImmoHDI', `run_specialist` lo'taHvIS EYASvo' laHwI'pu' tagh, latlh nobwI'pu' rurqu' — [ghommey Segh je](/docs/tlh/agents/teams/).

**chu'choH.** **Load host Claude config** chu'lu'pu'bogh lIng nIteb mIwDaq vIHlu'; wa'DIch taghDI' qonlu'bogh SeH teqlu', 'ej ratlhbogh ngaQ buSHa'lu'. qach `CLAUDE.md` ra'mey qach laHmey je ja'chuqmeyDaq ghoSbe'. De'vetlh DapolmeH, wa'logh, wa' He neH, yItlhap: **SeHmey → pat → De' vIH → De' yItlhap** — [De' tlhap](/docs/tlh/admin/data-port/).

### Grok CLI Kimi Code CLI je {#grok-cli-and-kimi-code-cli}

De'wI' Grok, Kimi, Claude SeH'eghvo' naQ nIteb Qap Grok CLI Kimi Code CLI je EYAS.

**juH'egh.** EYAS De' pa' qoDDaq juH pa''egh lo'taHvIS Hoch CLI tagh EYAS — `<data dir>/cli-homes/grok-cli` 'ej `<data dir>/cli-homes/kimi-cli`. EYAS Qapmey vumwI' `~/.grok`, `~/.kimi`, `~/.claude`, `~/.cursor`, `~/.agents` laDbe' ghItlhbe' je: qach SeH, chutmey, `AGENTS.md`, qawHaq, laHmey, hooks, Claude/Cursor tlhapmey, MCP De'wI'mey (Obsidian vault De'wI' rur) pagh.

**env.** tetlh mach neH ghoS CLIDaq: `PATH`, Hol poH yoS je, `TMPDIR`, `TERM`, `USER`, `LOGNAME`, `SHELL`, proxy Dochmey, CA boq Dochmey je. EYAS peghmey, latlh nobwI' ngoqmey, De'wI' envDaq `XAI_API_KEY`, 'ej De'wI' Hoch `GROK_*`, `KIMI_*`, `XDG_*` SeH chIllu'.

**'Iv QapwI'.** `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` (QapwI' He naQ) nIv, pagh PATHDaq `grok` / `kimi`. Doch cherlu' 'ach lughbe'chugh, nobwI' qonlu'be' — PATHDaq chegh not. nobwI' Dachu'qa'DI' (chu'Ha' 'ej chu'), QapwI' tu'qa'lu'.

**vum pa'.** ja'chuq wa'DIch lughbogh pa'Daq Qap Grok pagh Kimi mIw, pagh ja'chuq EYAS vum pa''eghDaq, pagh Qap poH pa' peghDaq — EYAS De'wI' vum pa''eghDaq not.

**ghItlh EYAS Grok SeHmey.** Hoch Qappa' Grok juHDajDaq `config.toml`, `requirements.toml`, chIm `trusted_folders.toml` je ghItlh EYAS; naDev choHmey qa'lu'. cher chaH:

- **tlhob mIw.** Hoch Grok jan'egh — teywI' laD, pa' tetlh, nej, shell, ghItlh/choH, Internet qem nej je, ghoqwI'Hommey — wa'DIch EYAS tlhob, 'ej EYAS Hub lojmIt wuq.
- **Hoch chaw' ngaQlu'.** `--always-approve`, yolo mIw, `/always-approve` Qapbe'.
- qawHaq, qawHaq v2, session nej, telemetry tlha' lI' je, nobchuqbogh leader mIw (`--no-leader` tlhej tagh Grok), nIteb chu'choH je chu'Ha'lu'.
- EYAS jan De'wI''egh (`eyas`) neH rarlaH.
- **pa' voq nob not.** ja'chuq pa' `AGENTS.md`, `.grok` SeH, hooks, MCP De'wI'mey je nIteb laDlu'be'; teywI' janmeyDaj lo'taHvIS teywI'mey poSmoHlaH pat taH, 'ej Hoch laD EYAS tlhob.

**ghItlh EYAS Kimi SeHmey.** Kimi SeH'eghDaq `default_yolo = false`, `telemetry = false`, `merge_all_available_skills = false` je cher EYAS, 'ej teywI'vetlhDaq latlh Hoch pol ('el, motlh pat). MCP De'wI''egh ghajbe' Kimi, nIteb chu'choH chu'Ha'lu', 'ej `kimi acp` naQ rur taghlu'. teywI'vetlhDaq EYAS vIHmoHbogh pat pol Kimi je — [Kimi patmey Qub je](#kimi-models-and-thinking).

**session teywI'mey teqlu'.** EYAS juHDajDaq CLI ghItlhbogh ja'chuq qonmey, mu'tlhegh qun, jan logmey je Hoch mIw rInDI' teqlu'. wa' rep ngo'bogh ratlhbogh (Qaghpu'DI') taghDI' 'ej Hoch repDaq teqlu'. EYAS ja'chuq'egh choHbe'lu': Hoch mIw pa''eghvo' ngeHqa' EYAS.

**Grok shell.** Grok shell ra'mey `HOME` rur EYAS Grok juH lo', vaj qach `~/.gitconfig`, SSH ngoqmey, shell SeH je tu'lu'be' — Grok shellvo' git commitmey qach ngu' ghajbe' rur. De'wI' nobDI', OS teywI' HungDaq Qap Grok janmey'egh je — [kernel teywI' Hung](#kernel-file-sandbox).

**mIw 'aqroS.** Grok KimivaD jan ra'mey togh mIw 'aqroS. ja'chuq mIw ja'chuq jup **mIw 'aqroS** lo' (pagh Qu' motlh ghoqwI'), pagh motlh 25; ghoqwI' Qapmey ghoqwI' **mIw 'aqroS** lo'; Huch cherbe'bogh ra'mey neH nobwI' `maxTurns` SeH (motlh 25) lo'. 'aqroS juSbogh wa' jan ra' tagh CLI, CLI session qIl EYAS: *max turns* rur rIn mIw 'ej jang 'ay' pol. Qagh 'oHbe', 'ej latlh jan ra' Qapbe'. ja'chuq mIwvaD Claude Code qoD mIw 'aqroS 'oH Huch rap.

**poH 'aqroS ngaQlu'bogh pagh.** ngaQlu'bogh poH ret Claude Code, Grok, pagh Kimi mIw mevmoHlu'be'. tamDI' CLI neH mev: jan Qapbe'taHvIS 10 tup QIn Hutlh, pagh jan QaptaHvIS 20 tup QIn Hutlh (`run_specialist` taghbogh laHwI' — 15 tup lo'laH — pagh ghItlh tIq rur). CLIvo' Hoch QIn — ghItlh yIn, jan tagh pagh rIn, chaw' tlhob — poH taghqa'moH, 'ej mIw naQvaD 'aqroS pagh; **mev** reH rInmoHlaH. tammo' mevlu'bogh mIw poH natlh ja', motlh *aborted* Qagh ghobe'; latlh poH natlh rur, pagh ngeHlu'pa' wa'logh nIDqa'laH pagh latlh nobwI'Daq vIHlaH, 'ej 'em Qap nIDqa'laH nIteb nIDqa' SeHwI'. cha' 'aqroS `model.cli.idleTimeoutMs` `model.cli.toolTimeoutMs` je — [SeH — CLI mIw poH 'aqroS](/docs/tlh/deploy/configuration/#cli-turn-timeouts). EYAS janmey ra'meH Grok Kimi je lo'bogh Hoch mIw ngoq Qav lo' ret 2 rep Hegh, vaj mIw tIq vumtaHbogh EYAS janmeyDaj pol; mIw rInDI' SIbI' Qawlu'.

**slash ra'mey.** `/` taghbogh QIn (`/always-approve on` rur) `<message>…</message>` ngaSbogh GrokDaq pagh KimiDaq ngeHlu', vaj ra''egh rur Qapbe' CLI not. ghItlh legh pat taH.

**Kimi veHmey.** Kimi nIteb ngoq Halvo' tu'lu', wej De'wI'Daq toblu'be' ([tobta'bogh CLI chovnatlhmey](#proven-cli-versions)). pa' voq lojmIt ghajbe' Kimi: ja'chuq pa'Daq `AGENTS.md` / `.kimi/AGENTS.md` laD taH, 'ej pa' git qoDDaq tu'lu'DI' git qach Hevo' SIch. nej Internet janmeyDaj EYAS tlhob not, vaj bIng nIteb chov lo'bogh Kimi mIw mevmoH. meqvammo', tIn law'mo' Kimi nej lajQo'laHbe' EYAS: EYAS tlhob not Kimi Grep Glob je'egh, vum pa'Daj qoD taH Kimi Glob 'ach Hoch pa' laj Grep, 'ej kernel teywI' Hung ghajbe' Kimi ([Hub 'ej pegh — EYAS Hur qawHaq](/docs/tlh/admin/security-privacy/#memory-outside-eyas) yIlegh). Kimi Grok je ghItlh, shell, web janmey'egh ngaQmoH ghoqwI' **janmey** tetlh, [Claude Code nIteb](#claude-code-isolation)Daq ja'lu'bogh rur.

#### EYASvaD Grok Kimi je yI'el {#sign-in-grok-and-kimi-for-eyas}

EYAS juH'eghDaq Qapmo' Grok Kimi je, De'wI' CLI 'el lo'be'lu'. **qach 'el lo'pu'bogh lIng Grok pagh Kimi pat Qapbogh ghajbe', EYASvaD wa'logh 'el vay' net.** vumwI' qach `grok` / `kimi` 'el laDlu' not, choHlu' not, lo'lu' not, 'ej EYAS 'el chu''egh.

**EYASvaD yI'el** chovnatlh wej DaqDaq 'ang: Grok CLI / Kimi Code CLI nobwI' nav, Grok pagh Kimi tu'lu'DI' [tagh ghojmoHwI'](/docs/tlh/setup-wizard/) AI nobwI' mIw, 'ej chu'lu'bogh lIngbogh CLI 'ellu'be'DI' [jIH Daq](/docs/tlh/daily/home/) banner, *EYASvaD &lt;CLI&gt; yI'el poQlu'* (**yI'el** chovnatlh poSmoH; **yIQaw'** browser qepvaD banner So'). joH SeHwI' je neH 'ellaH pagh mejlaH, 'ej loSbogh 'el rar ngoq je luleghlaH neH; latlh lo'wI'pu' Dotlh legh.

**De'wI' ngoq (Grok Kimi je).** **jan ngoq lo'taHvIS yI'el** yIchu'. pa''eghDaq CLI 'el'egh Qap EYAS 'ej rar (**yI'el laSvargh yIpoSmoH**) ngoq je 'ang. Hoch De'wI'Daq rar yIpoSmoH, yI'el, 'ej ngoq rap 'ang nav 'e' yIchov. De'wI'Daq browser poQbe'lu', vaj nach Hutlhbogh De'wI'meyDaq Docker je Qap. *ngoq Dalob 'e' loStaH…* 'ang chovnatlh, ghIq **'ellu'ta'**.

- **yImev** loSbogh 'el mevmoH.
- 15 tup 'olmoHbe'chugh 'el Hegh; yItaghqa'. ngoq chu' tlhej Kimi taghqa''egh je.
- CLI jangDaq rar tu'laHbe'chugh EYAS, CLI ghItlh naQ 'ang, vaj DatlhaDlaH.
- lujDI' CLI Qav QIn 'ej **yInIDqa'** 'ang.

**API ngoq (Grok neH).** **API ngoq yIlo' neH** yIwIv 'ej xAI API ngoq yIlan. [peghmey](/docs/tlh/admin/secrets/)Daq `grok-cli-api-key` (System) So' pol EYAS, 'ej Grok CLI QapmeyDaq neH ngeH, `XAI_API_KEY` rur. xAI API chelwI'Daq DIllu' lo', Grok/SuperGrok chelwI'Daq ghobe'. De'wI' 'el ngoq je tu'lu'chugh, De'wI' 'el lo' Grok. pongvetlh lo'taHvIS peghmey navDaq ngoq DachellaH je; nobwI' nav pagh ghojmoHwI' chovnatlh poSmoHlu'DI', nobwI' chu'qa'lu'DI', pagh 'el Qagh tlhej wa'DIch mIw lujDI' Suq EYAS. EYASDaq API ngoq SeH ghajbe' Kimi.

**yImej** EYAS pa'vo' EYAS Grok pagh Kimi 'el teq 'ej pollu'bogh API ngoq Qaw'. GrokvaD, pa''eghDaq `grok logout` Qap EYAS. KimivaD, 'el teywI''egh Qaw' EYAS 'ej `kimi logout` Qapbe', ra'vetlh OS keychainvo' vumwI' Kimi token je teqmo'. qach 'el Hotlu' not.

**'ellu'be'DI',** nobwI'vetlhDaq ja'chuq pagh 'em mIw SIbI' luj, CLI taghpa', *EYASvaD &lt;nobwI'&gt; 'ellu'be'. … nobwI'pu'Daq yI'el.* tlhej (Qagh ngoq `cliSignIn`). nIDqa'be' EYAS, 'ej tamtaHvIS latlh nobwI'Daq vIHbe'. mIwDaq CLI ja'bogh 'el Qagh QIn rap nob.

**nuqDaq 'el De' yIn:** `<data dir>/cli-homes/grok-cli/.grok/auth.json` 'ej `<data dir>/cli-homes/kimi-cli/.kimi/credentials/kimi-code.json`, EYAS lo'wI' neH poSmoHlaHbogh pa'meyDaq. De' pa' [qon](/docs/tlh/admin/backup/) ngaS chaH.

**API (rarwI'pu', joH/SeHwI' je; GETvaD laD chaw').** `GET /api/v1/model/providers/{grok-cli|kimi-cli}/sign-in` nob `{signedIn, method: device|apiKey|null, apiKeySupported, apiKeyStored, session{state: pending|succeeded|failed|expired|cancelled, verificationUrl, userCode, rawPrompt, error}}`. `POST {"method":"device"}` `202` nob — loSDI' `GET` yInIDqa'. `POST {"method":"apiKey","apiKey":"…"}` `200` nob (Grok neH; Kimi `400` nob). `DELETE` mej; `DELETE ?target=session` loSbogh De'wI' 'el neH qIl. latlh nobwI'pu' `404` nob. pat SeHlaHbe'bogh vaD `verificationUrl`, `userCode`, `rawPrompt`, `error` je `null` 'oH: ngoq 'olbogh vay', EYAS juHDaq De'wI'Daj rarmoH.

Kimi CLI Hal tlha' Kimi 'el, 'ej wej De'wI' naQDaq chovlu'be'.

#### Hoch mIw qaSpa' nIteb chov {#isolation-check-before-every-turn}

nIteb chaH 'e' chovta'DI' EYAS neH Qap Grok CLI Kimi Code CLI je. chov lujbogh mIw nIteb Qagh tlhej mev; nIDqa'lu' not 'ej tamtaHvIS latlh patDaq vIHlu' not.

**Hoch mIw qaSpa' Grok chovlu'**, pat ra' Hutlh: ja'chuq pa'Daq `grok inspect --json` Qap EYAS, EYAS Grok juHDaj lo'taHvIS, 'ej naDev ghItlhpu'bogh SeH teywI'mey laDqa'. Grok QapwI' rap, pa' rap, juH rapvaD 10 tup Qapbogh chov lo'qa'lu'; juHDaq lanlu'bogh Doch (laH, chut, hook) chov chu' poQmoH. Grok lajQo'lu':

- jan ra'mey chaw''eghlaH (Hoch chaw' ngaQ Qapbe');
- EYAS teywI''egh ghobe'bogh DaqDaq chaw' chutmey pagh SeH patlh ghoS — Hoch De'wI'vaD Grok SeH teywI', pagh chaw' chutmey chelbogh Claude Code ghom SeHmey rur;
- EYAS rarwI''egh ghobe'bogh MCP De'wI' taghlaH (EYAS chaw' tetlh chu'Ha'bogh De'wI'mey QaQ);
- hooks, plugins, Hol De'wI'mey je cherlu';
- ra' teywI'mey, laHmey, ghoqwI'pu' je juHDajvo' pagh ja'chuq pa'mey Hurvo' ghoS;
- Claude, Cursor, Codex tlhapmey chu'lu';
- voqlu'bogh Qu' pa' SeH'egh Qap.

**Grok ghItlhwI' SeH teywI'.** grok 1.0.41 ghItlhwI' SeHmey qawHaq, `managed_config.toml`, EYAS Grok juHDajDaq ghItlh; motlh mIvvaD chIm. chImbogh teywI' lajlu'. SeH ngaSbogh teywI', Dung chovmey tlhej mIw lajQo' (*jan chaw' EYAS rarbe'lu'* rur), 'ej teywI'vetlh Hoch choH Qapbogh chov SIbI' Qaw', motlh lo'qa'lu'bogh 10 tup qoDDaq je.

ja'chuq pa'mey qoDDaq Qu' ra' teywI'mey (`AGENTS.md`, `CLAUDE.md`, `.grok/rules`) lajQo'meH meq 'oHbe': pa' voqlu' not, vaj laD'eghbe' Grok, 'ach teywI' janmeyDaj lo'taHvIS laDlaH pat. pa'vetlhDaq Qu' MCP De'wI'mey pagh hooks tetlh Grok 'ach taghlu' not.

**EYAS juHDajvo' Kimi chovlu'**, inspect ra' ghajbe'mo': `data/cli-homes/kimi-cli/.kimi/config.toml`Daq nIteb chaw' chu'Ha'nIS, qach laH pa'mey DuDghach chu'Ha'nIS, hooks pagh 'ej latlh laH pa'mey pagh; `mcp.json` chImnIS; 'ej juH laH pa'meyDaq laH tu'lu'be'nIS. EYAS Kimi juHDaq De'Daj pol Kimi je 'e' poQlu': latlh DaqDaq share pa'Daj 'oSchugh, mIw pat chu'qa' je mevmoH chov (*jan chaw' EYAS rarbe'lu'* rur 'anglu'), vaj juHvetlh Hurvo' ghItlh not pat vIHmoH.

**session taghDI',** jan ra'mey chaw''eghbogh mIwDaq taghbogh session mevmoHlu'.

**mIw QaptaHvIS,** jan'egh tagh pagh rIn Grok pagh Kimi, EYAS wuqbe'taHvIS (teywI' laD ghItlh je, nej, tetlh, shell, Internet, ghoqwI'Hom, jan nej, pagh EYAS ghobe'bogh MCP jan), pagh qawHaq jan'egh ra'chugh, mIw mev EYAS. ghIq session qIl EYAS, nIteb Qagh tlhej mIw rIn, 'ej ghIq CLI jatlhbogh pagh lo'. EYAS janmey'egh (qawHaq, Qu' nav, latlh je — Grok `use_tool` lo'taHvIS `eyas__<pong>` rur SIch) chovvam 'ay' 'oHbe', Hoch ra'vetlh wuq'eghmo' EYAS — bIng *EYAS janmey wuq rap Suq* yIlegh.

**ja'chuq QIn** ja', chovnatlh: *Grok CLI mevmoHlu'pu': mob Qu'vam, 'e' 'ollaHbe' EYAS (EYAS MCP turwI'mey Dabe'bogh, hooks). latlh model nobbe'lu'.* **nobwI' SeHmey yIpoSmoH** rar tlha'. pong laHbogh chovmey: jan chaw' EYAS rarbe'lu'; EYAS MCP turwI'mey Dabe'bogh; hooks; chelmeH jan; ja'chuqvo' Hurbogh ra'mey laHmey joq; CLI qawHaq'e'; latlh QeD janvo' Suqmey; DevwI' Qapmey ghun; voqlu'pu'bogh qach; EYAS chaw' Hutlhbogh jan; noHlu'laHbe'.

**chovqa'meH,** meq yIteq — EYAS Grok pagh Kimi juHDaq latlh MCP De'wI', hook, laH, pagh `AGENTS.md`, pagh Hoch De'wI'vaD Grok SeH rur — 'ej QIn yIngeHqa'. Hoch mIw chovqa'. nobwI' Dachu'qa'DI' pagh EYAS Dataghqa'DI', lIngDI' Grok chov Qap, 'ej nobwI' navDaq **DaH yI'ol** chovmey rap Qap, pat ra' Hutlh (bIng *nobwI' navDaq QapmeH poH Hop je* yIlegh). EYAS juHmey chov `eyas doctor` ([tobta'bogh CLI chovnatlhmey](#proven-cli-versions)).

**nobwI' navDaq QapmeH poH Hop je.** **nobwI'pu'** bIngDaq Claude Code CLI, Grok CLI pagh Kimi Code CLI chovnatlh yIwIv:

- **QapmeH poH** — chay' QapwI' tu' EYAS, chovnatlhDaj, HeDaj je. Halmey: *PATH Daq juH CLI*, *loHwI' choHmoH (env)* (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`) pagh *QapmeH poH ngaSlu'bogh (lIb)* (Claude Code neH). CLI chovnatlh'egh 'oH chovnatlh; pagh ja'bogh CLI *mI' Sovlu'be'* 'ang. latlh tlheghmey: *mI' X — mI' Y pIllu'* (EYAS Agent SDK ngaQlu'bogh chenmoHlu'bogh chovnatlh rurbe' Claude Code QapwI'); *PATH Daq CLI (chovnatlh) lo'be'lu'.* (PATHDaq latlh CLI So' choHmoH); *yI'el Hutlh* (Claude Code neH — **EYASvaD yI'el** chovnatlhDaq 'elchaj 'ang Grok Kimi je); *QapmeH poH lo'laH tu'lu'be' — CLI yIchel pagh choHmoH yIcher*; 'ej Qapbogh teywI' pongbe'bogh choHmoHvaD, *choHmoH (env) cherlu' 'ach ta'laHbogh ghItlh pongbe'; vaj nobwI'vaD pat ta'be' EYAS (PATH lo'Qo'). yIchel pagh yIteq.*
- **Hop** — Dotlh Degh (*'ollu'pu'*, *'ol Qapbe'*, *wej 'ollu'*, *yI'el poQlu'*) 'ej chay' CLI Hop pol EYAS 'ej ghorgh chov ja'bogh wa' mu'tlhegh: Claude Code Hoch mIw taghDI', taghDI' ja'bogh Doch lo'taHvIS (mIw Hutlhbogh chov tu'lu'be'); Grok Hoch mIw retlh `grok inspect` lo'taHvIS, pat ra' Hutlh; Kimi EYAS juHDaj Hoch mIw retlh, 'ej QInvamDaq poH taghlu'DI' 'ej Hoch chov QapDI' neH 'ollu'pu' Kimi. ghIq *Qav 'ol: &lt;poH&gt;* pagh *EYAS taghDI' 'ollu'be'.* — qawHaqDaq pollu' Dotlh, vaj EYAS taghqa'DI' chu'qa'lu' — 'ej **'olmey Qapbe'bogh** tetlh, ja'chuq nIteb Qagh pongmey rap, Hoch De' tlhol tlhej.
- EYAS nob nIteb chov Qapbogh chovnatlh 'ej lIngbogh chovnatlh rapmoHbogh tlhegh: chovnatlhvamDaq Qap (chovnatlh jaj je tlhej); latlh chovnatlhDaq Qav Qap, lIngbogh chovnatlhDaq ghobe'; *juHDaq wej 'ollu'* — CLIvam lo'taHvIS not Qap chov, vaj CLI ngoq Hal neH lo' Hop (DaH Kimi); pagh chovnatlh ja'be' CLI. Hoch mIw chovlu'taH 'e' ja' Hoch tlhegh Dor.
- *Qob ratlh:* Hoch CLIvaD wa' mu'tlhegh. QInvam 'el ghun Claude Code, 'ej API ngoq lo'taHvIS, pat ra' net Hutlhbogh nob chov Qap, vaj claude.ai mI' 'el neH qembogh Doch (mI' laHmey, mI' qawHaq, Hop SeHmey) chovbe'. API ngoq lo'taHvIS Grok 'el nob chov; grok.com 'el lo'DI' xAIDaq poHmey ghun'a' Grok? leghlu'be'. Kimi nejmeH web jan je'egh EYAS tlhobbe' wa'DIch: Qapchugh wa', mIw mevmoH EYAS, 'ach Qappu' 'ej Kimi patDaq ghoSpu'law' ghotlh.
- **DaH yI'ol** (Grok CLI Kimi Code CLI je; pat SeHlaHbogh joH SeHwI' je) — nobwI' chu'lu'DI' 'ej CLI tu'lu'DI' neH 'anglu'. nobwI' laDlu'DI' Qapbogh chovmey Qapqa', pat ra' Hutlh: Grok `grok inspect` chov, Kimi juH laDqa', 'ej ghIq, 'ellu'DI', mu'tlhegh Hutlhbogh poH tagh, pat tetlh chu'qa'moHbogh je. mIwvam lo'taHvIS *wej 'ollu'*vo' *'ollu'pu'*Daq vIHlaH Kimi. **DaH yI'ol** ghajbe' Claude Code: Hoch mIw taghDI' chovlu'. Qaghmey: *DaH 'olmeH, nobwI' chu'lu'nIS 'ej CLI tu'lu'nIS.* pagh *'ol Qapbe': &lt;Qagh&gt;*. 'el pagh mej ret, 'ej nobwI' chu'DI' pagh chu'Ha'DI', 'ay' laDqa'lu'.

poH taHqa' jan lo' je qach Grok/Kimi 'el lo', pagh De'wI' SeH qawHaq je'egh laD CLI, 'e' ja'be'choH Grok Kimi je navmey: EYAS juH'eghDaq Qap Grok Kimi je 'e' taghDI', teHbe'choH. motlh chu'lu' Kimi Code CLI taH; wej qachDaq Hop 'ollu'be' 'e' ja' nav, net.

**API (rarwI'pu').** `GET /api/v1/model/providers/{claude-code|grok-cli|kimi-cli}/isolation` (pat laD chaw'; latlh nobwI' `404`, session Hutlh `401`) nob `{providerId, status: verified|violation|unverified|auth-required, checks[{check, detail}], checkedAt, runtime, hostCli{path, version}|null, signedIn: true|false|null, proof{version, verifiedAt, paidCanary, drift: match|drift|never-verified|unknown-version|null}, canVerify}`; `runtime` `{available: true, path, version, source: override|host|sdk-bundled, expectedVersion, skew}` pagh `{available: false, error: override-invalid|not-found|no-policy}` 'oH. `POST …/isolation/verify` pat SeH chaw' poQ (pagh `403`), chovmey Qap 'ej De' rap nob; Claude Code, pagh chu'lu'be'bogh pagh tu'lu'be'bogh nobwI', `409 {code: 'verifyUnavailable'}` nob.

**chaw'mey.** CLI chaw' tlhobvaD *allow once* neH jang EYAS. *always allow* pagh session naQ SeH neH nobchugh CLI, *cancelled* jang EYAS. lajQo' *reject once* 'oH.

**EYAS janmey wuq rap Suq.** jan rarwI' lo'taHvIS Grok Kimi je SIchbogh EYAS janmey'egh (qawHaq, Qu' nav, ghItlhmey, QIn Daq, browser, Odoo, latlh je) API nobwI'pu' Claude Code je rurqu' wuqlu':

- ja'chuq DaQoyDI', pagh He ja'chuqDaq, Hub lojmIt chaw'bogh ra' Qap. chaw' poQ per ghajbogh jan chaw' loS tetlhDaq loSbe'choH Grok pagh Kimi 'oHmo' pat neH, 'ej Qoylu'bogh ja'chuqmeyDaq nIteb vang patlhmey chu'lu'be'. lojmIt vIHmoHbogh ra' ja'chuqDaq chaw' chaw' 'ang 'ej chaw' loS tetlhDaq Doch chel; ja'chuq mevmoHlu'be'.
- 'em Qapmey (poH ngaQlu'bogh, ghom, pipeline, pagh Qoylu' per ghajbe'bogh Hoch Qap) nIteb vang patlh chu'lu': **ghuH** pagh **chaw'** Seghbogh ra' chaw' loS, 'ej lojmIt vIHmoHbogh ra' reH ghot loS, Seghvetlh **auto**Daq tu'lu'DI' je (ngo', ra'vetlh Grok KimiDaq tlhoblu'be'taHvIS Qap). CLI mIw rInDI' bejlu'bogh Qap **chaw' loS** rur mev, 'ej chaw'lu'DI' ra'vetlh neH wa'logh Qap.
- Qap wa'DIch ta'pu'bogh EYAS jan ra' nIDqa'bogh taHqa'lu'bogh pagh nIDqa'lu'bogh Qap (QIn Daq pagh DIlmeH nav rap rur) Qappa' lajQo'lu'; jan tlhegh **juSlu'** 'ang, *already executed on the original run — duplicate side effect prevented* tlhej. latlh ngoQmey ghajbogh jan rap Qap taH.
- ghoqwI' **janmey** tetlh Hurbogh jan Hub lojmIt tlhoblu'pa' **lajQo'lu'** rur lajQo'lu', vaj chaw' loS Doch chenmoH not. QaptaHbogh Hub lojmIt Hutlhchugh, Hoch rarwI' EYAS jan ra' lajQo'lu'.

lIngbogh Grok CLIDaq tob nob chov. KimiDaq wuqmey rap Qap je, EYASDaq wuqlu'mo'; ra'meyvam chay' ja' Kimi QapwI' net stream'eghDaq (taHqa' cha'logh chov chenmoHmeH lo'lu'), wej qachDaq chovlu'be'. [MCP — chay' rarwI' Hublu'](/docs/tlh/ai/mcp/#how-the-bridge-is-secured) yIlegh.

**lajQo'lu'bogh ra' Grok jang rInmoH.** Grok jan ra' lajQo'DI' EYAS — EYAS Hur qawHaq laD rur — jangvetlh rInmoH Grok (grok 1.0.41Daq chovlu'). lajQo'lu'bogh jan tlhegh 'ang ja'chuq, ghIq pagh, 'ej EYAS meq legh Grok pat not; vaj mIwvetlh Hutlh yItlhobqa'. latlh mIw: taH Claude Code 'ej meq Suq.

**teywI' SIch.** EYAS lo'taHvIS Grok pagh Kimi laDbogh ghItlhbogh teywI'mey ja'chuq pa'meyDaq ngaQlu' (lughtaHbogh pa'mey, vum pa' je), symlinkmey tlhaDlu' — rarlu'bogh pa' bIngDaq teywI' chu'vaD je. `..` Haw'meH, pegh teywI'mey, 'ej pa' tu'lu'be'DI' Hoch teywI' lajQo'lu'. ghIq qawHaq chut Qap (latlh jan qawHaq, Obsidian vaultmey, EYAS De' pa''egh, latlh ja'chuq vum pa'mey je lajQo'lu'). Hoch teywI' Qu' wa'logh noHlu': jan ra' chaw' tlhob lo'taHvIS chaw'lu'pu'bogh laD pagh ghItlh tlhobqa'be'lu'. laD 'ay' (tagh tlhegh tlhegh mI' je) lajlu'.

**'em Qu'.** EYAS 'em ra'mey (pongmey, Hub noHwI', latlh je) Grok Kimi je lo' nIteb chovta'DI' neH: Grok lIngDI' chov, **DaH yI'ol**, pagh Hoch mIw session tagh QapDI'; Kimi De'wI'vamDaq session taghta'DI' neH (**DaH yI'ol** 'ellu'taHvIS wa' tagh). ra'vetlh EYAS janmey Suqbe', Hoch chaw' teywI' tlhob je lajQo'lu', 'ej wa'DIch jan ra'Daj rInmoH. EYAS tlhobbogh mej 'aqroS ngaQmoHlu' jangDaj ([Claude Code patmey vum je](#claude-code-models-and-effort) yIlegh).

#### Grok Kimi je nuq Suq {#what-grok-and-kimi-receive}

- **EYAS pat mu'tlhegh, chovlu'.** Hoch QIn Dung EYAS pat mu'tlhegh Suq Kimi, EYAS pat ra'mey per tlhej. Grok motlh pat mu'tlheghDaj EYAS mu'tlheghvaD tamlaH Grok, 'ach pat tlhoblu'DI' neH 'Iv mu'tlhegh lo'pu' qon, vaj Hoch mIw retlh chov EYAS — Grok juHDajDaq, mIwvetlh session teywI'mey teqlu'pa'. EYAS taghDI' wa'DIch mIwmeyDaq, pagh `grok` ghun choHlu'DI', mu'tlhegh cha' mIw ngeHlu' (Grok pat mu'tlhegh rur 'ej QIn Dung), vaj chovlu'be'bogh HeDaq jang not. chov QapDI', Grok pat mu'tlhegh rur neH ngeH veb mIwmey, 'ej Hoch mIw chovqa'. EYAS mu'tlhegh Hutlh jangchugh pat, ghuHmoHwI' log EYAS 'ej ghIq QIn Dung mu'tlhegh ngeH (taghqa' pagh `grok` ghun chu' ret). SeH poQbe'lu'.
- **qun naQ, mIllogh je.** Hoch mIw EYAS ja'chuq qun ngeHqa', ngo' mIwmey mIllogh Daqchajvo'. lIngbogh CLI mIllogh 'el laj 'e' ja'chugh Hoch Qap taghDI' neH mIllogh ngeHlu'. lajbe'chugh, Hoch mIllogh patvaD QIn machvaD tamlu', *[image omitted (image/png): this model cannot see images]* rur, vaj mIllogh tu'lu'pu' 'e' Sov pat; ngeHpa' ghuHmoH ghItlhwI' 'ej QIj 'ang mIw ([mIllogh 'ej leghlaHbe'bogh patmey](#images-and-models-that-cannot-see-them)). qun naQ, mIllogh je, Hoch mIw ngeHqa'meH mu'tlhegh tokens DIl, API nobwI'pu' rur.
- **legh Degh CLI tlha'.** Grok CLI Kimi Code CLI patmey **legh** Degh Hoch mIw CLI ja'bogh tlha'. Grok CLI 1.0.40 mIllogh 'el ja'be', vaj legh chu'Ha' 'ang Grok CLI patmey. Kimi patmey motlhchaj pol wa'DIch mIw ja'pa'. taghqa'DI', wa'DIch mIw qaSpa' **patmey yIchu'qa'** motlh 'anglaH; veb mIw lugh.

#### Grok patmey vum je {#grok-models-and-effort}

Grok CLI'eghvo' Grok patmey, 'ej Hoch lajbogh meq vum patlhmey, laD EYAS: EYAS Grok juHDaq session poSmoH mu'tlhegh ngeHbe'taHvIS, vaj pat ra' pagh 'ej Huch pagh. chovnatlh: grok-4.6 grok-4.7 je low, medium, high, xhigh nob; grok-4.5 low, medium, high nob; meq SeH ghajbe'bogh pat pagh nob. nobwI' lIngDI' Hoch (EYAS tagh, nobwI' chu'qa') 'ej **patmey yIchu'qa'** Dachu'DI' qaS, 'ej EYASvaD Grok 'ellu'be'taHvIS buSHa'lu'. CLI nobbe'choHbogh pat perlu' 'ej chu'Ha'lu', teqlu' not, 'ej Grok patvaD vum wIvmey lajbogh naQ rap.

Hoch mIw, QIn ngeHpa' Grok sessionDaq wIvlu'bogh vum cher EYAS, 'ej Grok lo'bogh patlh laDqa'. lajbe'lu'bogh patlh wa'DIch pat lajbogh patlh Sumqu'Daq vIHlu' (grok-4.5Daq *max* — *high* rur Qap). patlh lajQo' Grok taHchugh, Grok patlh'eghDaq Qap mIw, 'ej qonlu'. **auto** pagh ngeH: motlh'eghDaq Qap pat (DaH Grok patmeyvaD high), 'ej 'Iv patlh 'oH qon mIw. vumwI' `~/.grok` SeH'egh, motlh vumDaj je, pagh wuq. Hoch Grok mIw Grok Qapbogh pat naQ qon je, Grok ja'bogh rur.

#### Kimi patmey Qub je {#kimi-models-and-thinking}

`--model` `--thinking` je buSHa' `kimi acp`, vaj Hoch mIw Kimi session poSmoH EYAS, nIteb 'e' chov, 'ej ghIq wIvlu'bogh pat Qub mI' je vIHmoH, mu'tlhegh ngeHpa'.

- **nuqvo' patmey ghoS.** Kimi pat tetlh'egh — SeHDaj'egh patmey, Kimi Code 'el ret `kimi-code/kimi-for-coding` rur. mu'tlhegh Hutlh pat ra' Hutlh laD EYAS, Kimi juH'eghDaq wa' session poSmoHtaHvIS: nobwI' laDDI' Hoch 'emDaq (EYASvaD Kimi 'ellu'taHvIS neH) 'ej **patmey yIchu'qa'** Da'uyDI'. tlheghmey *Kimi Code CLI (&lt;pat pong&gt;)* ponglu'. **Kimi Code CLI** motlh tlhegh DaH Kimi cherlu'bogh pat Qap.
- **Hoch patvaD Qub, Kimi tetlhbogh rur.** motlh Qub mI' je ghajbogh pat **Qap / QapHa'** vum wIv Suq (*pagh* = Qub chu'Ha', *jen* = Qub chu'). reH Qubbogh pat jen neH nob (*pagh* jen moj). Qub ghajbe'bogh pat vum SeH nobbe'. DaH Kimi Qapbogh Qub pol auto, pat choHDI' je. Hoch mIw ret, 'Iv pat mI' je Qap laDqa' EYAS 'ej lo'lu'bogh pat vum je rur qon.
- **Qav wIv qaw Kimi.** pat vIHmoHDI' EYAS, SeH teywI''eghDaq pol Kimi (EYAS Kimi juH qoDDaq, `~/.kimi` not) 'ej ghIq motlh rur lo'. vaj **Kimi Code CLI** motlh tlhegh Hoch ja'chuqDaq Qav EYAS wIvbogh pat Qap. wIv ratlhbogh DaneHchugh, Kimi pat wa' yIwIv.
- **tetlh laDlu'pa'** ('ellu'be' wej, pagh laD luj), ja' nobwI' nav: *Kimi patmey tetlh laDbe'pu' EYAS; vaj patlh wIvlaHbe' 'ej meq chu'laHbe' chu'Ha'laHbe' je: patlh SeHlu'bogh Kimi qaw Kimi. EYAS-vaD Kimi yI'el, vaj «patmey yIchu'qa'» yI'uy.* Dotlhvam, pat Qub je wIv ngeHbe' EYAS.
- **Kimi nobbe'bogh pat** mu'tlhegh qaSpa' mIw mevmoH, patvetlh nobbe' Kimi ja'bogh Qagh tlhej. latlh pat lo'taHvIS So' tamlu' not.
- **teqlu'bogh tlheghmey.** ngaQlu'bogh tlheghmey *Kimi Code CLI (K3)*, *(K2.7 Code)*, *(K2.6)* je Moonshot API patmey pong, Kimi CLI patmey ghobe', 'ej reH Kimi motlh Qap. wa'DIch chu'qa' pagh tu' ret *Qav chu'qa'meH, pat nob Hutlh* per Suq 'ej chu'Ha'lu' (teqlu' not). chaHDaq EYAS'egh cherpu'bogh He patlhmey, patlh Fallbackmey, Kimi nobwI' motlh je taghDI' nIteb **Kimi Code CLI** (motlh tlhegh)Daq vIHlu' — reH Qappu'bogh'e'. chaHDaq DangaQpu'bogh ja'chuq pagh ghoqwI' *does not offer it* Qagh tlhej mev; tu'lu'bogh Kimi pat wa' yIwIv. Kimi neH lIng chu' Hoch He patlh **Kimi Code CLI**Daq tagh, Fallback Hutlh; ghoqwI' ghojmoHwI' Opus/Sonnet/Haiku patlhmey KimivaD 'oH 'oS je, 'ej Huch machmoHDaq Kimi Code CLI mIw pagh.
- **Huch pIHmey.** tu'lu'bogh Kimi Code CLI patmey *Kimi Code CLI* motlh DIl lo' ($0.95 'el / $4 mej wa' SaDSaD tokensvaD).

kimi-cli 1.52.0 ngoqvo' chenlu'; wej Kimi lIng net Daq chovlu'be'.

### kernel teywI' Hung {#kernel-file-sandbox}

janmeyDaj'**egh** Qap Claude Code pagh Grok CLI — Claude Code shell ra'mey; Grok shell, grep, teywI' tetlh, ghoqwI'Hom laDmey — OS'egh janmeyvam bot, vaj laD ghItlh je laHbe':

- latlh AI jan qawHaq (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, OpenCode De'), EYAS Sovbogh Obsidian vaultmey, `security.foreignMemoryPaths` Hemey je;
- EYAS De' pegh'egh: vault, De' pa', ngoqmey, latlh CLImey EYAS juHmey;
- latlh ja'chuqmey vum pa'mey.

ja'chuq pa'mey'egh ghItlhlaH taH. **macOS Seatbelt** (ngaSlu') pagh **Linux bubblewrap** 'oH Hung. leghbogh Hoch jan ra' chov EYAS taH; ra' ghItlhvo' EYAS laDlaHbe'bogh mIw lo'taHvIS shell ra' SIchbogh bot je Hung.

| CLI | HungDaq nuq Qap |
|-----|-----------------|
| **Claude Code** | janmey ghajbogh Hoch mIw HungDaq shell ra'meyDaj Qap. LinuxDaq bubblewrap (`bwrap`) **'ej** `socat` poQ. Claude Code shell Dotlh'egh (`~/.claude/shell-snapshots`, `~/.claude/session-env`) 'ej ghun pa'Daj laDlaH taH; `~/.claude` latlh botlu'. |
| **Grok CLI** | janmey ghajbogh Hoch mIw EYAS Hung profile bIngDaq Grok tagh, EYAS ghajbogh juHDaj `sandbox.toml`Daq ghItlhlu'bogh (pong `eyas-<hash>`). ngabmoHlaHbe' Grok. LinuxDaq bubblewrap poQ. |
| **Kimi Code CLI** | kernel Hung ghajbe' (*QaHbe'*). |

janmey Hutlhbogh 'em ra'mey (pongmey, qawHaq mIwmey, Hub noHwI') Hung poQbe' 'ej Hung Hutlhmo' lajQo'lu' not.

**`security.cliSandbox`** (`config/local.yaml`):

- **`auto`** (motlh) tu'lu'DI' Hung lo'. tu'lu'be'DI', janmeyDaj Qap CLI taH, 'ej Hoch ja'chuqvaD wa'logh QIj 'ang ja'chuq: *QInvamDaq kernel teywI' Hung Hutlh janDaj lo' &lt;CLI&gt;. jan ra' Hoch legh EYAS 'ej nuD; meq cha' nobwI' SeHmey.* `auto`Daq, Hung Hurvo' wa' ra' Qap 'e' tlhoblaH Claude Code (`~/.npm` poQbogh ra' rur). ra'vetlh **reH ghot chaw' loS** [chaw' loS](/docs/tlh/agents/autonomy/) tetlhDaq — AI noHwI' not, nIteb vang patlh not — naDev *kernel teywI' Hung Hur Qap 'e' tlhob shell ra'…* ja'lu'. chaw'lu'chugh wa'logh ra'vetlh neH Qap; nIteb Qapmey mevchoH.
- **`required`** Hung tu'lu'be'DI' CLI taghpa' janmey ghajbogh CLI mIw lajQo': *&lt;CLI&gt; taghlu'be': CLI jan'e'vaD kernel teywI' Hung poQ SeHlIj (security.cliSandbox: required), QInvamDaq tu'lu'be'. latlh model nobbe'lu'; meq cha' nobwI' SeHmey.* mIw nIDqa'lu'be' 'ej latlh patDaq vIHlu'be', 'ej reH lajQo'lu' janmey ghajbogh Kimi mIwmey. `required` tlhej, Hung Hurvo' ra' Qap not Claude Code (tlhobDaj buSHa'lu'), 'ej HungDaj taghlaHbe'chugh tagh 'e' lajQo'.
- `off` tu'lu'be'. latlh mI' SeH Qagh 'oH: tagh EYAS 'e' lajQo', 'ej `security.cliSandbox` pong Qagh QIn.

**nuqDaq Dalegh.** CLI nobwI' nav **kernel teywI' Hung** tlhegh ghaj: *Qap*, *QInvamDaq tu'lu'be'* meq tlhej (bubblewrap chellu'be'; socat chellu'be'; naDev Hung chenmoHlaHbe' bubblewrap, motlh user namespace chu'Ha'lu'mo'; OS QaHbe'lu'), pagh *QaHbe'* (Kimi). `required` QIj 'ang je, 'ej `auto`Daq Claude CodevaD *Hung Hur Qap 'e' tlhobchugh ra', reH chaw'lIj loS.* `eyas doctor` **CLI sandbox** tlhegh ghaj ([CLI](/docs/tlh/deploy/cli/#what-doctor-checks)), 'ej Hoch chu'lu'bogh CLI Dotlh 'ang **Hub wanI'mey** ([Hub 'ej pegh](/docs/tlh/admin/security-privacy/#memory-outside-eyas-card)). `claude-code`, `grok-cli`, `kimi-cli` jevaD `fileSandbox {status: active|unavailable|unsupported, reason, mode}` ngaS `GET /api/v1/model/providers` 'ej `GET /api/v1/model/providers/:id`.

**Docker Kubernetes je.** bubblewrap ngaSbe' EYAS ghItlh **not** (LGPL 'oH, vaj lIngmeH SeHwI' wIv). kernel 'ay'vaD bubblewrap (Claude CodevaD `socat` je) 'ej De'wI' SeHbe'bogh lo'wI' namespacemey poQ Linux juH pagh ngaSwI'. Hutlhchugh, leghbogh Hoch tlhob lajQo' EYAS taH 'ej *tu'lu'be'* 'ang; `required` tlhej, janmey ghajbogh CLI mIwmey lajQo'lu'. [Docker](/docs/tlh/deploy/docker/), [Kubernetes](/docs/tlh/deploy/kubernetes/).

**veHmey.** LinuxDaq, session taghDI' tu'lu'bogh teywI'mey ngaS Grok lajQo' tetlh. `.obsidian` pa'Daj neH Sovlu'bogh vault chellu', qoDDaq He tu'DI' EYAS (tetlhlu'bogh vault pagh `security.foreignMemoryPaths` Doch reH toghlu'). kernel 'ay' ghajbe' Kimi.

### tobta'bogh CLI chovnatlhmey {#proven-cli-versions}

EYAS chu'choHpa', EYAS lajbogh Hoch CLI chovnatlh chovlu': Claude Code Grok CLI je net (lIngDI' Kimi Code CLI je) nobwI'pu'Daj'egh lo'taHvIS Qap EYAS, mIS juH mIghmey tlhej (Hoch chaw'bogh juH SeHmey, ghe'naQ mej ta'bogh hooks MCP De'wI'mey je, `CLAUDE.md`, `AGENTS.md`, laHmey, Obsidian rurbogh vault), 'ej tob: chaHvo' pagh laDlu'; EYAS qawHaq chut kernel Hung je vault EYAS De' pa' je Haw'moH; EYAS Hur qawHaq lajQo'lu'bogh laD lajQo'lu' taH. De' naQ: [Hub 'ej pegh — chay' nIteb toblu'](/docs/tlh/admin/security-privacy/#how-isolation-is-proven).

| CLI | Qav tobta'bogh chovnatlh |
|-----|--------------------------|
| Claude Code | 2.1.281 |
| Grok CLI | 1.0.41 |
| Kimi Code CLI | wej toblu'be' |

**`eyas doctor` lo'taHvIS lIngmey yIchov.** Hoch CLIvaD wa' **CLI isolation** tlhegh ghaj — *CLI isolation (Claude Code)*, *CLI isolation (Grok CLI)*, *CLI isolation (Kimi Code CLI)*. Hoch EYAS Qapbogh QapwI' 'ang: chay' tu'lu' (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, *claude/grok/kimi on PATH*, pagh *SDK-bundled*), HeDaj, chovnatlhDaj je, 'ej ghIq:

- *isolation proven on this version (&lt;jaj&gt;)* — QaQ;
- chovnatlh Qav tobta'bogh rurbe'DI', chovnatlh ja'be'DI' QapwI', pagh CLI toblu'pu'be'DI' (DaH Kimi), ghuHmoH. EYAS Hoch session taghDI' chov taH 'e' chel ghuHmoHwI': lIngbogh chovnatlh 'Iv 'ach, Qap naDev chovmey;
- *not installed* — QaQ. lughbe'bogh `EYAS_*_BIN` luj 'oH, tI'meH mIw tlhej.

Grok KimivaD, EYAS juHchaj chov tlhegh je, `<data dir>/cli-homes/<nobwI'>`:

- wej chenmoHlu'be' — QaQ, wa'DIch Qap chenmoH;
- symlink pagh pa' 'oHbe' — luj: CLI Qap 'e' lajQo' EYAS; yIteq, veb Qap chenmoHqa';
- latlh lo'wI'pu' laDlaH — ghuHmoH, CLI 'el ngaSmo'; tI'meH: `chmod 700 <pa'>`;
- naDev EYAS SeHbogh teywI' (Grok `config.toml`, `requirements.toml`, `trusted_folders.toml`; Kimi `mcp.json` 'ej `config.toml`Daq EYAS ngoqmey) ghItlhpu'DI' EYAS choHlu'pu' — ghuHmoH. veb Qappa' teywI'meyvam ghItlhqa' EYAS, vaj cha' Qap joj choH — pa'vetlh choH latlh Doch 'e' QIj.

laD neH doctor: `--version` neH Qap. [CLI — doctor nuq bej](/docs/tlh/deploy/cli/#what-doctor-checks).

### Hoch nobwI'Daq ja'chuq rap {#same-chat-on-every-provider}

'Iv nobwI' jang 'ach ja'chuq rap 'ang.

- **ghItlh yIn.** jangDaj QubDaj je ghItlh yIn Claude Code, pat ghItlhtaHvIS, API nobwI'pu' rur.
- **Hoch jan ra'vaD wa' tlhegh, pong motlh.** Hoch nobwI'Daq EYAS lo'bogh pongmey lo' jan tlheghmey — `read_file`, `run_command`, `edit_file`, `write_file`, `grep`, `glob`, `web_fetch`, `web_search` — vaj Hoch DaqDaq diff rur 'ang teywI' choHmey ghItlhmey je. EYAS janmey'egh pongchaj nap lo' (`memory_search`, `mcp__eyas__memory_search` ghobe'). Grok KimiDaq CLI ghItlh tlhab pong 'angbe' tlhegh.
- **'el, mej, poH je.** jan tlhoblu'bogh (teywI', ra', nej, choH He ngo' chu' ghItlh je), nobbogh — tIqqu'bogh mej 64 KiBDaq pe'lu' 'ej perlu' — 'ej poH 'ar natlh 'ang tlhegh.
- **jan rInDI' neH tlhegh rIn.** rInpa' rInta' rur perlu' not: lujbogh ra', pagh jan ra' Huchmo' chIllu'bogh ra', luj rur 'ang, Qagh tlhej.
- **lajQo'lu'bogh ra'mey Qapta' rur 'anglu'be'.** EYAS lajQo'bogh ra' — Hub lojmIt, qawHaq chut, chaw' loS, pagh taHqa'bogh Qu' Qappu'bogh ta' cha'logh — Dotlh'egh 'ang (*lajQo'lu'*, *chaw' poQ*, *juSlu'*), EYAS meq tlhej, SuD per not. jan ra' 'aqroS SIchpu'DI' CLI tlhobbogh ra'mey chIllu' rur qonlu'. chaw' poQbogh ra' ja'chuqDaq chaw' 'emwI' 'ang 'ej [chaw' loS](/docs/tlh/agents/autonomy/) tetlhDaq Doch chel. [ja'chuqmey — jan tetlh](/docs/tlh/daily/conversations/#tool-trace).
- **mIw 'aqroS jang pol.** mIw 'aqroSDaq SIchDI' mIw, DaH ghItlhlu'bogh jang pollu' 'ej jang rur qonlu'; *mIw veH paQlu'pu'* rur rIn mIw, Qagh rur ghobe'. Qagh naQ Qagh rur 'ang taH, 'ej jang 'ay' pollu' je.
- **Hoch mIwvaD wa' rIn.** Hoch nobwI'Daq wa'logh neH pollu' 'ej 'anglu' jang.
- **QaptaH Sor rap.** Hoch nobwI'vaD, API CLI je, ja'chuq QaptaH Sor / Qu' mIw nav 'ang, DaH janDaj yIn, mIw mI' (CLIvaD, qoD mIwmeyDaj), tokens, Qap Huch je tlhej. [ja'chuqmey — QaptaH Sor](/docs/tlh/daily/conversations/#run-tree--workflow).
- **De' mach qawHaq ghItlhbe'.** mIw tIqDaq De''egh machmoHchugh CLI, *context compacted* QIj 'ang mIw 'ej EYAS qawHaqDaq pagh ghItlhlu'. EYAS qawHaq je' EYAS neH.
- **Qagh QIn CLI lugh pong.** Kimi lujDI' *Kimi Code CLI* ja', *Grok CLI* ghobe' not.

**qatlh mIw rIn.** Hoch API nobwI' meq rap qon: rIn, jan lo', ngeH 'aqroS SIch, mev mu', pagh lajQo'. *lajQo'* ngaS: Anthropic lajQo', OpenAI content filter 'ej pat lajQo' QIn, Gemini Hub mevmey (safety, prohibited content, blocklist, recitation, personal data, image safety), 'ej Gemini botbogh mu'tlhegh naQ. OpenAI lajQo' QIn QaHwI' jang rur 'ang, jang chIm ghobe'. ngeH token 'aqroSmo' pe'lu'bogh jang *max tokens* rur qonlu', 'ej ghu'vetlhmo' pe'lu'bogh jan ra' Qap not. jang bIngDaq Degh rur rInmeyvam 'ang ja'chuq — [ja'chuqmey — mIw rIn](/docs/tlh/daily/conversations/#turn-outcome).

**token mI'mey** Hoch nobwI'Daq rap, CLImey je: input tokens — nobwI' qawHaqvo' **ngeHlu'be'bogh** mu'tlhegh tokens; qawHaq laDmey (Anthropic qawHaq ghItlhmey je) pIm toghlu'; meq pagh Qub tokens output tokens 'ay' 'oH. nobwI' lo' ja'be'bogh mIw *lo' ja'be'lu'* per ghaj 'ej DIl 'angbe'; tlha'Daj token mI' ngeb lo'taHvIS DIllu' not. CLI mIwDaj'eghDaq Qappu'bogh janmey togh AI bej je — Claude Code, Grok CLI, Kimi Code CLI mIwmey 0 jan ra' 'angbe' DaH. [AI bej — Usage](/docs/tlh/admin/observability/#usage-tab).

### jan ra' {#tool-calling}

API 'ej juH nobwI'Daq jan mIw Qap EYAS 'egh: jan tlhob pat, Qap EYAS, jang ngeHqa', jangDaj taH pat. Hoch ra' ja'chuqDaq wa' yIn tlhegh 'ang.

| nobwI' | nuq yIpIH |
|--------|-----------|
| Anthropic, Anthropic rap Daqmey (MiniMax, Synthetic, Xiaomi MiMo, …) | EYAS janmey Qap, qawHaq janmey je. meq chu'DI' — Hoch vum patlh, pagh reH chu'bogh pat — pat qIlbogh meqDaj (So'lu'bogh meq je) wa' jang veb tlhobDaq choHbe'lu'taHvIS ngeHqa'lu', vaj meq ghajbogh jan mIwmey Qap reH. stream jangvaD qawHaq input tokens ja' Anthropic rap nobwI'pu' je. |
| OpenAI | EYAS janmey Qap, qawHaq janmey je |
| **Gemini** | EYAS janmey Qap, qawHaq nej je. Gemini meq QIjwI' Hoch jan ra' tlhej ngeHqa'lu', vaj Gemini patmey chu' jan mIwDaq meqchaj pol. Qagh ja'bogh jan Qagh rur GeminivaD ngeHlu'. ja'chuqDaq meq rur 'ang Gemini Qub Dovmey, jang ghItlhDaq pagh pollu'bogh jangDaq ghobe' not. |
| OpenAI rap Daqmey, Kimi API, OpenRouter | EYAS janmey Qap. motlh *stop* ja'bogh 'ej janmey tlhobbogh 'em mIw pItlhmoHbe' — tlhoblu'bogh janmey Qap. 'em 'opmeyvam nobbogh meq ghItlh (DeepSeek reasoner rur) Qub rur 'anglu', jangDaq DuD not. rap jang jan ra' mIwmeyDaq meqchaj'egh Suqqa' Kimi API OpenRouter je, poQmo'. |
| **LM Studio** | Dung nobwI'pu' rap OpenAI rar lo', vaj jan ra'mey jangmeychaj je (qawHaq nej je) motlh function calling Hevo' pat SIch. |
| Ollama | EYAS janmey Qap. Hoch jan jang jan pong ghaj, vaj law' ra'DI' 'Iv jang 'Iv ra'vaD 'oH Sov pat. Qubbogh pat meq Qub rur yIn, jang pIm. |
| Claude Code CLI, Grok CLI, Kimi Code CLI | mIw Qap CLI; MCP Hevo' EYAS janmey SIch — [MCP](/docs/tlh/ai/mcp/#cli-mcp-tool-parity-grok--kimi) |

**nobwI'Daj pol meq.** jan mIw qoDDaq ngeHqa'lu'bogh meq (Anthropic qorDu', Kimi API, OpenRouter) wa' jang qoDDaq neH Qap: ja'chuq tlhej pollu'be' 'ej veb mIwmeyDaq ngeHlu'be'. latlh nobwI'Daq vIHchugh mIw, nobwI'vetlhvaD meq chIllu' 'ej meq Hutlh jang taH. mevpu'bogh pagh lujpu'bogh 'em Qap Qav checkpointvo' taHqa'lu'DI', wa'logh meqDaj taghqa' pat. latlh nobwI' pagh patDaq meq ngeHlu' not, ghItlh rur je; motlh OpenAI rar meq ngeHqa' not.

**Hoch ra'vaD wa' tlhegh.** OpenAI rap 'em 'op — motlh juH De'wI'mey — ra' ID Hutlh jan ra' ngeH. ra'vetlh wa' jan tlhegh neH 'ang. OpenAI, OpenAI rap nobwI'pu', Kimi API, OpenRouter, LM StudioDaq Qap.

**jan Hutlh patmey.** pat tetlhDaq janmey lajbe'bogh pat — jan laH ja'be'bogh Ollama De'wI' ghajbogh Ollama pat rur, pagh jan laH Dachu'Ha'pu'bogh pat rur — mu'tlheghDaq janmey pagh, jan tetlh pagh Suq. jan tlhobchugh, Qapbe' EYAS 'ej pat ghItlhDaq mIw rIn. jan ra' 'e' ra'be'choH mu'tlheghDaj je: EYAS qawqa'bogh `<eyas-memory>` 'ay'Daq ghoS 'ej latlh nejlaHbe' 'e' ja' qawHaq ngaQ chutmey, 'ej jan ra'mey lo'taHvIS neH Qapbogh laH tetlh ghoqwI' tetlh je Suqbe'. [mu'tlheghmey — pIn mu'tlheghDaq qawHaq mab](/docs/tlh/ai/prompts/#the-memory-contract-in-the-master-prompt) yIlegh.

### mIllogh 'ej leghlaHbe'bogh patmey {#images-and-models-that-cannot-see-them}

pat tetlhvo' ghoS 'Iv patmey mIllogh leghlaH: pat tetlhDaq **legh** Degh. Grok CLI Kimi Code CLI jevaD, lIngbogh CLI ja'bogh tlha' Degh.

- ja'chuq pat mIllogh leghlaHbe'chugh, Hoch chellu'bogh mIllogh DaqDaq QIj mach rur patDaq ghoS (*[image omitted (image/png): this model cannot see images]*). mIllogh tu'lu'pu' Sov pat, 'ach nuq 'ang Sovbe'. mIw lajQo'lu'be'.
- mIwvetlh bIngDaq QIj 'ang: *model'e' cha'be'lu'pu' mIllogh (N): mIllogh leghlaHbe' &lt;pat&gt;…* jang tlhej pollu', vaj 'uchqa'DI' je taH. ngo' mIwmeyvo' mIllogh ngaS mI', vaj patvetlhDaq, mIllogh ngaStaHvIS ja'chuq, Hoch mIw QIj 'ang.
- ngeHpa' ghuHmoH ghItlhwI': mIllogh chellu'DI' 'ej mIllogh leghlaHbe'DI' pat, 'el Dung Degh ja': *mIllogh leghlaHbe' &lt;pat&gt;: mIllogh tlhejlu'bogh neH Sov.* God ModeDaq 'angbe' Degh; autom He ja'chuqvaD ja'chuqvaD 'anglu'bogh pat (motlh patlh) lo'.
- patvaD pat tetlh De' ghajbe'chugh EYAS, rur ngeHlu' mIllogh 'ej wuq nobwI'. mIllogh laDmoHmeH, **legh** Degh ghajbogh patDaq yIvIH.
- ja'chuq ngo' mIwmeyvo' mIllogh legh **Claude Code**, Qav QInDaq neH ghobe': Hoch mIw ngo' mIllogh Hoch ngeHqa', API nobwI'pu' rur, vaj mIllogh law' ghajbogh ja'chuqmey mu'tlhegh tIn law' ngeH.

### mu'tlhegh qawHaq (Anthropic API) {#prompt-caching-anthropic-api}

Anthropic API nobwI'Daq (API ngoq naQ), nIteb Qap mu'tlhegh qawHaq — SeH pagh.

- **pat mu'tlhegh.** mIw mIw choHbe' EYAS pat mu'tlhegh, DaH QInlIjDaq poH qawqa'lu'bogh qawHaq je ghoSmo'. vaj qawHaqmeH pat mu'tlhegh (qaSpa'Daj jan Delmey tlhej) per EYAS, 'ej Anthropic qawHaqvo' laDqa' Hoch veb mIw jan mIw je.
- **ngo' ja'chuq.** DaH QInlIjDaq SIchbogh ja'chuq perlu' je, vaj Huch naQ DIlqa'be'taHvIS laDqa' veb mIw.
- **jan mIwmey.** jan lo'bogh mIwDaq, Hoch jan mIw ngo' tlhob laDqa'.
- **yIn 'ej Huch.** 5 tup yIn qawHaq 'ej lo'bogh Hoch tlhob chu'qa'; tam tIq ret wa'DIch tlhob ghItlhqa'. qawHaq ghItlh Huch: motlh 'el DIl 1.25×; laD Huch: tlhoS 0.1× (pagh pat qawHaq laD DIl'egh ja'lu'bogh, pat chu' 'op mach). pat qawHaqlaHbogh tIn machqu' (512 – 4096 tokens, pat rur) mach mu'tlheghmey qawHaqlu'be' neH.
- **nuqDaq Dalegh.** Anthropic API ra'meyvaD qawHaq laD ghItlh je tokens 'ang token lo' Huchmey je.
- latlh ghot Anthropic rap Daqmey qawHaq Doch Suqbe', Daqvetlh lajQo'laHmo'. qawHaqDaj'egh SeH Claude Code.

### juH QapwI'mey {#local-runtimes}

**LM Studio**

- ja'chuq pagh ghoqwI' temperature, ngeH token 'aqroS, mev mu'mey rap ngeHlu'. pagh cherlu'chugh, LM Studio pat motlh Qap.
- pat ponglu'be'bogh tlhob LM Studio DaH 'elmoHbogh pat tlhob. jangDaq 'anglu'bogh pat 'oH LM Studio ja'bogh ID'e'.
- rarwI' motlh poH 'aqroS (10 tup) lo'lu', 'ej rar chIllu'bogh nIDqa'lu'.
- `LM_STUDIO_URL` (motlh `http://localhost:1234`) `/` Dor laH.
- LM Studio SeH'egh taH meq: meq pagh vum Doch ngeH EYAS not, 'ej Hoch patvaD LM Studio ja'bogh SeH 'ang nav ([chay' Hoch nobwI' vum patlh lo'](#effort-by-provider)).

**Ollama**

- **patmey yIchu'qa'** Ollama De'wI'vo' Hoch pat laHmey laD — laDDI', 'emDaq, chu'qa'DI' je — vaj jan Hutlh patmey per ghaj 'ej Qub SeHchaj Suq Qubbogh patmey ([chay' Hoch nobwI' vum patlh lo'](#effort-by-provider)). laHmey ja'be'bogh ngo' Ollama janmey chu' pol.
- Ollama motlh context 4096 token. tlhob jang je law' poQchugh, `num_ctx` cher EYAS: cha' HoS veb (8192, 16384, …), pat tetlh context logh 'aqroS. mach tlhobmey Ollama motlh pol. `num_ctx` cherbe'DI' EYAS, `OLLAMA_CONTEXT_LENGTH` Qap taH. `num_ctx` tIn poQbogh tlhobmeyvaD neH Ollama qawHaq lo' nIvmoH.

**mev juH chenmoH mev.** LM Studio 'ej OllamaDaq, **mev** QaptaHbogh chenmoH mevmoH SIbI', vaj DamevDI' GPU tlhab.

### context logh {#context-window}

Hoch mIw mu'tlhegh jangbogh patvaD chenmoH EYAS. pat tetlhvo' logh Suqlu' (Hoch pat context tIn Degh), CLI patmeyvaD je: 1M logh ghajbogh Claude Code pat 1M lo'. QapwI' 1M Segh'egh neH (*Opus (1M context)* rur) 1M rur tetlh Claude Code; Fable, Opus, Sonnet, Haiku Dochmeyvetlh 200k tetlh, QapwI' patmeyDaj ja'pa' je, vaj wa'DIch taghDI' context tIn Degh, Qorwagh 'ar tebta' tlhegh, mu'tlhegh tIn cher je Qochbe'. CLI Sovlu'bogh loghmey — Claude Code 200k, Grok 500k, Kimi 256k — pat tetlh patvetlhvaD logh ghajbe'DI' neH Qav 'oH, 'ej pagh Sovlu'bogh pat 200k lo'. logh tIn choHlaHbogh 'ay'mey logh law' nob; mach juH patmey ja'chuqvaD logh ratlhmoHbogh mu'tlhegh Suq. [mu'tlhegh pat — patvaD tIn cherlu'](/docs/tlh/ai/prompts/#prompt-size).

ja'chuq De' HevbIng logh rap lo' 'ej, ja'DI' nobwI', Qav pat ra' mu'tlhegh tIn net (Anthropic 'ej Anthropic rap, OpenAI qorDu' OpenRouter, Kimi API, LM Studio je, Gemini, Claude Code). jangbogh pat logh ja'chugh QapwI' (ja' Claude Code), pat tetlh nIv. Hoch ra'vaD lo'laHbogh mu'tlhegh tIn ja'be' Ollama, Grok CLI, Kimi Code CLI je, vaj pIH 'oH tlheghchaj. [ja'chuqmey — De' chellu'ghach](/docs/tlh/daily/conversations/#context-composition).

### pegh: Hoch nobwI' nuq Suq {#privacy-what-each-provider-receives}

pegh chut patDaq ghoStaHvIS ghot De' So', Hoch nIDDaq Hoch ghoSvaD. nobwI' **juH** 'oH'a' (So'be'lu'bogh ghItlh) — ngeHDaq jan wuq, nobwI' pong ghobe' not:

- juH: loopback (`localhost`, `127.x.x.x`, `::1`) pagh pegh chutDaq local host tetlhlu'bogh jan. juH Ollama pagh LM Studio juH 'oH.
- Hur (So'lu'): Hoch latlh — Hur `OLLAMA_HOST`, tetlhDaq Hutlhbogh LAN jan, chal API, 'ej Hoch CLI nobwI' (Claude Code, Grok CLI, Kimi Code CLI), CLI De' nuqDaq ngeH 'e' leghlaHbe'mo' EYAS.

latlh nobwI'Daq ra' vIHchugh, Hoch nID ghoSDajvaD So'lu'. Hur Ollama jan So'be'lu' 'e' Dalo'chugh, pegh chut local hostsDaq janvetlh yIchel. EYAS jan rarwI' lo'taHvIS CLI Suqbogh qawHaq jan jangmey rap So'lu'. block-Segh De' (IBAN rur) ngaSbogh DangeHbogh **chu'** QIn, Hop patDaq ghoSmeHchugh — CLI nobwI'pu' je — pollu'pa' lajQo'lu', So'lu'DI' ngeH 'e' nob. ngaSlu'bogh OpenAI nobwI' Hoch tlhob OpenAI stored completionsvo' lajQo' je. [Hub 'ej pegh](/docs/tlh/admin/security-privacy/#privacy-policy).

## Dochmey SeHwI'mey je

### nobwI' nav {#panel}

| 'ay' | QIj |
|------|-----|
| **● Qap** | nav pong retlh Degh: nobwI' chu'lu' 'ej Qap; pagh **taHbe'** ja' |
| **'ol** | API ngoq, De'wI'vam Claude Code 'el, pagh **EYASvaD yI'el** chovnatlh (Grok CLI, Kimi Code CLI) |
| CLI 'ol (Claude Code) | *API ngoq nISbe'. QInvamDaq yI'el neH ghun Claude Code: yI'elmeH `claude` CLI yIlo', EYAS Qapbogh ghot rur.* CLIvetlh 'ellu'DI' neH Claude Code lo'laH. |
| Claude Code nIteb tlhegh | *EYAS Claude Code Hop ta': juH CLAUDE.md, SeHmey, hookmey, laHmey, MCP QInmey, qawHaq nIteb je laDbe', 'ej ~/.claude/projects Daq ghItlh pollu'be'. juH Claude yI'el neH lo'.* juH `CLAUDE.md` De' qemmeH **SeHmey → pat → De' vIH → De' yItlhap** 'oS. |
| **EYASvaD yI'el** | Grok CLI / Kimi Code CLI neH — **jan ngoq lo'taHvIS yI'el**, **API ngoq yIlo' neH** (Grok), **yImev**, **yImej** — [EYASvaD Grok Kimi je yI'el](#sign-in-grok-and-kimi-for-eyas) |
| **kernel teywI' Hung** | Claude Code / Grok CLI / Kimi Code CLI — *Qap*, *QInvamDaq tu'lu'be'* (meq tlhej) pagh *QaHbe'*, `required` QIj je, 'ej `auto`Daq Claude CodevaD *Hung Hur Qap 'e' tlhobchugh ra', reH chaw'lIj loS.* — [kernel teywI' Hung](#kernel-file-sandbox) |
| Kimi pat QIj | Kimi Code CLI, Kimi pat tetlh laDpa' EYAS: *Kimi patmey tetlh laDbe'pu' EYAS; vaj patlh wIvlaHbe' 'ej meq chu'laHbe' chu'Ha'laHbe' je…* |
| API ngoq Dochmey | peghmeyDaq So'lu'; **ngoq toDlu' / ngoq Hutlh / ngoq yIQaw'** |
| pat tetlh | Hoch pat chu'/chu'Ha'; **janmey** / **legh** / context tIn Deghmey; tlhegh ID rurbe'DI' pat naQ, **&lt;pat&gt; Qap**; Qav chu'qa' nobbe'bogh tlheghmeyDaq **Qav chu'qa'meH, pat nob Hutlh**; **Qub** tlhegh pat vum patlhmey motlh je, De' nuqvo' ghoS je tlhej (*ja'pu' QapwI'* / *EYAS tetlh, tobta' …*); LM StudioDaq, LM Studio ja'bogh meq SeH |
| **patmey yIchu'qa'** | nobwI' pat tetlh chu'qa' (Hoch nobwI'). lujDI': *chu'qa' luj. patmey tetlh choHbe'lu'.* |

**QapmeH poH** tlhegh **Hop** 'ay' je 'ang Claude Code CLI, Grok CLI, Kimi Code CLI navmey je, Grok KimivaD **DaH yI'ol** tlhej — [Hoch mIw qaSpa' nIteb chov](#isolation-check-before-every-turn) bIngDaq *nobwI' navDaq QapmeH poH Hop je* yIlegh. chovnatlhchaj bIng pongmey: *Claude Code CLI, EYAS Hop ta'*, *EYAS juH'e'Daq Grok CLI (ACP)*, *EYAS juH'e'Daq Kimi Code CLI (ACP)*.

## Dech rarlu'bogh

- [He 'ej Huch](/docs/tlh/ai/routing-budget/) (Dech He mI' + Huch). **retlh pat ra'mey** 'emwI' tlhej poS **He mI'** Dech: DaH nuqDaq ghoS EYAS 'em Qu' 'ang — [He 'ej Huch — retlh pat ra'mey](/docs/tlh/ai/routing-budget/#background-model-calls-card).
- **QI' poj** — lIb'egh chovmey iframe

## latlh

- [tagh ghojmoHwI'](/docs/tlh/setup-wizard/)
- [peghmey](/docs/tlh/admin/secrets/)
- [MCP](/docs/tlh/ai/mcp/)
- [qawHaq](/docs/tlh/knowledge/memory/)
- [Hub 'ej pegh](/docs/tlh/admin/security-privacy/)
- [De' tlhap](/docs/tlh/admin/data-port/)
- [CLI — doctor](/docs/tlh/deploy/cli/)
