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

## latlh

- [juH](/docs/tlh/deploy/native/)
- [Kubernetes](/docs/tlh/deploy/kubernetes/)
- [law' pat](/docs/tlh/deploy/multi-instance/)
