---
title: Premiers pas
description: Installer EYAS, démarrer le serveur, terminer l’assistant de configuration et ouvrir l’interface.
---

## Ce que vous allez faire

1. Installer EYAS (natif ou Docker)
2. Démarrer le serveur
3. Terminer l’[assistant de configuration](/docs/fr/setup-wizard/)
4. Ouvrir l’interface web et commencer à travailler

## Prérequis

| Exigence | Remarques |
|----------|-----------|
| **Bun 1.x** (recommandé) ou **Node.js 22+** | L’environnement d’exécution principal est Bun |
| Espace disque | Base SQLite, coffre, espaces de travail des agents sous `data/` |
| Facultatif : Docker / Compose | Déploiement en conteneur |
| Facultatif : CLI de l’hôte | `claude`, `grok` ou `kimi` si vous voulez des fournisseurs locaux sans clé |

## Installation native

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
```

Ouvrez **http://localhost:3100** (port par défaut de `config/default.yaml` — **3100**, pas 3000).

Premier plan (journaux dans le terminal) :

```bash
./bin/eyas serve
```

### Installateur en une ligne

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
```

Non interactif : ajoutez `bash -s -- --yes`. Épingler une version : `--version 0.8.14-beta`.

Windows : `scripts/install.ps1`.

## Docker

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
```

Ouvrez **http://localhost:3100**. GPU + Ollama en option :

```bash
docker compose --profile gpu up -d
```

## Commandes de cycle de vie

| Commande | Rôle |
|----------|------|
| `eyas serve` | Serveur HTTP au premier plan |
| `eyas start` | Serveur en arrière-plan (fichier pid + journal) |
| `eyas stop` | Arrêter le processus d’arrière-plan |
| `eyas restart` | Arrêter puis démarrer |
| `eyas status` | Santé + PID |
| `eyas doctor` | Diagnostic de l’environnement local |
| `eyas version` | Chaîne de version |

Au démarrage, EYAS reconstruit automatiquement le **frontend** et la **documentation produit** s’ils manquent ou sont obsolètes (`bun run build:web`, `bun run docs:build`), sauf si vous définissez `EYAS_SKIP_WEB_BUILD=1` / `EYAS_SKIP_DOCS_BUILD=1`.

## Premier accès

| Étape | Résultat |
|-------|----------|
| Navigateur → `/setup` (automatique si la configuration est incomplète) | [Assistant de configuration](/docs/fr/setup-wizard/) |
| Après la configuration | Connexion avec le compte **propriétaire racine** que vous avez créé |
| Accueil | [Accueil](/docs/fr/daily/home/) |
| Documentation produit | Toujours à **`/docs/`** sur le même hôte/port |

## Où se trouvent les données

Sous le répertoire d’instance (`EYAS_HOME` ou le répertoire depuis lequel vous avez démarré) :

| Chemin | Contenu |
|--------|---------|
| `data/sqlite/` | Base SQLite principale (mode WAL) |
| `data/vault/` | Coffre markdown sémantique / procédural |
| `data/agents/<id>/` | Fichiers d’espace de travail par agent (IDENTITY, SOUL, …) |
| `data/backups/` | Archives de sauvegarde |
| `config/` | Valeurs YAML par défaut + surcharges locales |

## Suite

- [Assistant de configuration — chaque étape et chaque champ](/docs/fr/setup-wizard/)
- [Concepts fondamentaux](/docs/fr/concepts/)
- [Référence CLI](/docs/fr/deploy/cli/)
