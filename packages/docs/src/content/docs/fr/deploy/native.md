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

## Claude Code sur l’hôte

Installe Claude Code (`claude`) sur le même PATH qu’EYAS, ou règle `EYAS_CLAUDE_CODE_BIN` sur son chemin absolu — un service lancé par launchd ou systemd a souvent un PATH plus court que ton shell. Le fournisseur n’est disponible qu’une fois ce binaire connecté (`claude auth status`). `eyas doctor` montre quel binaire EYAS lance sur sa ligne **Claude Code runtime**. Voir [Fournisseurs — Runtime Claude Code](/docs/fr/ai/providers/#claude-code-runtime).

## Espaces de travail sur une install depuis les sources

Une install depuis les sources lancée depuis un clone git garde son répertoire de données dans ce checkout ; les espaces de travail des conversations vont donc dans le répertoire de données d’application de ton utilisateur (par exemple `~/Library/Application Support/eyas/<instance>/workspaces` sur macOS). Voir [Configuration — Espaces de travail des conversations](/docs/fr/deploy/configuration/#conversation-workspaces).

## Voir aussi

- [Docker](/docs/fr/deploy/docker/)
- [Kubernetes](/docs/fr/deploy/kubernetes/)
- [CLI](/docs/fr/deploy/cli/)
- [Configuration](/docs/fr/deploy/configuration/)
