---
title: CLI De'
description: eyas serve/start/stop/doctor/config/module — lIng He yIwIvpu' SeH.
---

**nuq 'oH.** `eyas` jan juH pagh ngaSwI' lIng tagh, mev, chov, 'ej pat chu'. cha'DIch Doch 'oHbe' — rap Qap, rap `EYAS_HOME`. `PATH`Daq `bin/` tu'lu'DI' (juH lIngwI') pagh image qoDDaq (`docker compose exec`), ra'meyvam lo'laH.

## ghorgh yIlo'

- tlhop (`serve`) log DaleghmeH, pagh 'em (`start` + pidfile).
- Qagh Daja'pa' `doctor` yIQap: CLI Hutlh, 'Iv Claude Code QapwI' Qap 'ej 'ellu'ta''a', Hoch lIngbogh AI CLI EYAS mob chov tobta'bogh chovnatlh'a', EYAS juHDaj naQ'a', CLImey kernel teywI' Hung tu'lu''a', nuqDaq vault, qawqa' 'Iv qawHaq lanwI' lo', buSHa'lu'bogh tlhap Sormey, lojmIt lo'lu', docs/web dist.
- YAML ghItlh lo'be'taHvIS pat chu'.
- chu' chovnatlh GitHubDaq yInej (`eyas update` qorDu', SeHmey → chu'moH rap).

## motlh mIw

1. [juH](/docs/tlh/deploy/native/) pagh [Docker](/docs/tlh/deploy/docker/) lIng.
2. `eyas doctor` — ja'bogh yItI'.
3. `eyas serve` (tlhop) pagh `eyas start` ('em). `eyas status` yIchov.
4. YAML DachoHDI' `eyas config validate`, ghIq `eyas restart`: `default.yaml` 'ej `local.yaml` taghDI' wa'logh laDlu'.
5. poQlu'DI' `eyas stop` / `eyas restart`.

## laHmey

| ra' | Del |
|-----|-----|
| `eyas serve` | tlhop HTTP De'wI' |
| `eyas start` | 'em (pidfile + log) |
| `eyas stop` | 'em mev |
| `eyas restart` | taghqa' |
| `eyas status` | pIv + PID |
| `eyas doctor` | chov |
| `eyas version` | chovnatlh |
| `eyas config validate` | YAML chov |
| `eyas config reload` | `default.yaml` / `local.yaml` laDqa' **not** — yItaghqa' |
| `eyas module list` | pat tetlh |
| `eyas module enable/disable <id>` | pat chu' |
| `eyas update check` | GitHubDaq (`eyssen/eyas`) chu' chovnatlh nej; lo'meH, polmeH ghunmey SumnIS |
| `eyas migrate …` | wa'logh v1→v2 mu'tlhegh/workspace vIHmoH (`run` / `rollback` / `drop-cols`) — jaj vum 'oHbe' |

<h3 id="what-doctor-checks"><code>doctor</code> nuq chov</h3>

Hoch tlhegh *ok* (✓), *ghuHmoHwI'* (⚠) pagh *luj* (✗) 'oH. Qaghmey pagh ghuHmoHwI'mey mI' ja' doctor rInDI', 'ej wa' tlhegh lujchugh, 1 Dotlh nob mevDI'; ghuHmoHwI'mey neH Dotlh choHbe'. laD neH: pagh tI', pagh cha'logh, pagh chenmoH; lIngbogh CLImey chovnatlhchaj (`--version`) laDmeH neH tagh, 'ej Claude Code 'ellu'ta''a' (`claude auth status`) laDmeH.

tlheghmeyDaj 'op:

| tlhegh | Del |
|--------|-----|
| **Claude Code runtime** | 'Iv Claude Code QapwI' Qap EYAS: Hal (`EYAS_CLAUDE_CODE_BIN` / `claude on PATH` / `SDK-bundled`), He 'ej chovnatlh, EYAS SDK rarwI' chenlu'bogh chovnatlh pIm'a' (*version skew*), 'ej **signed in** HIja'/ghobe'. lughbe'bogh `EYAS_CLAUDE_CODE_BIN` luj 'oH. SDK ngaSbogh Qav, chovnatlh pIm, 'ellu'ta'be'bogh Qap — ghuHmoHwI'mey. override So'bogh PATH `claude` De' rur 'anglu' (*not used by EYAS*). [nobwI'pu' — Claude Code Qap](/docs/tlh/ai/providers/#claude-code-runtime). |
| **CLI isolation (Claude Code)**, **CLI isolation (Grok CLI)**, **CLI isolation (Kimi Code CLI)** | Hoch CLI nobwI'vaD wa' tlhegh. EYAS Qapbogh jan 'ang — chay' tu'lu' (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, `claude on PATH` / `grok on PATH` / `kimi on PATH`, pagh `SDK-bundled`), He, chovnatlh je — 'ej chovnatlhvam tob EYAS mob chov (Doch chu' nobpa'): ok *isolation proven on this version (&lt;jaj&gt;)*. ghuHmoH: chovnatlh Qav tobta'bogh rapbe'chugh, chovnatlh ja'be'chugh jan, 'ej pagh De'wI'Daq CLI toblu'pu'be'chugh (DaH Kimi Code CLI); taghDI' Hoch ja'chuq chov EYAS 'e' chel ghuHmoHwI'. lIngbe'lu'bogh CLI *not installed* 'ang (ok). lughbe'bogh `EYAS_*_BIN` luj 'oH, tI'meH mIw je. Grok CLI Kimi Code CLI je EYAS juHchaj chov tlhegh je, `<data dir>/cli-homes/<nobwI'>` — veb tetlh yIlegh. chovnatlhmey Qav toblu'pu'bogh, chay' je: [Hung 'ej pegh — mob chay' toblu'](/docs/tlh/admin/security-privacy/#how-isolation-is-proven). |
| **CLI sandbox** | `security.cliSandbox` mIw, 'ej Hoch lIngbogh CLIvaD (Claude Code, Grok CLI, Kimi Code CLI) kernel teywI' HungDaq janmeyDaj'egh Qap'a': *active*; *unavailable* meq tI'meH mIw je tlhej (bubblewrap yIlIng; socat yIlIng — bubblewrap retlh Claude Code poQ; De'wI' SeHbe'bogh lo'wI' namespacemey yIchaw', ngaSwI'Daq je); pagh *none* KimivaD, kernel teywI' Hung ghajbe'mo'. Hung Hutlh ghuHmoHwI' 'oH, luj 'oHbe': `auto` — Hung Hutlh Qap CLI; `required` — janmey ghajbogh mIwmeyDaj lajQo'lu'. [nobwI'pu' — kernel teywI' Hung](/docs/tlh/ai/providers/#kernel-file-sandbox). |
| **Vault** | qawHaq vault He, `<data dir>/vault` (ok). ngo' `<EYAS home>/data/vault`Daq ghItlhHommey veb taghDI' cha'loghlu'DI' ghuHmoH, 'ej — tI'meH mIw tlhej — De' paq vault ghItlhHommey ngaSmo' ngo' paq lo'be'lu'DI'. pagh cha'logh doctor 'egh not. [SeH — De' paq 'ej vault](/docs/tlh/deploy/configuration/#data-directory-and-vault). |
| **SQLite** | logh De' pa'Daq yIntaHbogh chov'egh — De' pa'lIj poSmoHlu'be' not. SQLite chovnatlh ja', **FTS5** tu'lu''a' (Hutlhchugh lujlu': qawHaq, ja'chuq, vault nej Hoch poQ), 'ej `sqlite-vec` chelwI' 'el'a' — mI' tlhoblu' neH ghobe', 'ach tetlh chellu' 'ej Sumqu'bogh nejlu'. chelwI' Hutlhchugh, luj 'oHbe': ghuHmoHwI' 'oH, 'ej pat SeghlIjvaD tI'meH mIw ja'. |
| **Import roots** | `skills.importRoots` / `agent.importRoots` lo'laH'a': pagh cherlu'chugh pagh Hoch Sor motlh pa' 'oHchugh — ok; latlh QaHwI' pagh ghItlhHom ghun pa''egh qoDDaq tu'lu'bogh pagh ngaSbogh Sor (`~/.claude`, `~/.grok`, Obsidian vault, …) — vaj nejlu'be' — SeH pa' je pongbogh ghuHmoHwI'. [SeH — latlh laH qa' Sormey je](/docs/tlh/deploy/configuration/#extra-skill-and-persona-roots). |
| **Memory embedder** | qawqa' 'Iv qawHaq lanwI' lo'. ok: *multilingual-e5-small, local (weights in &lt;folder&gt;)* — `@huggingface/transformers` lIngDI' 'ej `data/models`Daq ngI' tu'lu'DI'. ghuHmoHwI': hash stem lanwI' (`stem5-fnv-384`), `@huggingface/transformers` lIngbe'lu'mo' — tI'meH: EYAS pa'Daq `bun add @huggingface/transformers` (pagh `bun install`) yIQap, ghIq yItaghqa'. ghuHmoHwI': boq lIngDI' 'ach wej ngI' qemlu'be' — veb tagh Hugging Facevo' `data/models`Daq qem (tlhoS 130 MB), 'ej tu'pa' Qav lanwI' lo' qawqa'. [qawHaq — reH juHDaq vector nej Qap](/docs/tlh/knowledge/memory/#vector-search-always-runs-locally). |
| **zstd** | tetlh tlhol machmoHmeH nuq lo'lu' ja': Bun machmoHwI', Node (22.15 pagh nIv), pagh ngaSlu'bogh WASM chuvwI'. chuvwI' ghuHmoHwI' 'oH — Qap 'ach tlhoS cha'logh QIt. pagh tu'lu'chugh, lujlu': ghItlhlaHbe'bogh buffer tebmeH ghobe', EYAS pagh qon. |

**CLI isolation (Grok CLI)** **CLI isolation (Kimi Code CLI)** je tlheghDaq EYAS juH chov:

| `<data dir>/cli-homes/<nobwI'>`Daq doctor tu'bogh | Qap |
|---------------------------------------------------|-----|
| wej chenmoHlu'be' | ok — wa'DIch Qap chenmoH |
| rar joq, pagh pa' 'oHbe' | luj — naDevvo' CLI Qapqang EYAS. tI'meH: yIteq; veb Qap chenmoHqa' |
| latlh lo'wI'pu' laDlaHbogh pa' | ghuHmoHwI' — CLI 'elghach ngaS. tI'meH: `chmod 700 <pa'>` |
| naDev EYAS SeHbogh teywI' Hutlh pagh ghItlhpu'DI' EYAS choHlu' (Grok: `config.toml`, `requirements.toml`, `trusted_folders.toml`; Kimi: `mcp.json`, `config.toml`Daq EYAS SeHmey je) | ghuHmoHwI' — veb Qap nobpa' teywI'meyvam ghItlhqa' EYAS; vaj Qapmey jojDaq choHlu'chugh, latlh Doch pa'vetlh choH |
| Hoch EYAS ghItlhbogh rur | ok — *EYAS home and managed files intact* |

<h3 id="environment">env</h3>

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_DATA_DIR`, `EYAS_WORKSPACES_DIR`, `EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`. He 'ej Qap env nuq ta': [SeH](/docs/tlh/deploy/configuration/).

motlh lojmIt **3100**. `EYAS_SKIP_DOCS_BUILD=1` → `/docs` 404 — [FAQ](/docs/tlh/reference/faq/).

## latlh

- [SeH](/docs/tlh/deploy/configuration/)
- [juH](/docs/tlh/deploy/native/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
- [Hung 'ej pegh](/docs/tlh/admin/security-privacy/)
- [FAQ](/docs/tlh/reference/faq/)
- [SeHmey — chu'moH](/docs/tlh/admin/settings/)
