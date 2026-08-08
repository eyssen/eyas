---
title: Első lépések
description: EYAS telepítése, szerver indítása, setup varázsló, UI megnyitása.
---

## Mit fogsz csinálni

1. EYAS telepítése (natív vagy Docker)
2. Szerver indítása
3. [Setup varázsló](/docs/hu/setup-wizard/) végigvitele
4. Web UI megnyitása és munka

## Előfeltételek

| Követelmény | Megjegyzés |
|-------------|------------|
| **Bun 1.x** (ajánlott) vagy **Node.js 22+** | Elsődleges runtime: Bun |
| Lemezterület | SQLite, vault, ágens workspace a `data/` alatt |
| Opcionális: Docker / Compose | Konténeres futtatás |
| Opcionális: host CLI | `claude`, `grok` vagy `kimi` kulcs nélküli helyi providerhez |

## Natív telepítés

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
```

Nyisd meg: **http://localhost:3100** (alap port a `config/default.yaml`-ból — **3100**, nem 3000).

Előtérben (log a terminálban):

```bash
./bin/eyas serve
```

### Egy-soros installer

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
```

Nem interaktív: `bash -s -- --yes`. Verzió pin: `--version 0.8.5-beta`.

Windows: `scripts/install.ps1`.

## Docker

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
```

**http://localhost:3100**. GPU + Ollama: `docker compose --profile gpu up -d`.

## Életciklus parancsok

| Parancs | Mit csinál |
|---------|------------|
| `eyas serve` | HTTP szerver előtérben |
| `eyas start` | Háttér (pidfile + log) |
| `eyas stop` | Leállítás |
| `eyas restart` | Újraindítás |
| `eyas status` | Health + PID |
| `eyas doctor` | Helyi diagnosztika |
| `eyas version` | Verzió |

Indításkor a **frontend** és a **termékdokumentáció** automatikusan buildel, ha hiányzik vagy elavult — kivéve `EYAS_SKIP_WEB_BUILD=1` / `EYAS_SKIP_DOCS_BUILD=1`.

## Első belépés

| Lépés | Eredmény |
|-------|----------|
| Böngésző → `/setup` | [Setup varázsló](/docs/hu/setup-wizard/) |
| Setup után | Bejelentkezés a **root owner** fiókkal |
| Kezdőlap | [Irányítópult](/docs/hu/daily/dashboard/) |
| Dokumentáció | Ugyanazon a hoston: **`/docs/`** |

## Hol van az adat

A példány home-jában (`EYAS_HOME` vagy a start könyvtár):

| Útvonal | Tartalom |
|---------|----------|
| `data/sqlite/` | Fő SQLite adatbázis (WAL) |
| `data/vault/` | Semantic / procedural markdown vault |
| `data/agents/<id>/` | Ágens workspace fájlok |
| `data/backups/` | Backup archívumok |
| `config/` | YAML alap + local overlay |

## Tovább

- [Setup varázsló — minden lépés és mező](/docs/hu/setup-wizard/)
- [Alapfogalmak](/docs/hu/concepts/)
- [CLI referencia](/docs/hu/deploy/cli/)
