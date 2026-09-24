---
title: OpenCode
description: Sidecar optionnel du moteur de code (MIT) avec terminal web dans la conversation — isolé dans un dossier propre à EYAS.
---

**À quoi ça sert.** OpenCode est un agent de code en terminal (MIT, [opencode.ai](https://opencode.ai)). EYAS **n’importe pas** son noyau privé ni ses SDK d’IA. Voie officielle : serveur HTTP local (`opencode serve` sur 127.0.0.1) et PTY POSIX vers xterm.js. Le chat envoie la mémoire rappelée par EYAS avec la tâche, puis `opencode_run` l’exécute. Vous pouvez regarder ou prendre la main dans le terminal de la conversation. Chaque processus OpenCode qu’EYAS démarre tourne dans un dossier propre à EYAS, pas dans votre configuration OpenCode de tous les jours.

**Route :** `/opencode`. Barre latérale : **IA → OpenCode**. Dans une conversation, l’icône terminal de la barre du haut.

## Quand l'utiliser

- Une tâche de code doit tourner dans la boucle propre d’OpenCode, pas comme une pile d’appels `write_file` d’EYAS.
- Vous voulez **voir** le TUI ou taper dedans.
- OpenCode doit chercher dans la mémoire EYAS avec les mêmes `memory_search` / `memory_expand` que tout autre modèle — en lecture seule, limité au projet de la conversation.
- Les tâches déléguées à OpenCode doivent utiliser un modèle et une variante de raisonnement précis (carte **Modèle et raisonnement**).

## Déroulement typique

1. Ouvrez **OpenCode** (`/opencode`). Si la carte indique **Pas prêt**, installez le CLI (`curl -fsSL https://opencode.ai/install | bash` ou `npm i -g opencode-ai`) ou définissez `EYAS_OPENCODE_BIN`.
2. Connectez OpenCode **pour EYAS** : ouvrez une conversation, cliquez sur l’icône terminal, puis utilisez `/connect` dans le terminal OpenCode (voir [Connexion](#sign-in)).
3. Accordez `opencode_status` / `opencode_run` à l’agent qui doit déléguer. Cela marche sur tous les fournisseurs : les modèles CLI (Claude Code, Grok, Kimi) atteignent aussi ces outils via le pont EYAS. En option, choisissez le modèle et la variante de raisonnement sur la carte **Modèle et raisonnement**.
4. Demandez au collègue d’appeler `opencode_run` dans une conversation. EYAS envoie la tâche avec sa mémoire rappelée ; OpenCode demande à EYAS avant chaque appel d’outil ; la réponse et les diffs reviennent comme résultat de `opencode_run`.

## Fonctions

| Élément | Rôle |
|---------|------|
| Doctor | Fail-closed : CLI ou PTY manquant renvoie un remède, jamais un crash |
| `opencode_status` | Vert. Prêt / pas prêt + vérifications |
| `opencode_run` | Rouge, approbation. Ne tourne que dans une conversation. Session HTTP contre le sidecar ; chaque appel d’outil à l’intérieur demande au portail de sécurité d’EYAS |
| Terminal web | `@xterm/xterm` sur `/api/v1/opencode/terminal/:id` (JWT). La déconnexion tue le PTY |
| Plugin mémoire | `memory_search` / `memory_expand` dans OpenCode — les mêmes noms, descriptions et arguments que dans toute autre exécution EYAS, en lecture seule. Rien dans OpenCode ne peut écrire la mémoire EYAS |
| Isolation | Toujours active : un dossier propre à EYAS, `<répertoire de données EYAS>/cli-homes/opencode` — voir ci-dessous |

### Isolation {#isolation}

Chaque processus OpenCode qu’EYAS démarre — le serveur d’arrière-plan des tâches de chat et le terminal OpenCode d’une conversation — tourne dans `<répertoire de données EYAS>/cli-homes/opencode`. Il n’y a pas d’interrupteur : l’ancien réglage *config isolée* a été supprimé, et une valeur enregistrée auparavant est ignorée.

| Domaine | Ce que cela veut dire |
|---------|-----------------------|
| **Propre à EYAS** | La config d’OpenCode (`config/opencode/opencode.json`, écrite par EYAS, qui ne charge que le plugin mémoire EYAS, `config/opencode/eyas/eyas-memory.ts`), ses données (dont la connexion, `data/opencode/auth.json`, et les sessions d’OpenCode), son état et son cache (dont le cache npm). Le `HOME` d’OpenCode est ce même dossier. |
| **Non chargé** | `~/.claude/CLAUDE.md` de l’hôte, les skills de `~/.claude` et le reste de la compatibilité Claude Code d’OpenCode ; `~/.agents` et les autres skills externes ; les `opencode.json`, dossier `.opencode`, `AGENTS.md`, `CLAUDE.md` et `CONTEXT.md` propres au projet ; les `~/.config/opencode` et `~/.local/share/opencode` de tous les jours ; les clés API de fournisseurs de l’environnement du serveur (comme `OPENAI_API_KEY`). |
| **Désactivé** | Mise à jour automatique et partage de sessions. |
| **Shell** | L’outil shell propre d’OpenCode voit le dossier EYAS comme son dossier home : votre `~/.gitconfig` et vos clés SSH ne lui sont pas visibles. |

Le serveur d’arrière-plan écoute sur 127.0.0.1 et est protégé par un nouveau mot de passe aléatoire à chaque démarrage.

**Où vit le plugin mémoire.** Le plugin mémoire EYAS est écrit dans `<répertoire de données EYAS>/cli-homes/opencode/config/opencode/eyas/eyas-memory.ts`, à côté du dossier `node_modules` où OpenCode installe la dépendance `@opencode-ai/plugin` du plugin, et le `opencode.json` géré pointe vers lui. Les versions précédentes l’écrivaient dans `…/cli-homes/opencode/plugins/eyas-memory.ts`, où OpenCode 1.18.29 ne pouvait pas résoudre cet import et ignorait le plugin sans erreur — le modèle d’OpenCode n’avait alors ni `memory_search` ni `memory_expand`, et le hook shell du plugin ne s’exécutait jamais. EYAS supprime l’ancienne copie au démarrage suivant. Comme avant, le premier démarrage d’OpenCode a besoin d’accéder au registre npm pour installer la dépendance du plugin ; sans cela, OpenCode tourne sans les outils mémoire EYAS.

### Connexion {#sign-in}

OpenCode se connecte lui-même à ses fournisseurs de modèles ; EYAS ne glisse pas de clés API dans ce processus. La connexion vit désormais dans le dossier EYAS : **les utilisateurs existants d’OpenCode sont donc déconnectés une fois**. Ouvrez le terminal OpenCode d’une conversation et utilisez `/connect`. N’utilisez pas `opencode auth login` dans un terminal à vous, hors d’EYAS : il utilise votre environnement normal et connecterait votre OpenCode de tous les jours, pas celui d’EYAS.

### Les tâches headless demandent à EYAS {#headless-tasks-ask-eyas}

Les tâches `opencode_run` demandent à EYAS avant chaque appel d’outil : lectures et modifications de fichiers, listes et recherches, commandes shell, récupération et recherche web, accès à des dossiers hors du dossier de la tâche, sous-agents, LSP et skills.

- EYAS répond à chaque demande avec son [portail de sécurité](/docs/fr/admin/security-privacy/), le même que pour les autres assistants. Les appels autorisés s’exécutent une fois ; les appels refusés sont rejetés.
- Si le portail veut une décision humaine, l’appel est rejeté et une approbation est mise en file dans les [Approbations](/docs/fr/agents/autonomy/).
- Si le portail de sécurité n’est pas disponible, chaque demande est rejetée.
- EYAS ne répond que pour la tâche qu’il a démarrée, y compris les sous-agents que cette tâche lance. Dans le terminal OpenCode, c’est vous qui approuvez les appels d’outils.
- Après une tâche, EYAS supprime la session OpenCode. La réponse et les diffs restent dans la conversation comme résultat de `opencode_run`.

**Dossier de la tâche.** `opencode_run` ne tourne que dans une conversation et refuse partout ailleurs. Le dossier que vous nommez doit se trouver dans les dossiers de la conversation ou, si elle n’en a aucun, dans son propre espace de travail. Sans dossier, EYAS utilise le premier dossier de la conversation, sinon l’espace de travail propre de la conversation — jamais le dossier d’installation d’EYAS. Le terminal OpenCode ne s’ouvre que pour une conversation qui vous appartient : la conversation d’un autre utilisateur est *introuvable*, même pour un administrateur. Il travaille dans les dossiers enregistrés de cette conversation, qu’EYAS lit lui-même — la page ne peut pas en nommer d’autres — et se rabat de la même façon sur l’espace de travail de la conversation. Ses dossiers passent la même vérification que ceux de toute autre exécution : un dossier qui est un emplacement protégé, qui se trouve dans l’un d’eux ou qui en contient un (les données propres d’EYAS, le stockage d’un autre outil d’IA, un coffre de notes ou votre dossier personnel) est écarté, le terminal s’ouvre dans le dossier autorisé suivant ou dans l’espace de travail de la conversation, et une ligne en haut du terminal nomme le dossier écarté. Il en va de même d’un dossier enregistré qui est l’espace de travail de la conversation d’un autre utilisateur, qui s’y trouve ou qui y mène (par un lien) — enregistré avant qu’EYAS ne refuse de tels dossiers, ou hérité d’un projet ; `opencode_run` l’écarte aussi et refuse un dossier de tâche nommé à cet endroit. Les espaces de travail de vos autres conversations restent utilisables.

**Pas un bac à sable pour son propre utilisateur.** Les dossiers ci-dessus décident seulement où le terminal démarre. Ce qui y tourne tourne sous l’utilisateur système du serveur EYAS : une commande que vous approuvez dans le terminal OpenCode (une commande shell, ou l’accès à un dossier hors du dossier de la tâche) atteint tout ce que cet utilisateur atteint, y compris d’autres dossiers du serveur. N’accordez donc le droit OpenCode qu’aux personnes à qui vous confieriez cela. Le shell simple de l’API des sessions (`POST /api/v1/opencode/sessions` avec `kind: "shell"` ; la page web n’ouvre que le terminal OpenCode) est réservé au propriétaire et aux administrateurs — il faut le droit de gestion d’OpenCode, tout autre appelant reçoit `403` — et il démarre avec l’environnement du terminal OpenCode et le dossier personnel propre à EYAS, pas avec l’environnement du serveur : la clé maîtresse d’EYAS et les clés API des fournisseurs n’y sont donc pas. Par défaut, le rôle user peut aussi ouvrir le terminal OpenCode (le droit de création sur OpenCode).

### Mémoire envoyée avec une tâche {#memory-sent-with-a-task}

`opencode_run` envoie le bloc de mémoire rappelée d’EYAS — le même bloc que reçoit toute autre exécution — comme texte système de la tâche. Il est dimensionné comme le rappel de tout autre modèle : `memory.index.budgetChars` (2 400 caractères par défaut) est la taille pour une fenêtre de contexte de 100k tokens, et le bloc grandit avec la fenêtre du modèle qu’exécute OpenCode, jusqu’à 2,5× à partir de 250k tokens (6 000 caractères par défaut) ; en dessous d’environ 29k tokens il rétrécit, et une très petite fenêtre ne reçoit aucune mémoire rappelée. EYAS lit la fenêtre dans la propre liste de modèles d’OpenCode — la limite d’entrée du modèle quand OpenCode en indique une, sinon sa limite de contexte. Quand la fenêtre est inconnue, le bloc fait exactement `memory.index.budgetChars` : aucun modèle n’est choisi sur la carte **Modèle et raisonnement** (OpenCode utilise alors son propre modèle par défaut, qu’EYAS n’apprend que par la réponse) ; le modèle choisi n’est pas dans la liste d’OpenCode ou y figure sans limite (par exemple un modèle de fournisseur personnalisé sans `limit` dans sa config OpenCode) ; ou la liste ne peut pas être lue (un avertissement est journalisé et la tâche tourne quand même). La liste est lue au plus une fois par tâche, seulement quand un modèle est choisi, et la requête ne porte rien de la tâche. Avant, les tâches OpenCode recevaient toujours exactement `memory.index.budgetChars` : un modèle à grande fenêtre recevait donc moins de mémoire que ce qu’un autre fournisseur lui aurait donné. Le bloc porte la même indication que dans toute autre exécution : ouvrir une ligne avec `memory_expand`, chercher plus loin avec `memory_search`. Seule une tâche sur un serveur externe attaché ne reçoit pas d’indication (ce serveur n’a pas d’outils mémoire EYAS) et reçoit à la place davantage de meilleures correspondances en entier. Voir [Mémoire — Comment le rappel atteint le modèle](/docs/fr/knowledge/memory/#how-recall-reaches-the-model).

**Masqué avant de quitter EYAS.** OpenCode compte toujours comme une destination distante, puisqu’il peut faire tourner n’importe quel modèle. Le prompt de la tâche et la mémoire rappelée envoyée comme texte système de la tâche sont masqués par la politique de confidentialité avant que quoi que ce soit n’atteigne OpenCode, et le titre de la session OpenCode vient du prompt masqué. Les réponses de `memory_search` / `memory_expand` dans OpenCode sont masquées aussi. Si l’analyse de confidentialité échoue, la tâche échoue avec *privacy scan failed — the task was not sent to OpenCode*, et rien n’atteint OpenCode. Avec la politique de confidentialité (ou le module de confidentialité) désactivée, rien n’est masqué. Voir [Sécurité et confidentialité — Où s’applique le masquage](/docs/fr/admin/security-privacy/#where-masking-applies).

### Mémoire EYAS dans OpenCode {#eyas-memory-inside-opencode}

Le plugin mémoire EYAS donne au modèle d’OpenCode exactement deux outils, `memory_search` et `memory_expand`. Ils ont les mêmes noms, descriptions et arguments que dans toute autre exécution EYAS, ils sont en lecture seule et partagent le même budget de 3 appels d’outils mémoire par tour. OpenCode n’a aucun outil qui enregistre de la mémoire : ce dont EYAS se souvient, c’est EYAS qui le décide, jamais le modèle d’OpenCode.

Ce que les outils peuvent lire dépend de qui les appelle :

- **Une tâche `opencode_run`.** EYAS lie la session OpenCode qu’il crée à la conversation et à l’utilisateur qui ont lancé la tâche. Les outils lisent alors le projet de cette conversation, son type de projet et la mémoire globale, et partagent le budget de 3 appels du tour appelant.
- **Partout ailleurs** — un terminal OpenCode que quelqu’un ouvre dans le panneau, toute session qu’EYAS n’a pas créée, ou un appelant connecté qui n’est pas l’utilisateur de la session — les outils ne lisent que la mémoire globale.
- **Un serveur externe attaché** (URL d’attache) n’a aucun accès à la mémoire EYAS.

**La clé ne quitte jamais OpenCode, et ne se trouve jamais dans un environnement.**

- Chaque processus OpenCode qu’EYAS démarre — le serveur d’arrière-plan et chaque terminal OpenCode — reçoit sa propre clé sur le descripteur de fichier 3, une connexion que seul ce processus détient. La clé n’est jamais dans un environnement, une liste d’arguments ou un fichier. Elle meurt quand ce processus se termine ou redémarre.
- Le plugin EYAS lit la clé une seule fois, quand OpenCode le charge, la garde en mémoire et ferme le descripteur 3 : rien de ce qu’OpenCode démarre ensuite — y compris les commandes shell du modèle — n’en hérite. L’environnement du processus dit seulement que la clé est sur le descripteur 3 (`EYAS_OPENCODE_KEY_FD=3`), et un shell que lance le modèle voit cette variable et `OPENCODE_SERVER_PASSWORD` vides. `ps eww` ou `/proc/<pid>/environ` du processus OpenCode ne montre aucune clé.
- Chaque appel mémoire porte, au lieu de la clé, une preuve à usage unique pour une session OpenCode : une signature sur l’identifiant de la session dans laquelle l’outil tourne (fixé par OpenCode, pas par le modèle), une valeur aléatoire et l’heure. EYAS accepte une preuve une seule fois, pendant 2 minutes, et seulement tant que ce processus OpenCode tourne, et ne sert l’appel que pour la session que nomme la preuve. Un identifiant de session que le modèle passe comme argument d’outil n’est pas envoyé à EYAS. Une commande lancée par le modèle ne détient aucune clé : elle ne peut donc faire d’appel mémoire pour aucune session.
- Là où la clé ne peut pas être remise sur le descripteur 3, OpenCode tourne sans les outils mémoire EYAS plutôt que de recevoir une clé autrement.

Chaque appel passe par le même exécuteur d’outils EYAS que l’appel mémoire de tout autre modèle (portail de sécurité, permissions, budget d’exploration, journal d’accès à la mémoire, masque de confidentialité).

**Limites qui restent.** OpenCode 1.18.29 ne lit son mot de passe de serveur que dans son environnement. Un shell que lance le modèle le voit vide, mais tout processus du même utilisateur système capable de lire l’environnement d’un autre processus peut le lire et piloter les sessions de ce serveur OpenCode via l’API propre d’OpenCode — par exemple pour lire les messages d’une autre tâche en cours —, et cela inclut une commande lancée par le modèle. Le serveur propre du terminal a son propre port et son propre mot de passe ; il ne reçoit jamais le mot de passe du serveur d’arrière-plan, donc une commande dans le terminal n’en hérite pas. Faire tourner chaque tâche sur son propre serveur ne fermerait pas cette brèche, car chaque processus du même utilisateur système peut lire l’environnement de tous les autres ; seul un utilisateur système distinct ou un sandbox autour d’OpenCode la fermerait. OpenCode n’a pas de sandbox noyau. Un processus autorisé à lire la mémoire d’un autre processus (un débogueur que le système permet, ou root) peut toujours atteindre la clé.

**Ce qu’EYAS enregistre.** La sortie des outils d’OpenCode dans une tâche `opencode_run` et la sortie du panneau de terminal ne sont enregistrées qu’avec `memory.l0.captureToolResults` activé (désactivé par défaut), comme la sortie de tout autre outil : sous le projet de la conversation, avec la confiance *ingested*, et jamais rappelées mot pour mot. La sortie du terminal n’est enregistrée que pour une conversation qui existe et qui appartient à l’utilisateur du terminal. La réponse finale d’OpenCode et les diffs ne sont pas stockés à part : ils sont le résultat de `opencode_run`. Voir [Mémoire](/docs/fr/knowledge/memory/).

**API (intégrateurs).** `POST /api/v1/opencode/memory/search` et `POST /api/v1/opencode/memory/expand` prennent les arguments de `memory_search` / `memory_expand`. Le plugin s’authentifie avec une preuve de session à usage unique, `Authorization: Bearer eyas-ocs.<payload>.<signature>`, une par appel, et l’appel agit pour la session que nomme la preuve : un corps qui nomme une autre session dans `sessionId` reçoit `403` ; une preuve falsifiée, rejouée ou expirée, une preuve d’un processus qui s’est arrêté, ou la clé brute utilisée comme bearer reçoit `401`. Un utilisateur connecté qui a le droit de création sur OpenCode peut toujours appeler les routes et nommer une session dans le corps avec `sessionId` ; l’appel n’agit pour cette session que si l’utilisateur en est l’utilisateur lié, sinon il ne lit que la mémoire globale. Un refus de permission donne `403`. Les réponses sont masquées comme tout résultat d’outil mémoire envoyé à un modèle distant. Les anciens `/api/v1/opencode/memory/query` et `/api/v1/opencode/memory/save` ont disparu (`404`). Les appels modifiants vers `/api/v1/opencode/*` faits avec un cookie de session exigent l’en-tête `X-Eyas-Request`, comme les autres API d’administration (l’UI web l’envoie).

### Modèle et raisonnement {#model-and-reasoning}

La carte **Modèle et raisonnement** de la page OpenCode choisit le modèle et la variante de raisonnement des tâches que l’assistant délègue à OpenCode (`opencode_run`).

- **Modèle** liste les modèles propres d’OpenCode : les fournisseurs et modèles auxquels le sidecar OpenCode d’EYAS est connecté, lus depuis le serveur OpenCode en cours d’exécution. **Valeur par défaut d'OpenCode** (vide) n’envoie aucun modèle : OpenCode utilise alors son propre défaut, exactement comme avant.
- **Variante de raisonnement** liste les variantes qu’OpenCode propose pour le modèle choisi — par exemple low/medium/high/xhigh/max pour Claude Opus 5.5, none…max pour GPT-5.6, minimal/high pour certains modèles Gemini. Elle est masquée quand le modèle n’a pas de variantes. **Valeur par défaut du modèle** (vide) n’envoie aucune variante. Les noms standard (none, minimal, low, medium, high, xhigh, max) s’affichent avec les libellés d’effort d’EYAS ; les noms propres à un fournisseur s’affichent tels qu’OpenCode les nomme.
- Choisir un autre modèle réinitialise la variante, sauf si le nouveau modèle propose la même. **Enregistrer** stocke le choix ; il faut le droit de gestion sur OpenCode (propriétaire et admin par défaut).
- La liste a besoin que le serveur OpenCode tourne. Il démarre avec la première session de terminal OpenCode ou la première tâche déléguée — la page ne le démarre pas. D’ici là, la carte le signale et n’affiche que le choix enregistré ; rechargez la page une fois le serveur lancé. Si OpenCode ne peut pas renvoyer sa liste, la carte affiche *Impossible de lire la liste des modèles depuis OpenCode.*
- À l’exécution, une variante enregistrée que le modèle ne propose plus, ou qui ne peut pas être vérifiée parce que la liste est illisible, est abandonnée avec un avertissement dans le log du serveur ; la tâche tourne sur le modèle choisi avec son raisonnement par défaut. Le résultat de la tâche nomme le modèle et la variante qui ont réellement tourné, tels qu’OpenCode les rapporte (champ `effective`), y compris le modèle choisi par OpenCode quand aucun n’était réglé.
- Le terminal OpenCode n’est pas concerné : vous y choisissez toujours le modèle dans OpenCode.

Les installs existantes démarrent sur le modèle et la variante par défaut d’OpenCode ; il n’y a rien à migrer.

**API (intégrateurs).** `GET /api/v1/opencode/models` (lecture OpenCode) renvoie `{running, providers: [{id, name, models: [{id, name, variants: [{id, level}], contextWindow?}]}], defaults}` ; `contextWindow` est la limite d’entrée du modèle (sinon sa limite de contexte) quand OpenCode en indique une. Les identifiants des fournisseurs ne sont jamais renvoyés, et il ne démarre jamais le serveur : sans serveur en cours, il renvoie `running: false` ; une liste en échec renvoie `502` avec le code `OPENCODE_MODELS_UNAVAILABLE`. `PUT /api/v1/opencode/settings` accepte `model` (`{providerID, modelID}` ou null) et `variant` (chaîne ou null), et rejette tout corps mal formé avec `400` au lieu de l’ignorer.

### S’attacher à un serveur externe {#attaching-to-an-external-server}

Une URL d’attache vers un serveur OpenCode externe signifie **aucune isolation** : ce serveur garde sa propre config, sa connexion et ses règles de permission, et il ne reçoit ni outils mémoire EYAS, ni clé mémoire, ni enregistrement. La page OpenCode affiche **Serveur** et **Isolation** en *Avertissement*, avec cette mise en garde.

### La page OpenCode {#the-opencode-page}

La page affiche des noms de vérifications traduits, une ligne **Isolation**, une ligne **Serveur**, une indication de connexion et la carte **Modèle et raisonnement**.

### Mise à jour {#upgrade}

- Les versions précédentes gardaient les fichiers OpenCode sous `data/opencode` dans le dossier d’installation. Ce dossier n’est plus utilisé. Sortez-en ce dont vous avez encore besoin dans `data/opencode/workspaces` (anciennes sessions de terminal), puis vous pouvez le supprimer.
- Les outils OpenCode `eyas_query_memory` et `eyas_save_memory` sont remplacés par `memory_search` / `memory_expand`. Un OpenCode en cours prend le nouveau plugin à son prochain démarrage (un redémarrage d’EYAS).
- `EYAS_OPENCODE_PLUGIN_TOKEN` n’existe plus : EYAS ne le lit ni ne le définit. Chaque processus OpenCode reçoit sa propre clé sur le descripteur de fichier 3, et les appels mémoire portent des preuves par session. Un serveur attaché n’atteint plus la mémoire EYAS.
- Le plugin mémoire a été déplacé vers `config/opencode/eyas/eyas-memory.ts` dans le dossier OpenCode propre à EYAS ; l’ancien `plugins/eyas-memory.ts` est supprimé au démarrage suivant. Le modèle d’OpenCode a désormais vraiment `memory_search` / `memory_expand` (vérifié sur OpenCode 1.18.29).
- La sortie des outils et du terminal d’OpenCode n’est plus stockée sauf si `memory.l0.captureToolResults` est activé.

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [Conversations](/docs/fr/daily/conversations/)
- [Sécurité et confidentialité](/docs/fr/admin/security-privacy/)
