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

### Claude Code konténerben

Az image nem tartalmazza a Claude Code CLI-t. Ha nincs, az EYAS az Agent SDK függőségébe csomagolt régebbi példányra esik vissza (jelenleg 2.1.89), és az `eyas doctor` figyelmeztet. Aktuális Claude Code futtatásához telepítsd egy leszármazott image-be vagy csatold be, és állítsd az `EYAS_CLAUDE_CODE_BIN`-t az abszolút útvonalára. Hitelesíts `ANTHROPIC_API_KEY`-jel vagy előre beállított bejelentkezéssel: a provider csak akkor érhető el, ha az a bináris be van jelentkezve. Lásd [Providerek — Claude Code runtime](/docs/hu/ai/providers/#claude-code-runtime).

### Grok és Kimi konténerben

A Grok CLI és a Kimi Code CLI az EYAS saját home-jában fut az adatkötetben (`data/cli-homes/…`), ezért **az EYAS számára** kell bejelentkeztetni őket, nem az image-be sütött bejelentkezéssel. Használd a provider panelen a **Bejelentkezés eszközkóddal** gombot: az EYAS mutat egy linket és egy kódot, amelyet bármely más eszköz böngészőjében megerősítesz — a konténerben nem kell böngésző. A Grok xAI API-kulcsot is elfogad, amely a Titkok közé kerül. A bejelentkezések az `eyas-data` kötetben vannak, és túlélik a konténer újraindítását. Ha a bináris nincs a konténer PATH-ján, az `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` változóval mutass rá. Lásd [Providerek — Bejelentkezés a Grokba és a Kimibe az EYAS számára](/docs/hu/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### Kernel fájl-sandbox konténerben

Az EYAS image **nem** tartalmazza a bubblewrapot: LGPL licencű, így a telepítése a te döntésed. Nélküle a CLI providerek saját toolai (a Claude Code shellje, a Grok CLI toolai) kernel fájl-sandbox nélkül futnak; az EYAS továbbra is elutasít minden kérést, amelyet lát, a provider panel a sandboxot *Ezen a szerveren nem érhető el* állapotban mutatja, `security.cliSandbox: required` mellett pedig a tooloket használó CLI-körök elutasításra kerülnek. A kernel réteghez telepítsd a bubblewrapot (`bwrap`) — a Claude Code-hoz a `socat`-ot is — egy származtatott image-be, és a konténert engedélyezett nem privilegizált user namespace-ekkel futtasd. Az `eyas doctor` (`docker compose exec eyas eyas doctor`) a **CLI sandbox** sorában mutatja az eredményt. Lásd [Providerek — Kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox).

### Időzóna

A konténerek általában UTC-ben futnak. A modellnek átadott dátum és idő az `i18n.timezone`-t követi, különben a konténer `TZ`-jét — lásd [Konfiguráció — Időzóna](/docs/hu/deploy/configuration/#time-zone-of-the-models-clock).

## Kapcsolódó

- [Natív](/docs/hu/deploy/native/)
- [Kubernetes](/docs/hu/deploy/kubernetes/)
- [Több példány](/docs/hu/deploy/multi-instance/)
- [Első lépések](/docs/hu/getting-started/)
