---
title: Référence CLI
description: eyas serve/start/stop/doctor/config/module — pilotez le chemin d'installation que vous avez choisi.
---

**À quoi ça sert.** Le binaire `eyas` sert à démarrer, arrêter et diagnostiquer une installation native ou en conteneur, et à basculer des modules. Ce n'est pas un second produit — le même processus, le même `EYAS_HOME`. Une fois `bin/` dans le `PATH` (installateur natif) ou dans l'image (`docker compose exec`), ces commandes s'appliquent.

## Quand l'utiliser

- Démarrer au premier plan (`serve`) pour suivre les logs, ou en arrière-plan (`start` + pidfile).
- Lancer `doctor` avant un rapport de bug : une CLI manquante, quel binaire Claude Code tourne et s'il est connecté, si chaque CLI d'IA installée est une version que la vérification d'isolation d'EYAS a déjà prouvée, si son home EYAS est intact, si le sandbox de fichiers du noyau des CLI est disponible, où se trouve le coffre, quel embedder de mémoire le rappel utilise, racines d'import ignorées, port occupé, dist docs/web.
- Basculer un module sans éditer le YAML à la main.
- Chercher une version plus récente sur GitHub (famille `eyas update`, le même service que Paramètres → Mises à jour).

## Déroulement typique

1. Installez en [natif](/docs/fr/deploy/native/) ou avec [Docker](/docs/fr/deploy/docker/).
2. `eyas doctor` — corrigez ce qu'il signale.
3. `eyas serve` (premier plan) ou `eyas start` (arrière-plan). Confirmez avec `eyas status`.
4. Après une modification du YAML, `eyas config validate`, puis `eyas restart` : `default.yaml` et `local.yaml` ne sont lus qu'une fois, au démarrage.
5. `eyas stop` / `eyas restart` selon les besoins.

## Fonctions

| Commande | Description |
|----------|-------------|
| `eyas serve` | Serveur HTTP au premier plan |
| `eyas start` | En arrière-plan (pidfile + log) |
| `eyas stop` | Arrêter le processus d'arrière-plan |
| `eyas restart` | Redémarrer |
| `eyas status` | Santé + PID |
| `eyas doctor` | Diagnostic |
| `eyas version` | Version |
| `eyas config validate` | Valider le YAML |
| `eyas config reload` | Ne recharge **pas** `default.yaml` / `local.yaml` — redémarrez plutôt |
| `eyas module list` | Lister les modules |
| `eyas module enable/disable <id>` | Basculer un module |
| `eyas update check` | Chercher une version plus récente sur GitHub (`eyssen/eyas`) ; pour l'appliquer, la sauvegarde doit être prête |
| `eyas migrate …` | Migration unique v1→v2 des prompts/workspaces (`run` / `rollback` / `drop-cols`) — pas une opération quotidienne |

<h3 id="what-doctor-checks">Ce que vérifie <code>doctor</code></h3>

Chaque ligne est *ok* (✓), un *avertissement* (⚠) ou un *échec* (✗). Doctor se termine par le nombre de problèmes ou d'avertissements, et sort avec le statut 1 si une ligne a échoué ; des avertissements seuls ne changent pas le statut de sortie. Il ne fait que lire : il ne répare, ne copie et ne crée rien, et ne lance les CLI installées que pour lire leur version (`--version`) et, pour Claude Code, savoir s'il est connecté (`claude auth status`).

Une sélection de ses lignes :

| Ligne | Signification |
|-------|---------------|
| **Claude Code runtime** | Quel binaire Claude Code EYAS lance : la source (`EYAS_CLAUDE_CODE_BIN` / `claude on PATH` / `SDK-bundled`), son chemin et sa version, si sa version diffère de celle pour laquelle le client SDK d'EYAS a été construit (*version skew*), et **signed in** oui/non. Un `EYAS_CLAUDE_CODE_BIN` invalide est un échec. Le dernier recours embarqué dans le SDK, le décalage de version et un runtime non connecté sont des avertissements. Un `claude` sur le PATH masqué par la surcharge est affiché pour information (*not used by EYAS*). Voir [Fournisseurs — Runtime Claude Code](/docs/fr/ai/providers/#claude-code-runtime). |
| **CLI isolation (Claude Code)**, **CLI isolation (Grok CLI)**, **CLI isolation (Kimi Code CLI)** | Une ligne par fournisseur CLI. Elle montre le binaire qu'EYAS lance — comment il a été trouvé (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, `claude on PATH` / `grok on PATH` / `kimi on PATH`, ou `SDK-bundled`), son chemin et sa version — et si la vérification d'isolation d'EYAS avant chaque version a prouvé cette version : ok *isolation proven on this version (&lt;date&gt;)*. Elle avertit quand la version diffère de la dernière prouvée, quand le binaire ne rapporte aucune version, et quand la CLI n'a jamais été prouvée sur un hôte (Kimi Code CLI pour l'instant) ; l'avertissement précise qu'EYAS vérifie toujours chaque session au démarrage. Une CLI non installée affiche *not installed* (ok). Un `EYAS_*_BIN` invalide est un échec, avec le remède. Pour Grok CLI et Kimi Code CLI, la ligne vérifie aussi leur home EYAS, `<répertoire de données>/cli-homes/<fournisseur>` — voir le tableau suivant. Les dernières versions prouvées, et comment : [Sécurité et confidentialité — Comment l'isolation est prouvée](/docs/fr/admin/security-privacy/#how-isolation-is-proven). |
| **CLI sandbox** | Le mode `security.cliSandbox` et, pour chaque CLI installée (Claude Code, Grok CLI, Kimi Code CLI), si ses propres outils tournent dans le sandbox de fichiers du noyau : *active*, *unavailable* avec la raison et le remède (installer bubblewrap ; installer socat — Claude Code en a besoin en plus de bubblewrap ; autoriser les espaces de noms utilisateur non privilégiés, y compris dans un conteneur), ou *none* pour Kimi, qui n'a pas de sandbox noyau. Un sandbox manquant est un avertissement, pas un échec : avec `auto` la CLI tourne sans lui, avec `required` ses tours avec outils sont refusés. Voir [Fournisseurs — Sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox). |
| **Vault** | Le chemin du coffre de mémoire, `<répertoire de données>/vault` (ok). Avertit quand des notes d'un ancien `<home EYAS>/data/vault` seront copiées au prochain démarrage et — avec un remède — quand cet ancien dossier n'est plus utilisé parce que le coffre du répertoire de données contient déjà des notes. Doctor ne copie jamais rien lui-même. Voir [Configuration — Répertoire de données et coffre](/docs/fr/deploy/configuration/#data-directory-and-vault). |
| **SQLite** | Un auto-test en direct sur une base en mémoire jetable — votre fichier de données n'est jamais ouvert. Rapporte la version de SQLite, la présence de **FTS5** (échec sans lui : la recherche mémoire, la recherche de conversations et celle du coffre en ont toutes besoin) et le chargement de l'extension `sqlite-vec`, en insérant réellement une ligne et en lançant une requête du plus proche voisin plutôt qu'en demandant seulement la version. Une extension manquante est un avertissement avec le remède pour votre plateforme, pas un échec. |
| **Import roots** | Si `skills.importRoots` / `agent.importRoots` sont utilisables : ok quand rien n'est configuré ou que chaque racine est un dossier ordinaire ; un avertissement qui nomme le réglage et le dossier quand une racine se trouve dans, ou contient, les dossiers propres d'un autre assistant ou d'une app de notes (`~/.claude`, `~/.grok`, un coffre Obsidian, …) et n'est donc pas parcourue. Voir [Configuration — Racines supplémentaires de skills et de personas](/docs/fr/deploy/configuration/#extra-skill-and-persona-roots). |
| **Memory embedder** | Quel embedder utilise le rappel de mémoire. Ok : *multilingual-e5-small, local (weights in &lt;folder&gt;)* quand `@huggingface/transformers` est installé et que les poids sont dans `data/models`. Avertissement : l'embedder haché par radicaux (`stem5-fnv-384`) parce que `@huggingface/transformers` n'est pas installé — remède : lancez `bun add @huggingface/transformers` (ou `bun install`) dans le dossier EYAS, puis redémarrez. Avertissement : le paquet est installé mais les poids ne sont pas encore téléchargés — le prochain démarrage les télécharge (environ 130 Mo) depuis Hugging Face dans `data/models`, et d'ici là le rappel utilise le repli. Voir [Mémoire — La recherche vectorielle tourne toujours en local](/docs/fr/knowledge/memory/#vector-search-always-runs-locally). |
| **zstd** | Quelle implémentation de compression servira à l'enregistrement brut : celle native de Bun, celle de Node (22.15 ou plus récent), ou le repli WASM embarqué. Le repli est un avertissement — il marche, et il est environ deux fois plus lent. Aucune implémentation du tout est un échec, et EYAS n'enregistre alors rien plutôt que de remplir un tampon qu'il ne pourra jamais écrire. |

La vérification du home EYAS sur les lignes **CLI isolation (Grok CLI)** et **CLI isolation (Kimi Code CLI)** :

| Ce que doctor trouve dans `<répertoire de données>/cli-homes/<fournisseur>` | Résultat |
|-----------------------------------------------------------------------------|----------|
| Pas encore créé | ok — la première exécution le crée |
| Un lien symbolique, ou pas un dossier | échec — EYAS refuse d'y lancer la CLI. Remède : supprimez-le ; l'exécution suivante le recrée |
| Un dossier lisible par d'autres utilisateurs | avertissement — il contient la connexion de la CLI. Remède : `chmod 700 <dossier>` |
| Un fichier qu'EYAS y gère manque ou a changé depuis qu'EYAS l'a écrit (Grok : `config.toml`, `requirements.toml`, `trusted_folders.toml` ; Kimi : `mcp.json` et les réglages d'EYAS dans `config.toml`) | avertissement — EYAS réécrit ces fichiers avant l'exécution suivante ; un changement entre deux exécutions signifie donc que quelque chose d'autre modifie ce dossier |
| Tout est tel qu'EYAS l'a écrit | ok — *EYAS home and managed files intact* |

<h3 id="environment">Environnement</h3>

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_DATA_DIR`, `EYAS_WORKSPACES_DIR`, `EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`. Ce que font les variables de chemin et de runtime : voir [Configuration](/docs/fr/deploy/configuration/).

Le port par défaut est **3100**. Avec `EYAS_SKIP_DOCS_BUILD=1`, `/docs` renvoie 404 — voir [FAQ](/docs/fr/reference/faq/).

## Voir aussi

- [Configuration](/docs/fr/deploy/configuration/)
- [Natif](/docs/fr/deploy/native/)
- [Fournisseurs](/docs/fr/ai/providers/)
- [Sécurité et confidentialité](/docs/fr/admin/security-privacy/)
- [FAQ](/docs/fr/reference/faq/)
- [Paramètres — Mises à jour](/docs/fr/admin/settings/)
