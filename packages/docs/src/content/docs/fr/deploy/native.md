---
title: Installation native
description: Bun sur l’hôte — clone ou installeur, puis eyas start. Portable ou VPS simple.
---

**À quoi ça sert.** Le natif est l’un des trois chemins (natif / Docker / Kubernetes). Choisis **natif** quand tu veux Bun sur la machine, les CLI hôte (`claude`, `grok`, `kimi`) sur le même PATH, et le moins de pièces mobiles. UI : **http://localhost:3100** — pas 3000.

Voir [Premiers pas](/docs/fr/getting-started/).

## Quand l'utiliser

- Portable de développement ou un VPS avec Bun 1.x (ou Node 22+).
- Fournisseurs CLI hôte sans conteneur.
- Restaurer une sauvegarde sur une install `--version` identique.

## Déroulement typique

1. Bun 1.x (ou Node 22+).
2. `git clone` + `bun install` **ou** `scripts/install.sh` / `install.ps1`.
3. `bin/` sur le `PATH`.
4. `./bin/eyas start` ou `./bin/eyas serve`.
5. **http://localhost:3100**, [assistant de setup](/docs/fr/setup-wizard/).

One-liner : `curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash`. Pin : `--version 0.8.16-beta`.

## Voir aussi

- [Docker](/docs/fr/deploy/docker/)
- [Kubernetes](/docs/fr/deploy/kubernetes/)
- [CLI](/docs/fr/deploy/cli/)
- [Configuration](/docs/fr/deploy/configuration/)
