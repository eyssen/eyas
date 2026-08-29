---
title: tagh
description: EYAS yIlIng, De'wI' yItagh, lIng pIn'a' yIrIn, 'ej UI yIpoSmoH.
---

**meq.** EYAS De'wI' DalIngmeH web UI De'wI'lIjDaq tu'lu'. pa'vam lIng He 'oH, Qu' pat bej 'oHbe'.

rInDI', [lIng pIn'a'](/docs/tlh/setup-wizard/)Daq yIghoS, ghIq [wa'DIch rep](/docs/tlh/first-hour/).

## ta' SoH

1. EYAS yIlIng (juH pagh Docker)
2. De'wI' yItagh
3. [lIng pIn'a'](/docs/tlh/setup-wizard/) yIrIn
4. web UI yIpoSmoH 'ej Qu' yItagh — veb: [wa'DIch rep](/docs/tlh/first-hour/)

## poQlu'bogh

| poQ | Del |
|-----|-----|
| **Bun 1.x** (chuplu') pagh **Node.js 22+** | potlh Qap pat 'oH Bun'e' |
| ngaSwI' logh | SQLite DB, toDpa', ghoqwI' vum Daqmey `data/` bIngDaq |
| poQbe': Docker / Compose | ngaSwI' lIng |
| poQbe': juH CLI | `claude`, `grok`, pagh `kimi` — peghHutlh juH nobwI' DaneHchugh |

## juH lIng

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
```

**http://localhost:3100** yIpoSmoH (`config/default.yaml` motlh qach — **3100**, 3000 'oHbe').

tlhoy Qap (jabbI'IDmey De'wI'Daq):

```bash
./bin/eyas serve
```

### wa' tlhegh lIngwI'

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
```

ja'chuqbe': `bash -s -- --yes` yIchel. chovnatlh yIQan: `--version 0.8.16-beta`.

Windows: `scripts/install.ps1`.

## Docker

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
```

**http://localhost:3100** yIpoSmoH. poQbe' GPU + Ollama:

```bash
docker compose --profile gpu up -d
```

## yIn ra'mey

| ra' | ta' |
|-----|-----|
| `eyas serve` | HTTP De'wI' tlhoy |
| `eyas start` | 'emDaq De'wI' (pid teDwI' + QIn teDwI') |
| `eyas stop` | 'emDaq QapwI' yImev |
| `eyas restart` | mev 'ej tagh |
| `eyas status` | yIn + PID |
| `eyas doctor` | juH ghu' chov |
| `eyas version` | chovnatlh mu'tlhegh |

taghDI', EYAS **UI** 'ej **Qu' ghItlhmey** chenqa'lu' Hutlhchugh pagh ngo'chugh (`bun run build:web`, `bun run docs:build`), `EYAS_SKIP_WEB_BUILD=1` / `EYAS_SKIP_DOCS_BUILD=1` Dachenbe'chugh.

## wa'DIch yI'el He

| mIw | qaS |
|-----|-----|
| qunI'wI' → `/setup` (lIng rInbe'chugh autom) | [lIng pIn'a'](/docs/tlh/setup-wizard/) |
| lIng rInDI' | **potlh pIn** lo'wI' DachenmoHta' yI'el |
| juH | [jIH Daq](/docs/tlh/daily/home/) |
| Qu' ghItlhmey | reH **`/docs/`** juH/qachvamDaq |

## nuqDaq 'oH De''e'

pat juH bIngDaq (`EYAS_HOME` pagh taghpu'bogh pa'):

| He | ngaS |
|----|------|
| `data/sqlite/` | potlh SQLite De' pa' (WAL mIw) |
| `data/vault/` | QIj / tIgh markdown toDpa' |
| `data/agents/<id>/` | ghoqwI' vum Daq teDwI'mey (IDENTITY, SOUL, …) |
| `data/backups/` | qon ngaSwI'mey |
| `config/` | YAML motlh + juH chel |

## veb

- [lIng pIn'a' — Hoch mIw Hoch De' je](/docs/tlh/setup-wizard/)
- [wa'DIch rep](/docs/tlh/first-hour/)
- [potlh qechmey](/docs/tlh/concepts/)
- [CLI chovnatlh](/docs/tlh/deploy/cli/)
