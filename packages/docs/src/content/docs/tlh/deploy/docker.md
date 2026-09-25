---
title: Docker
description: Compose wa' tev (GPU Ollama chaw'). lojmIt 3100. data/ yIn.
---

**nuq 'oH.** cha'DIch He: wa' `eyas` pat, `data/` tev, **gpu** pab Ollama vaD chaw'. Docker tu'lu', Bun juHDaq poQbe'. ghItlh: 'em, UI dist, De' `/docs/`Daq. tev **3100**Daq Qoy.

## ghorgh yIlo'

- jan Docker ghaj.
- cha'DIch stack (`-p eyas-dev` + `EYAS_PORT=3200`).
- juH Ollama NVIDIA (`--profile gpu`).

## motlh mIw

1. clone. `.env` chaw'.
2. `docker compose up -d`. **http://localhost:3100**.
3. tev `eyas-data`. `./config` laD neH.
4. `docker compose logs -f` / `down`.
5. GPU: `docker compose --profile gpu up -d`.

rar `"${EYAS_PORT:-3100}:3100"` — 3100 Grafana/CRA :3000 lon. [law' pat](/docs/tlh/deploy/multi-instance/).

### ngaSwI'Daq Claude Code

ghItlh Claude Code CLI ngaSbe'. pagh tu'lu'chugh, Agent SDK ngaSbogh ngo' copy (DaH 2.1.89) lo' EYAS, 'ej ghuHmoH `eyas doctor`. Claude Code chu' DaQapmeH, ghItlh chu'Daq yIlIng pagh yIlan, 'ej naQ HeDaq `EYAS_CLAUDE_CODE_BIN` yIcher. `ANTHROPIC_API_KEY` pagh ngaSlu'bogh 'el lo' yI'el: QapwI'vetlh 'ellu'ta'DI' neH nobwI' lo'laH. [nobwI'pu' — Claude Code Qap](/docs/tlh/ai/providers/#claude-code-runtime).

### ngaSwI'Daq Grok Kimi je

EYAS juH'eghDaq Qap Grok CLI Kimi Code CLI je, De' pa' qoDDaq (`data/cli-homes/…`), vaj **EYASvaD** 'ellu', ghItlhDaq chellu'bogh 'el lo'be'. nobwI' navDaq **Sign in with a device code** yIlo': rar ngoq je 'ang EYAS, 'ej latlh De'wI'Daq browserDaq Da'olmoH — ngaSwI'Daq browser poQbe'lu'. xAI API ngoq laj Grok je, peghmeyDaq pollu'. `eyas-data` De' pa'Daq yIn 'elmey 'ej ngaSwI' taghqa'DI' taH. ngaSwI' PATHDaq tu'lu'be'bogh QapwI' 'oSmeH `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` yIlo'. [nobwI'pu' — EYASvaD Grok Kimi je yI'el](/docs/tlh/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### ngaSwI'Daq kernel teywI' Hung

bubblewrap ngaSbe' EYAS ghItlh **not**: LGPL 'oH, vaj DalIngmeH SoH DawIv. Hutlhchugh, CLI nobwI' janmey'egh (Claude Code shell, Grok CLI janmey) kernel teywI' Hung Hutlh Qap; leghbogh Hoch tlhob lajQo' EYAS taH, nobwI' navDaq *QInvamDaq tu'lu'be'* 'ang Hung, 'ej `security.cliSandbox: required` tlhej janmey ghajbogh CLI mIwmey lajQo'lu'. kernel 'ay' DaneHchugh, ghItlh chu'Daq bubblewrap (`bwrap`) yIlIng — Claude CodevaD `socat` je — 'ej De'wI' SeHbe'bogh lo'wI' namespacemey chu'taHvIS ngaSwI' yIQap. `eyas doctor` (`docker compose exec eyas eyas doctor`) **CLI sandbox** tlheghDaq ta' 'ang. [nobwI'pu' — kernel teywI' Hung](/docs/tlh/ai/providers/#kernel-file-sandbox).

### poH yoS

ngaSwI'mey motlh UTCDaq Qap. pat ja'bogh jaj 'ej poH `i18n.timezone` tlha', pagh ngaSwI' `TZ` — [SeH — poH yoS](/docs/tlh/deploy/configuration/#time-zone-of-the-models-clock).

## latlh

- [juH](/docs/tlh/deploy/native/)
- [Kubernetes](/docs/tlh/deploy/kubernetes/)
- [law' pat](/docs/tlh/deploy/multi-instance/)
