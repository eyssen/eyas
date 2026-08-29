---
title: Docker
description: Compose egy konténer (plusz opcionális GPU Ollama). Port 3100. Persistáld a data/-t.
---

**Mire való.** A Docker Compose a második telepítési út: egy `eyas` szolgáltatás, `data/` volume, opcionális **gpu** profil Ollamához. Akkor, ha van Docker, és nem akarsz Bunt a hostra. A image backend + frontend dist + docs `/docs/`-on. A konténer **3100**-on hallgat.

## Mikor használd

- A szerveren van Docker, Bun a hostra nem kell.
- Második stack ugyanazon a gépen (`-p eyas-dev` + `EYAS_PORT=3200`).
- Opcionális lokális Ollama NVIDIA GPU-val (`--profile gpu`).

## Tipikus folyamat

1. Clone. Opcionális `.env` (a Compose beolvassa, ha van).
2. `docker compose up -d`. **http://localhost:3100**.
3. `data/` az `eyas-data` volume-on. `./config` read-only, ahogy a compose szállítja.
4. Log: `docker compose logs -f`. Stop: `docker compose down`.
5. GPU Ollama: `docker compose --profile gpu up -d`.

## Funkciók

```bash
docker compose up -d
docker compose --profile gpu up -d
docker compose logs -f
docker compose down
```

A port mapping illeszkedjen az `EYAS_PORT`-hoz (**3100** alap — Grafana/CRA :3000 elkerülése). Host port állítható; a konténer 3100-on marad: `"${EYAS_PORT:-3100}:3100"`.

Több stack: `EYAS_PORT=3200 docker compose -p eyas-dev up -d`. Lásd [Több példány](/docs/hu/deploy/multi-instance/).

## Kapcsolódó

- [Natív](/docs/hu/deploy/native/)
- [Kubernetes](/docs/hu/deploy/kubernetes/)
- [Több példány](/docs/hu/deploy/multi-instance/)
- [Első lépések](/docs/hu/getting-started/)
