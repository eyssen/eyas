---
title: Natív telepítés
description: Bun a hoston — clone vagy installer, majd eyas start. Laptophoz vagy egyszerű VPS-hez.
---

**Mire való.** A natív telepítés az egyik a három útból (natív / Docker / Kubernetes). Akkor válaszd, ha Bun kell a gépen, host CLI-k (`claude`, `grok`, `kimi`) ugyanazon a PATH-on, és a legkevesebb mozgó alkatrész. Alap UI: **http://localhost:3100** — nem 3000.

Lásd [Első lépések](/docs/hu/getting-started/).

## Mikor használd

- Fejlesztői laptop vagy egy VPS Bun 1.x-szel (vagy Node 22+).
- Host CLI providerek konténer nélkül.
- Mentés visszaállítása azonos `--version` telepítésre.

## Tipikus folyamat

1. Bun 1.x (vagy Node 22+).
2. `git clone` + `bun install` **vagy** `scripts/install.sh` / `install.ps1`.
3. `bin/` a `PATH`-on, hogy az `eyas` menjen.
4. `./bin/eyas start` (háttér) vagy `./bin/eyas serve` (előtér, log).
5. **http://localhost:3100** és [setup varázsló](/docs/hu/setup-wizard/).

## Funkciók

1. `git clone` + `bun install` + `./bin/eyas start`
2. `scripts/install.sh` (macOS/Linux)
3. `scripts/install.ps1` (Windows)

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
```

Nem interaktív: `bash -s -- --yes`. Verziópin: `--version 0.8.16-beta`. Mentés-restore: installer `--version` a backup verziójára.

### Claude Code a hoston

Telepítsd a Claude Code-ot (`claude`) ugyanarra a PATH-ra, amelyen az EYAS fut, vagy állítsd az `EYAS_CLAUDE_CODE_BIN`-t az abszolút útvonalára — egy launchd vagy systemd által indított szolgáltatás PATH-ja gyakran rövidebb, mint a shelledé. A provider csak akkor érhető el, ha az a bináris be van jelentkezve (`claude auth status`). Az `eyas doctor` a **Claude Code runtime** sorában mutatja, melyik binárist futtatja az EYAS. Lásd [Providerek — Claude Code runtime](/docs/hu/ai/providers/#claude-code-runtime).

### Workspace-ek forrástelepítésen

A git clone-ból futó forrástelepítés adatkönyvtára a checkouton belül van, ezért a beszélgetés-workspace-ek inkább a felhasználód alkalmazásadat-könyvtárába kerülnek (macOS-en például `~/Library/Application Support/eyas/<instance>/workspaces`). Lásd [Konfiguráció — Beszélgetés-workspace-ek](/docs/hu/deploy/configuration/#conversation-workspaces).

## Kapcsolódó

- [Docker](/docs/hu/deploy/docker/)
- [Kubernetes](/docs/hu/deploy/kubernetes/)
- [CLI](/docs/hu/deploy/cli/)
- [Konfiguráció](/docs/hu/deploy/configuration/)
- [Első lépések](/docs/hu/getting-started/)
