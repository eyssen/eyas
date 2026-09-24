---
title: Első lépések
description: EYAS telepítése, szerver indítása, setup varázsló, UI megnyitása.
---

**Mire való.** Az EYAS szervert telepíted, hogy a web UI létezzen a gépeden. Ez az oldal a telepítési út, nem termék-túra.

Ha kész vagy, menj a [Setup varázsló](/docs/hu/setup-wizard/)hoz, aztán [Az első órád](/docs/hu/first-hour/)hoz.

## Mit fogsz csinálni

1. EYAS telepítése (natív vagy Docker)
2. Szerver indítása
3. [Setup varázsló](/docs/hu/setup-wizard/) végigvitele
4. Web UI megnyitása és munka — következő: [Az első órád](/docs/hu/first-hour/)

## Előfeltételek

| Követelmény | Megjegyzés |
|-------------|------------|
| **Bun 1.x** (ajánlott) vagy **Node.js 22+** | Elsődleges runtime: Bun |
| Lemezterület | SQLite, vault és ágens-fájlok a `data/` alatt; beszélgetés-workspace-ek (lásd lent) |
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

Nem interaktív: `bash -s -- --yes`. Verzió pin: `--version 0.8.16-beta`.

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
| Kezdőlap | [Kezdőlap](/docs/hu/daily/home/) |
| Dokumentáció | Ugyanazon a hoston: **`/docs/`** |

## Hol van az adat

A példány home-jában (`EYAS_HOME` vagy a start könyvtár). Az adatkönyvtár ott a `data/`, hacsak az `EYAS_DATA_DIR` nem nevez meg másik mappát — ilyenkor minden, ami a `data/` alatt van, abban a mappában él:

| Útvonal | Tartalom |
|---------|----------|
| `data/sqlite/` | Fő SQLite adatbázis (WAL mód, `synchronous = NORMAL`) |
| `data/vault/` | Semantic / procedural markdown vault — mindig `<data dir>/vault` |
| `data/agents/<id>/` | Ágens workspace fájlok |
| `data/backups/` | Backup archívumok |
| `config/` | YAML alap + local overlay |

A beszélgetés-workspace-ek — az a mappa, amelyben a saját mappa nélküli beszélgetés dolgozik — Docker, Kubernetes és csomagolt telepítésen a `data/workspaces/` alatt vannak. A git clone-ból futó forrástelepítés a checkouton kívül tartja őket, a felhasználód alkalmazásadat-könyvtárában. Lásd [Konfiguráció — Beszélgetés-workspace-ek](/docs/hu/deploy/configuration/#conversation-workspaces).

## Tovább

- [Setup varázsló — minden lépés és mező](/docs/hu/setup-wizard/)
- [Az első órád](/docs/hu/first-hour/)
- [Alapfogalmak](/docs/hu/concepts/)
- [CLI referencia](/docs/hu/deploy/cli/)
