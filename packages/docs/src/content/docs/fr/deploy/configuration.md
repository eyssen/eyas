---
title: Configuration
description: YAML par défaut, overlays locaux, précédence env — après avoir choisi un chemin d’install.
---

**À quoi ça sert.** La configuration te permet de changer l’adresse d’écoute, les modules, l’autonomie, la capture mémoire et les commandes de vérification des agents sans rien reconstruire. Modifie `local.yaml` et les variables d’environnement `EYAS_*` — pas `config/default.yaml` si tu peux l’éviter (les mises à jour écrasent les valeurs livrées). Ce chapitre suppose que tu as déjà choisi [natif](/docs/fr/deploy/native/), [Docker](/docs/fr/deploy/docker/) ou [Kubernetes](/docs/fr/deploy/kubernetes/).

## Quand l'utiliser {#when-to-use-it}

- Hôte/port, niveau de log, désactiver un module.
- Couper le **capture par appel modèle** (`memory.capture.enabled: false`) — défaut on. Cela n’arrête **pas** la capture brute : `memory.l0.enabled` est un interrupteur distinct, lui aussi on par défaut.
- Couper la **capture brute** (`memory.l0.enabled: false`) si tu ne veux pas d’une seconde copie mot pour mot de chaque message gardée sur le disque.
- Dossiers extra de skills ou personas (`skills.importRoots` / `agent.importRoots`) depuis des dossiers ordinaires — les dossiers propres d’un autre assistant sont ignorés.
- `agent.verifyCommands` pour qu’une course de code ne soit pas « finie » avant les tests.
- Plusieurs checkouts Odoo via `EYAS_ODOO_SOURCES_JSON`.
- Donner au modèle la bonne heure locale (`i18n.timezone`).
- Déplacer le répertoire de données (`EYAS_DATA_DIR`) ou les espaces de travail des conversations (`EYAS_WORKSPACES_DIR`), ou épingler le binaire Claude Code, Grok ou Kimi (`EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`).
- Protéger d’autres magasins de mémoire contre les modèles (`security.foreignMemoryPaths`), ou exiger le sandbox de fichiers du noyau pour les propres outils des CLI (`security.cliSandbox: required`).
- Donner aux tours CLI plus ou moins de temps avant qu’ils soient arrêtés pour silence (`model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`).

## Déroulement typique {#typical-workflow}

1. Copie ou crée `local.yaml` à côté des valeurs livrées (ou définis `EYAS_HOME` pour qu’il vive avec cette instance).
2. Ne change que les clés nécessaires. Valide : `eyas config validate`.
3. Redémarre (`eyas restart`). EYAS lit `default.yaml` et `local.yaml` une seule fois, au démarrage ; `eyas config reload` ne recharge **pas** ces deux fichiers. Les fichiers sous `config/personality/` qui le précisent (par exemple `privacy.yaml`) sont pris en compte sans redémarrage.
4. Vérifie dans **Paramètres** et avec `eyas doctor`.

## Fonctions {#features}

| Fichier | Rôle |
|---------|------|
| `config/default.yaml` | Valeurs livrées |
| `local.yaml` | Surcouche fusionnée |
| `.env` | Secrets optionnels (ne jamais les committer) |

Précédence : flags CLI → environnement `EYAS_*` → YAML local → YAML par défaut.

Exemples de clés dans default.yaml : `server.host/port`, `database.path`, `log.level`, `i18n.timezone`, `modules.disabled`, `autonomy.identitySelfUpdate`, `security.foreignMemoryPaths`, `security.cliSandbox`, `model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`, `memory.capture.enabled`, `memory.l0.enabled`.

### Fuseau horaire de l’horloge du modèle {#time-zone-of-the-models-clock}

```yaml
i18n:
  timezone: "America/New_York"   # nom IANA ; non défini = le fuseau propre du serveur
```

Chaque tour donne au modèle la date et l’heure courantes. `i18n.timezone` fixe le fuseau utilisé : un nom IANA comme `America/New_York`, `Europe/Berlin` ou `UTC`. Non défini (le défaut), c’est le fuseau propre du serveur — la variable d’environnement `TZ`, sinon le réglage du système d’exploitation. Les conteneurs Docker tournent en général en UTC sauf si `TZ` est défini.

La date et l’heure viennent toujours du même fuseau, et la ligne de l’heure nomme le fuseau et son décalage UTC, par exemple `Current time: 23:30 (America/New_York, UTC-04:00)`. Les versions précédentes donnaient l’heure dans un fuseau fixe d’Europe centrale alors que la date venait de l’UTC : près de minuit, les deux pouvaient se contredire, et toute install hors de ce fuseau recevait une heure locale fausse.

Une valeur invalide arrête le démarrage avec une erreur de configuration : *i18n.timezone: Unknown time zone — use an IANA name such as Europe/Berlin or UTC*. Mets-la dans `local.yaml` ; elle s’applique après un redémarrage.

### Répertoire de données et coffre {#data-directory-and-vault}

Le répertoire de données contient la base, le coffre de mémoire, les fichiers d’agent, les sauvegardes et le reste de l’état de l’instance. C’est `<home EYAS>/data` par défaut, ou le dossier nommé par `EYAS_DATA_DIR`.

Le coffre de mémoire vit toujours dans `<répertoire de données>/vault` et n’a pas de réglage de chemin propre : pour le déplacer, déplace le répertoire de données avec `EYAS_DATA_DIR`. (L’ancienne clé `memory.vault.path` de `config/personality/memory.yaml` n’a jamais rien fait et a été supprimée.)

Les installs sans `EYAS_DATA_DIR` — dont l’image Docker et le chart Helm livrés, qui montent le `/app/data` par défaut — gardent le coffre exactement où il était. Les versions précédentes gardaient le coffre dans `<home EYAS>/data/vault` même quand `EYAS_DATA_DIR` pointait ailleurs. Sur une install qui définit `EYAS_DATA_DIR`, le premier démarrage après la mise à jour copie l’ancien coffre une fois, mais seulement tant que le coffre du répertoire de données ne contient aucune note `.md` et que l’ancien `<home EYAS>/data/vault` contient des notes :

- Il **copie, sans jamais déplacer** : l’ancien dossier reste intact, le contenu des fichiers et leurs dates de modification sont conservés, et rien de ce qui est déjà dans le nouveau coffre n’est écrasé. Un avertissement dans le log dit que la copie a eu lieu et que l’ancien dossier peut être supprimé une fois la copie vérifiée.
- Si la copie échoue (par exemple, le répertoire de données n’est pas accessible en écriture), le nouveau coffre reste vide, une erreur avec le remède est loguée, et la copie est retentée au démarrage suivant.
- Si les deux dossiers contiennent déjà des notes, rien n’est copié ni fusionné. EYAS n’utilise que `<répertoire de données>/vault` et logue un avertissement à chaque démarrage tant que l’ancien dossier n’est pas retiré ; copie à la main dans le coffre toute note dont tu as encore besoin.

`eyas doctor` affiche le chemin du coffre sur sa ligne **Vault** et avertit en cas d’ancien coffre à côté d’un répertoire de données déplacé — voir [CLI](/docs/fr/deploy/cli/#what-doctor-checks). La [Sauvegarde](/docs/fr/admin/backup/) intégrée archive `<home EYAS>/data` ; si `EYAS_DATA_DIR` pointe ailleurs, inclus ce dossier dans tes propres sauvegardes.

### Espaces de travail des conversations {#conversation-workspaces}

Une conversation sans dossiers propres travaille dans son propre **espace de travail EYAS** (voir [Conversations — Dossiers](/docs/fr/daily/conversations/#working-folders)). Les espaces de travail ne sont jamais placés dans un checkout git, car un modèle CLI (Claude Code, Grok, Kimi) lancé dans un dépôt git traite ce dépôt comme son projet : il charge ses fichiers d’instructions, son état git, ses règles de permission et sa mémoire par projet. L’emplacement des espaces de travail est, dans l’ordre :

1. `EYAS_WORKSPACES_DIR`, si défini. Utilise un chemin absolu.
2. Sinon `<répertoire de données>/workspaces`, quand le répertoire de données n’est pas dans un checkout git (images Docker et Kubernetes, installs packagées — inchangé là).
3. Sinon (une install depuis les sources lancée depuis un clone git), un dossier par instance dans le répertoire de données d’application de ton utilisateur :
   - macOS : `~/Library/Application Support/eyas/<instance>/workspaces`
   - Linux : `$XDG_DATA_HOME/eyas/<instance>/workspaces`, défaut `~/.local/share/eyas/<instance>/workspaces`
   - Windows : `%LOCALAPPDATA%\eyas\<instance>\workspaces`

`<instance>` est le nom du dossier home d’EYAS plus un court hash du répertoire de données, pour que deux instances sur une même machine (par exemple une instance dev et une instance live) ne partagent jamais leurs espaces de travail.

**Mise à jour (automatique, une fois).** Quand l’emplacement a changé — un répertoire de données dans un checkout git, ou `EYAS_WORKSPACES_DIR` qui pointe ailleurs — le premier démarrage déplace les espaces de travail créés automatiquement de `<répertoire de données>/workspaces` vers le nouvel emplacement et fait pointer dessus les conversations qui les utilisaient. Les dossiers que tu as choisis toi-même ne sont jamais déplacés ni modifiés. Si un dossier du même nom existe déjà au nouvel emplacement, l’ancien reste où il est, cette conversation continue de l’utiliser, et un avertissement est logué. Redémarrer à nouveau ne change rien.

Quand l’emplacement des espaces de travail est hors du répertoire de données, la sauvegarde des données ne l’inclut pas ; les fichiers produits par les agents restent conservés, car ils sont copiés dans Documents comme pièces jointes de la conversation. Voir [Sauvegarde](/docs/fr/admin/backup/).

### Mémoire hors d’EYAS {#memory-outside-eyas}

```yaml
security:
  foreignMemoryPaths: []   # chemins absolus supplémentaires que les modèles ne peuvent ni lire ni écrire
  cliSandbox: auto         # auto | required
```

EYAS ne lit et n’écrit la mémoire qu’à travers ses propres magasins. `security.foreignMemoryPaths` est appliqué : il est lu au démarrage, et le portail de sécurité y refuse les lectures et les écritures de tout modèle. `security.cliSandbox` décide de ce qui se passe quand le sandbox de fichiers du noyau pour les propres outils des CLI n’est pas disponible.

| Clé | Défaut | Signification |
|-----|--------|---------------|
| `security.foreignMemoryPaths` | **`[]`** | Magasins supplémentaires que les modèles ne peuvent ni lire ni écrire, en plus de la liste intégrée ci-dessous. Chemins absolus ; un `~` initial est développé ; une chaîne vide est refusée. Un dossier listé est protégé avec tout ce qu’il contient. Les entrées qui ne sont pas des chemins absolus sont ignorées, avec un avertissement dans le log. Lu au démarrage — nécessite un redémarrage. La même liste bloque aussi les serveurs MCP qui y pointent, les Dossiers de conversation qui s’y trouvent et les racines d’import qui s’y trouvent, et elle fait partie de la liste d’interdiction du sandbox noyau. **Événements de sécurité → Mémoire hors d’EYAS** liste vos entrées et marque celles qui manquent ou sont ignorées. |
| `security.cliSandbox` | **`auto`** | Le sandbox de fichiers du noyau (macOS Seatbelt, Linux bubblewrap) pour le shell de Claude Code et les propres outils de Grok CLI. `auto` : utilisé là où il est disponible ; ailleurs, la CLI exécute quand même ses outils et le chat affiche un avis unique par conversation, et une commande Claude Code qui demande à s’exécuter hors du sandbox attend toujours l’approbation d’une personne. `required` : un tour CLI avec outils est refusé avant le démarrage de la CLI quand aucun sandbox n’est disponible (Kimi Code CLI n’en a pas : ses tours avec outils sont donc toujours refusés), et Claude Code ne peut jamais exécuter une commande hors de lui. Il n’y a pas de `off` ; toute autre valeur est une erreur de configuration et EYAS ne démarre pas. Les appels d’arrière-plan sans outils ne sont jamais refusés faute de sandbox. Voir [Fournisseurs — Sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox). |

Ce que la politique protège sans aucun réglage :

- l’état, dans le dossier home, des autres assistants : `~/.claude` et `~/.claude.json` (Claude Code), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium` (Windsurf), `~/.agents` et `~/.config/agents` (compétences partagées), `~/.copilot` ;
- les dossiers de configuration, de données et d’état d’OpenCode (emplacements XDG et leurs replis `~/.config`, `~/.local/share` et `~/.local/state`) ;
- les réglages propres de l’application Obsidian, et chaque coffre Obsidian, trouvé par son dossier `.obsidian` ou par la liste de coffres d’Obsidian (un coffre créé pendant qu’EYAS tourne est pris en compte en 30 secondes environ) ;
- tout dossier nommé `ai-memory`, et tout dossier `memory` ou `memories` sous un dossier caché d’outil (`.claude`, `.grok`, `.codex`, `.gemini`, `.kimi`, `.cursor`, `.codeium`, `.windsurf`), y compris dans un projet ;
- les mêmes dossiers cachés dans les dossiers home des autres utilisateurs.

Les fichiers de projet ordinaires restent utilisables : `.claude/settings.json` et `.claude/agents` d’un projet, `CLAUDE.md`, `docs/MEMORY.md`.

Le dossier de données propre d’EYAS est privé lui aussi. Les modèles ne peuvent utiliser que les espaces de travail des conversations — chaque conversation seulement le sien, y compris quand `EYAS_WORKSPACES_DIR` les place hors du dossier de données —, les projets Studio (`data/studio`) et les téléchargements du navigateur (`data/browser/downloads`). Le coffre, la base, les clés, le profil du navigateur et les dossiers de connexion CLI propres à EYAS (`data/cli-homes`) sont réservés à EYAS ; le fichier de base est protégé même quand `database.path` pointe hors du dossier de données. Les liens symboliques ne contournent pas cela : un chemin est jugé tel qu’il est écrit et là où il mène réellement.

**Ce qui est appliqué.** Chaque chemin de chaque appel d’outil que voit le portail de sécurité est vérifié contre cette politique — les outils EYAS sur les fournisseurs API, les outils EYAS que Grok et Kimi appellent via le pont d’outils, chaque appel d’outil pour lequel Claude Code demande une permission, les outils propres de Claude Code (via une vérification qui tourne avant chacun d’eux), et chaque demande de permission ou de fichier de Grok/Kimi. Un chemin protégé est refusé aussitôt, en lecture comme en écriture : aucun juge IA, aucune demande d’approbation, aucune autorisation ne peut l’ouvrir, et le refus ne compte pas dans le verrouillage après 3 refus. Cela tient aussi quand le portail de sécurité est désactivé. Chaque refus donne une ligne sous **Événements de sécurité**. Voir [Sécurité et confidentialité — Mémoire hors d’EYAS](/docs/fr/admin/security-privacy/#memory-outside-eyas).

La même politique refuse aussi d’enregistrer un tel dossier comme Dossier de conversation ou répertoire de travail de projet (voir [Conversations — Dossiers](/docs/fr/daily/conversations/#working-folders)), bloque les serveurs MCP qui y pointent (voir [MCP](/docs/fr/ai/mcp/#memory-store-servers-are-blocked)) et ignore les racines d’import qui s’y trouvent (ci-dessous). Les outils fichier propres d’EYAS refusent un lien symbolique dans le dossier de travail qui pointe hors de lui — même quand sa cible n’existe pas encore.

**La couche noyau.** Les cibles shell que le texte de la commande ne montre pas, et les lectures des CLI qui ne demandent jamais à EYAS, sont couvertes par le sandbox de fichiers du noyau là où il tourne (le shell de Claude Code, les propres outils de Grok CLI). Sous Linux, il a besoin de bubblewrap (`bwrap`) — plus `socat` pour Claude Code — et des espaces de noms utilisateur non privilégiés ; l’image EYAS ne les inclut pas (bubblewrap est sous LGPL ; l’installer est le choix de l’opérateur). `eyas doctor` affiche l’état sur sa ligne **CLI sandbox**. Kimi Code CLI n’a pas de sandbox noyau : ses propres outils read, grep et glob restent donc couverts seulement là où EYAS les voit.

### Fournisseurs CLI : homes et environnement {#cli-providers-homes-and-environment}

EYAS démarre les outils IA en ligne de commande avec un court environnement en liste blanche, jamais avec l’environnement complet du serveur :

| CLI | Home | Ce qu’elle reçoit |
|-----|------|-------------------|
| Claude Code | Le `HOME` de l’hôte (elle ne partage que la connexion) | `PATH`, locale et fuseau horaire, proxys et bundles CA, `HOME`, les variables de connexion Anthropic / Claude OAuth / Bedrock / Vertex, plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` et `DISABLE_AUTOUPDATER=1` |
| Grok CLI | `<répertoire de données>/cli-homes/grok-cli` | `PATH`, locale et fuseau horaire, `TMPDIR`, `TERM`, `USER`, `LOGNAME`, `SHELL`, variables de proxy et de bundle CA, et les interrupteurs d’isolation d’EYAS |
| Kimi Code CLI | `<répertoire de données>/cli-homes/kimi-cli` | Comme Grok |
| OpenCode | `<répertoire de données>/cli-homes/opencode` | Voir [OpenCode](/docs/fr/automation/opencode/) |

Non transmis : les clés API des autres fournisseurs, les secrets EYAS, un `XAI_API_KEY`, `CLAUDE_CONFIG_DIR`, et tout autre réglage `CLAUDE_CODE_*`, `GROK_*`, `KIMI_*` ou `XDG_*` du serveur. Les homes propres à EYAS sous `data/cli-homes` contiennent les connexions de Grok et Kimi pour EYAS et sont protégés contre tous les modèles. Claude Code et Grok ne se mettent pas à jour eux-mêmes pendant qu’EYAS les lance ; mets les CLI à jour toi-même. Rien de tout cela n’a de réglage. Voir [Fournisseurs](/docs/fr/ai/providers/#claude-code-isolation).

### Délais des tours CLI {#cli-turn-timeouts}

```yaml
model:
  cli:
    idleTimeoutMs: 600000     # 10 min de silence quand aucun outil ne tourne
    toolTimeoutMs: 1200000    # 20 min de silence pendant qu’un outil tourne
```

Les tours de Claude Code, Grok CLI et Kimi Code CLI ne sont pas arrêtés au bout d’un temps fixe. Un tour CLI n’est arrêté que quand la CLI se tait : `idleTimeoutMs` sans message quand aucun outil ne tourne, ou `toolTimeoutMs` sans message pendant qu’un outil tourne. Tout message de la CLI — texte diffusé, un outil qui démarre ou se termine, une demande de permission — relance le compteur, et la durée du tour entier n’a pas de limite ; **Arrêter** termine toujours un tour à tout moment, et le balayage des exécutions bloquées s’applique toujours. Un tour arrêté pour silence signale un délai dépassé (timeout), qui compte comme réessayable : la passerelle peut le réessayer une fois, ou basculer, seulement quand rien n’a encore été diffusé, et une exécution d’arrière-plan peut être relancée par le planificateur de nouvelles tentatives automatiques.

Les deux valeurs sont en millisecondes et doivent être des entiers positifs ; les valeurs nulles, négatives, fractionnaires ou textuelles sont refusées au chargement de la configuration. Elles sont lues au début de chaque tour CLI depuis la configuration en cours : une valeur modifiée s’applique donc après un redémarrage d’EYAS. Garde `toolTimeoutMs` au-dessus de 15 minutes pour que les spécialistes lancés avec `run_specialist` ne soient pas coupés.

### Capture de mémoire durable {#durable-memory-capture}

```yaml
memory:
  capture:
    enabled: true          # false = aucune note de coffre après le tour
    minUserChars: 40
    maxPerConversation: 20
    maxInputChars: 4000
```

| Clé | Défaut | Signification |
|-----|--------|---------------|
| `memory.capture.enabled` | **`true`** | Après une exécution éligible, un petit appel au modèle d’arrière-plan d’EYAS décide si elle contient un fait durable et écrit jusqu’à deux notes de coffre — jamais dans le chemin critique de la réponse. Il tourne sur toutes les façons dont EYAS exécute un modèle : tours de chat, exécutions de cartes en arrière-plan, exécutions de spécialiste et déléguées (étapes de pipeline comprises), tâches A2A, membres d’équipe et réponses de canal. `false` l’arrête sur tous ; la capture brute ci-dessous est un interrupteur distinct. |
| `memory.capture.minUserChars` | **`40`** | Un message plus court (en caractères) ne déclenche jamais d’appel modèle. Pour un message de canal ou une tâche A2A, seuls les mots de l’expéditeur comptent : un court « ok » sur un canal ne déclenche donc aucun appel. |
| `memory.capture.maxPerConversation` | **`20`** | Plafond d’appels modèle de capture par conversation. Un spécialiste ou un membre d’équipe tourne dans sa propre sous-conversation et a donc son propre plafond ; une conversation de canal partage un seul plafond entre tous ses messages. |
| `memory.capture.maxInputChars` | **`4000`** | Ton message et la réponse sont chacun coupés à ce nombre de caractères avant que le modèle de capture les voie. |

L’appel tourne sur un fournisseur API ou une CLI capable de s’isoler, jamais sur une qui ne le peut pas ; sans modèle éligible, la capture enregistre un saut et ne fait aucun appel. Une exécution qui n’a rien répondu n’écrit aucune ligne de capture. **Coût :** chaque spécialiste, membre d’équipe et réponse de canal dont l’instruction fait au moins `minUserChars` caractères peut désormais coûter un appel de modèle d’arrière-plan supplémentaire. Qui a écrit le message décide comment il est lu : une tâche déléguée, une consigne d’équipe ou l’objectif d’une carte est une instruction de tâche qu’un agent a pu écrire, et un message de canal ou une tâche A2A sont les mots d’un tiers — qui ne créent jamais de note sur qui vous êtes ni sur la façon de travailler, et dont les notes sont stockées avec la confiance *peer*. Le registre `memory_capture_runs` reçoit une colonne `entry_path` (`interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team`, `channel` ; vide sur les lignes écrites avant cette version), ajoutée automatiquement. Il n’y a pas de nouveau réglage. Voir [Mémoire — Le capture est activé par défaut](/docs/fr/knowledge/memory/#capture-is-on-by-default) et [FAQ](/docs/fr/reference/faq/).

### Capture brute {#raw-capture}

```yaml
memory:
  engine: legacy           # ne conditionne que l’extraction déterministe ; le rappel est identique dans les deux cas
  l0:
    enabled: true          # false = aucune copie brute conservée
    captureToolResults: false
    captureThinking: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

Ce n’est **pas** le même interrupteur que `memory.capture` ci-dessus. Le capture écrit des notes de coffre et coûte un petit appel modèle ; la capture brute garde une **seconde copie mot pour mot de chaque message persisté** — compressée et adressée par contenu — **sans appel modèle et sans coût d’API**. Elle est on par défaut.

| Clé | Défaut | Signification |
|-----|--------|---------------|
| `memory.l0.enabled` | **`true`** | Interrupteur maître de la capture brute. `false` n’enregistre rien et ne met rien en tampon. |
| `memory.l0.extractInLegacy` | **`true`** | Lance la passe déterministe (faits, résumé, entités, thèmes, importance) après chaque écriture tant que `engine` vaut encore `legacy`. `false` garde le texte brut et n’en dérive rien. |
| `memory.engine` | **`legacy`** | `legacy` ou `v2`. Il décide seulement si l’extraction déterministe des faits tourne : `v2` extrait toujours ; `legacy` extrait tant que `memory.l0.extractInLegacy` est activé (le défaut). Le rappel est toujours le rappel par couches, quelle que soit la valeur. |
| `memory.l0.chunkTokens` | **`8000`** | Déclencheur d’écriture par taille : le tampon d’une conversation est écrit dès que son nombre de tokens estimé atteint cette valeur. |
| `memory.l0.idleFlushMinutes` | **`30`** | Déclencheur d’écriture par inactivité : un balayage à la minute écrit tout tampon resté inactif aussi longtemps. Fermer la conversation et arrêter EYAS écrivent aussi, donc un redémarrage propre ne perd rien. |
| `memory.l0.captureToolResults` | **`false`** | Capturer aussi la sortie de chaque outil qu’appelle une exécution d’agent, quel que soit le modèle : les propres outils d’EYAS, les outils EYAS qu’une CLI appelle via le pont, les outils intégrés de Claude Code, Grok et Kimi, les outils qu’OpenCode exécute dans une tâche `opencode_run` et la sortie du panneau terminal d’OpenCode. Seuls les appels qui ont tourné sont enregistrés (ceux en échec marqués comme erreurs) ; les appels refusés, ignorés ou en attente d’approbation, les résultats vides et les répétitions ne le sont pas, pas plus que les appels d’outils hors d’une exécution d’agent. **Lis le paragraphe suivant avant de l’activer.** |
| `memory.l0.captureThinking` | **`false`** | Garder le raisonnement (« thinking ») de tout modèle qui en rapporte un, une entrée par appel au modèle. Audit seulement : jamais transformé en faits, jamais rappelé. Stocké mot pour mot et non expurgé ; un avertissement est affiché au démarrage tant qu’il est activé. |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Plafond en octets de l’enregistrement de ce qu’un appel d’outil capturé a renvoyé — nom de l’outil, sortie, indicateur d’erreur, issue et qui l’a exécuté —, coupé sur une frontière UTF-8 avec un marqueur de troncature visible. Les arguments de l’appel n’y comptent pas : ils sont gardés à côté de l’enregistrement, coupés à leurs 2 048 premiers caractères. Résultats d’outil seulement ; les messages ne sont pas plafonnés. |

`captureToolResults` et `captureThinking` sont lus au début de chaque exécution depuis la configuration en cours ; comme le reste de `local.yaml`, une modification s’applique après un redémarrage d’EYAS.

**`captureToolResults` est off pour une raison.** Un résultat d’outil capturé, c’est la sortie entière, mot pour mot et non expurgée, plus les 2 048 premiers caractères des arguments de l’appel : la sortie standard de `run_command`, le contenu lu par `read_file` et un code à usage unique `browser_totp` encore valide atterrissent tous en texte clair dans la couche brute. Rien ne les masque et rien ne les chiffre au repos — la compression n’est pas de la confidentialité. Le drapeau activé, chaque démarrage logue un avertissement à ce sujet. Ne l’active que là où c’est acceptable pour cette machine. Un appel enregistré n’est jamais rappelé ni cité dans un prompt — ni dans la mémoire ajoutée à un tour, ni via `memory_search`, `memory_expand`, la recherche de la page Mémoire ou le résumé d’une conversation. Seule sa sortie oriente les thèmes et les noms qu’EYAS extrait de la conversation ; les arguments sont gardés à côté de l’enregistrement comme provenance et ne sont jamais indexés ni extraits (voir [Mémoire — Les résultats d’outil ne sont pas enregistrés](/docs/fr/knowledge/memory/#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).

**Aucune page n’affiche ces lignes.** Il n’y a ni page dans l’UI, ni endpoint d’API, ni commande `eyas memory` pour l’enregistrement brut. L’assistant ne l’atteint que par le rappel — les résumés et faits qui en sont dérivés, et les lignes brutes ouvertes avec `memory_expand`. La carte **Moteur de rappel** de **Mémoire → Aperçu** montre si l’enregistrement brut, la capture des sorties d’outils et la capture du raisonnement sont réellement actifs.

**La capture brute grossit et rien ne l’élague.** Ni réglage de rétention, ni tâche de nettoyage dans cette version ; un message capturé coûte environ 5 Ko sur le disque, index compris. Si tu préfères ne pas payer ça tout de suite, mets `memory.l0.enabled: false`. Voir [Mémoire](/docs/fr/knowledge/memory/).

### Index de mémoire et rappel {#memory-index-and-recall}

| Clé | Défaut | Signification |
|-----|--------|---------------|
| `memory.index.budgetChars` | **`2400`** | Caractères de tout le bloc de mémoire rappelée par tour (≈ 600 tokens), cadre compris : notes permanentes, notes récupérées pour le message et correspondances en texte intégral ensemble. La taille est prévue pour un modèle à fenêtre de contexte de 100k tokens et suit la fenêtre du modèle qui répond (jusqu’à 2,5× à partir de 250k tokens, moins en dessous d’environ 29k tokens) — aussi pour une tâche OpenCode (`opencode_run`), dimensionnée pour la fenêtre qu’OpenCode indique pour le modèle choisi, ou exactement cette valeur quand cette fenêtre est inconnue. Les notes permanentes laissent jusqu’à la moitié du bloc à ce qui a été récupéré. Les notes qui ne tiennent pas sont résumées dans une ligne finale (*… N more notes not shown*) et restent accessibles par la recherche mémoire. Montez-le quand vos notes `user` et `feedback` n’y tiennent plus. Nécessite un redémarrage. |
| `memory.recall.includeSecrets` | **`false`** | Si les notes, lignes épisodiques et compétences taguées `contains-secrets` (des fichiers où l’importateur a trouvé des identifiants, stockés tels quels) — et les lignes brutes, faits et résumés qui en sont dérivés — atteignent le modèle via le rappel, `memory_search` et `memory_expand`, et reçoivent des vecteurs de recherche. Désactivé, ils sont stockés et visibles sur la page Mémoire, mais n’atteignent jamais un prompt. Nécessite un redémarrage. |

Le rappel — ce qu’il contient, comment sa requête est construite et comment il atteint chaque modèle — est décrit sous [Mémoire — Comment le rappel atteint le modèle](/docs/fr/knowledge/memory/#how-recall-reaches-the-model). La carte **Moteur de rappel** de **Mémoire → Aperçu** montre le budget et l’interrupteur `includeSecrets` avec lesquels EYAS tourne (voir [Mémoire — Moteur de rappel](/docs/fr/knowledge/memory/#recall-engine)).

**Supprimé : `memory.relatedWork.*`.** Le bloc séparé *Travail antérieur lié* (`enabled`, `minQueryChars`, `maxHits`, `budgetChars`, `maxSnippetChars`) a disparu ; le travail antérieur arrive désormais dans le bloc de mémoire rappelée, dimensionné par `memory.index.budgetChars`. Un `local.yaml` existant qui définit encore ces clés continue de se charger ; elles sont ignorées.

**Note de mise à jour.** Les versions précédentes livraient `memory.index.budgetChars: 8000` dans `config/default.yaml` ; la valeur livrée est maintenant `2400`, comme le défaut intégré. Pour garder l’ancienne taille, ajoute ceci à `config/local.yaml` et redémarre :

```yaml
memory:
  index:
    budgetChars: 8000
```

### Durabilité de la base de données {#database-durability}

Depuis la 0.8.23-beta, chaque connexion à la base EYAS exécute `PRAGMA synchronous = NORMAL` au lieu du `FULL` par défaut de SQLite. Combiné au WAL, qu’EYAS a toujours utilisé, cela veut dire :

- Un crash de **processus** — EYAS tué, une erreur non gérée — ne perd rien de ce qui est déjà commité.
- Un crash de l’**OS** ou une coupure de courant à l’instant d’un commit peut perdre la dernière transaction.

C’est le compromis WAL standard, et il vaut pour **tous** les modules, pas seulement la mémoire. Si ton instance porte du travail que tu ne peux pas ressaisir, c’est la [Sauvegarde](/docs/fr/admin/backup/) qui fait la durabilité, pas le mode de commit.

### Racines supplémentaires de skills et de personas {#extra-skill-and-persona-roots}

```yaml
skills:
  importRoots: []          # dossiers markdown de skills supplémentaires ; vide = aucun
agent:
  importRoots: []          # dossiers markdown de personas supplémentaires ; vide = aucun
```

La liste livrée est vide. Chemins dans `local.yaml`, jamais dans le code source du produit. Ces racines sont lues à **chaque démarrage** : ce sont donc une source vivante — pour des dossiers ordinaires seulement (par exemple un dossier d’équipe comme `/opt/team-skills`). Les skills importées gagnent contre les copies bundled du même identifiant. Voir [Compétences](/docs/fr/automation/skills/#import-roots).

**Racines ignorées par EYAS.** Une racine qui se trouve dans, ou qui contient, les dossiers propres d’un autre assistant ou d’une app de notes n’est pas parcourue :

- les dossiers home d’autres outils : `~/.claude` (donc aussi `~/.claude/skills`, `~/.claude/agents` et `~/.claude/plugins/…`), `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot`, et les dossiers de skills partagés `~/.agents` et `~/.config/agents` ;
- les dossiers de configuration, de données et d’état d’OpenCode ;
- les réglages de l’app Obsidian et tout coffre Obsidian ;
- les dossiers listés dans `security.foreignMemoryPaths` ;
- les homes CLI propres à EYAS (`data/cli-homes`).

Une racine comme ton dossier home entier est ignorée aussi, parce qu’elle contient ces dossiers. Pour chaque racine ignorée, le serveur logue un avertissement au démarrage, par exemple *skills.importRoots: /Users/me/.claude/skills is inside Claude Code (~/.claude) — not scanned; import these files once with Settings → System → Data portability → Import data*, et `eyas doctor` affiche un avertissement **Import roots** qui nomme le réglage et le dossier.

**Que faire.** Les skills et agents déjà importés depuis un tel dossier restent dans EYAS ; ils cessent seulement de s’en rafraîchir. Pour faire entrer ce contenu, ou le rafraîchir, lance une fois un [Import de données](/docs/fr/admin/data-port/) du dossier — il est copié dans EYAS avec son origine enregistrée —, puis retire l’entrée de `local.yaml`.

**Les personas modifiés dans EYAS ne sont jamais écrasés** par leur fichier `agent.importRoots`. Un fichier crée son agent au premier démarrage, puis ne le met à jour que tant que le nom, le rôle, la description, le prompt système et les outils de l’agent sont exactement tels que le dernier import les a laissés ; voir [Agents — Configurer](/docs/fr/agents/configure/#imported-personas).

## Vérification des agents et variables d’environnement {#agent-verify-and-environment-variables}

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  # Vérifications déterministes après une exécution d’arrière-plan (vide = désactivé)
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /absolute/path/to/repo   # défaut : process.cwd()
```

| Clé | Signification |
|-----|---------------|
| `agent.verifyCommands` | Liste de `{ name, command, args?, timeoutMs? }` — **sans shell** ; un échec rouvre l’agent avec le résumé de l’erreur |
| `agent.verifyCwd` | Répertoire de travail de ces commandes |
| `EYAS_ODOO_SOURCE_PATHS` | Racines locales de checkouts Odoo séparées par deux-points ou point-virgule, pour les outils légers `odoo_search_*` et l’amorçage optionnel des sources |
| `EYAS_ODOO_SOURCES_JSON` | Amorçage multiversion recommandé : tableau JSON de `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` — crée au démarrage des **Sources de recherche** inactives si ces chemins ne sont pas encore enregistrés |
| `EYAS_AUTO_FAILOVER` | Remplit, sur demande, les fallbacks vides des niveaux de routage avec un second fournisseur actif |
| `EYAS_BROWSER_USER_DATA_DIR` | Profil Chromium propre à EYAS pour `browser_*` headless (défaut `data/browser/profile`). Les profils Chrome/Edge quotidiens sont refusés |
| `EYAS_AGENT_BROWSER_BIN` | Chemin optionnel de la CLI agent-browser de Vercel. Vide = PATH. Défini mais absent = fail-closed (aucun repli sur le PATH). Profil : `data/browser/agent-browser/profile` |
| `EYAS_DATA_DIR` | Répertoire de données (base, coffre, fichiers d’agent, …). Défaut `<home EYAS>/data`. Voir [Répertoire de données et coffre](#data-directory-and-vault) |
| `EYAS_WORKSPACES_DIR` | Chemin absolu des espaces de travail des conversations. Défaut : voir [Espaces de travail des conversations](#conversation-workspaces) |
| `EYAS_CLAUDE_CODE_BIN` | Chemin absolu de l’exécutable `claude` que lance EYAS. Vide = `claude` sur le PATH, puis la copie embarquée dans le SDK (doctor avertit). Défini mais invalide = fail-closed (aucun repli). Voir [Fournisseurs — Runtime Claude Code](/docs/fr/ai/providers/#claude-code-runtime) |
| `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` | Chemin absolu de l’exécutable `grok` / `kimi` que lance EYAS. Vide = le binaire sur le PATH. Défini mais invalide = fail-closed : le fournisseur n’est pas enregistré. Voir [Fournisseurs — Grok CLI et Kimi Code CLI](/docs/fr/ai/providers/#grok-cli-and-kimi-code-cli) |
| `LM_STUDIO_URL` | Serveur LM Studio (défaut `http://localhost:1234` ; une barre oblique finale est acceptée) |
| `EYAS_OPENCODE_PLUGIN_TOKEN` | Supprimée : EYAS ne la lit ni ne la définit. Chaque processus OpenCode qu’EYAS lance (le serveur d’arrière-plan et chaque terminal OpenCode) reçoit sa propre clé sur le descripteur de fichier 3, jamais dans un environnement, et chaque appel mémoire porte une preuve à usage unique par session ; la clé est révoquée quand ce processus se termine ou redémarre. L’environnement d’OpenCode ne porte que `EYAS_OPENCODE_KEY_FD=3`, qu’EYAS définit lui-même. Voir [OpenCode](/docs/fr/automation/opencode/#eyas-memory-inside-opencode) |

### Exemple Odoo multiversion {#multi-version-odoo-example}

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

Ouvre ensuite **Sources de recherche**, lance **Réindexer** sur chaque source et règle **Sources de code par défaut** sur chaque [projet](/docs/fr/daily/projects/). Les conversations épinglent des sources dans l’onglet **Sources** — voir [Recherche](/docs/fr/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

Les hooks de politique d’outils tournent à chaque appel d’outil (PreToolUse / PostToolUse) via le ToolExecutor — voir [Outils](/docs/fr/automation/tools/).

## Voir aussi {#related}

- [CLI](/docs/fr/deploy/cli/)
- [Fournisseurs](/docs/fr/ai/providers/)
- [Routage et budget](/docs/fr/ai/routing-budget/)
- [Mémoire](/docs/fr/knowledge/memory/)
