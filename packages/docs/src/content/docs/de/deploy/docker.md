---
title: Docker
description: Compose ein Container (plus optionales GPU-Ollama). Port 3100. data/ persistieren.
---

**Wozu das da ist.** Zweiter Install-Pfad: ein `eyas`-Service, `data/`-Volume, optionales **gpu**-Profil für Ollama. Wenn Docker da ist und Bun nicht auf den Host soll. Image: Backend, Frontend-Dist, Docs unter `/docs/`. Listen-Port **3100**.

## Wann du es brauchst

- Server hat Docker, kein Host-Bun.
- Zweiter Stack (`-p eyas-dev` + `EYAS_PORT=3200`).
- Optionales lokales Ollama mit NVIDIA (`--profile gpu`).

## Typischer Ablauf

1. Clonen. Optional `.env`.
2. `docker compose up -d`. **http://localhost:3100**.
3. Volume `eyas-data`. `./config` read-only wie geliefert.
4. `docker compose logs -f` / `down`.
5. GPU: `docker compose --profile gpu up -d`.

Mapping: `"${EYAS_PORT:-3100}:3100"` — 3100, damit Grafana/CRA auf :3000 frei bleibt. Mehrere Stacks: [Mehrere Instanzen](/docs/de/deploy/multi-instance/).

## Verwandt

- [Native](/docs/de/deploy/native/)
- [Kubernetes](/docs/de/deploy/kubernetes/)
- [Mehrere Instanzen](/docs/de/deploy/multi-instance/)
