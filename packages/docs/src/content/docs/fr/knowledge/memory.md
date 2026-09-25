---
title: Mémoire
description: Ce dont EYAS se souvient — notes de coffre automatiques, cinq niveaux, l’enregistrement brut de chaque message, et quel magasin utiliser.
---

**À quoi ça sert.** La mémoire est le magasin long terme d’EYAS. Un fait durable énoncé dans une conversation devient une note de coffre sans que personne le demande, et la même note est ce que relisent les conversations suivantes. Cette page sert à inspecter les blocs working, les faits épisodiques, les fichiers du coffre et la file de revue — pas à curer un wiki. Comment ce qui est mémorisé atteint un modèle est décrit sous [Comment fonctionne le rappel](#how-recall-works). Depuis la 0.8.23, EYAS conserve aussi un enregistrement brut de chaque message qu’il persiste ; [L’enregistrement brut](#the-raw-record) ci-dessous dit tout ce qu’il y a à en savoir.

## Quand l’utiliser {#when-to-use-it}

- L’assistant doit se souvenir de qui vous êtes, comment vous travaillez, ou des contraintes d’un projet.
- Un fait a été dit dans le chat et vous voulez confirmer qu’il a atterri dans le coffre (ou pourquoi le capture a sauté).
- Revoir, taguer, grapher ou consolider — ou **Note du jour**.
- Vous choisissez entre Mémoire, wiki Connaissances, Documents et fichiers de coffre écrits à la main (ci-dessous).
- Couper le capture pour cette instance (`memory.capture.enabled: false`) — ou couper aussi l’enregistrement brut (`memory.l0.enabled: false`).
- Un modèle a tourné sans l’isolation d’EYAS et ce qu’il a écrit doit être caché à tous les modèles (**Mettre en quarantaine la mémoire d’un fournisseur**, propriétaire seulement).
- Vous voulez voir sur quoi repose le rappel ici — l’embedder local, la part de mémoire qui a déjà des vecteurs et les interrupteurs de capture réellement actifs (la carte **Moteur de rappel**).

## Déroulement typique {#typical-workflow}

1. Ouvrez **Mémoire** dans la barre latérale (section **Contenu**) — route `/memory`. (Aussi sous **Paramètres → IA et modèle**.)
2. Consultez **Aperçu** (compteurs, saillance, mémoires épisodiques récentes et la carte **Moteur de rappel**), puis **Fichiers du coffre** pour les notes durables.
3. Ayez une conversation de plus de ~40 caractères qui énonce un fait durable. Revenez ici après la réponse : vous devriez voir une nouvelle note de coffre (de type `user`, `feedback`, `domain`, `project` ou `reference`).
4. Si rien n’apparaît : trop court, capture coupée, aucun modèle d’arrière-plan n’a pu faire la capture (voir [La capture tourne sur le modèle d’arrière-plan](#capture-runs-on-the-background-model)), ou tour God Mode (le tour propre de la course n’écrit aucune note de coffre ; l’exécution de chaque travailleur est capturée à part). Écrivez la note à la main dans le coffre si vous en avez quand même besoin. Un tour God Mode laisse tout de même la réponse gagnante dans l’enregistrement brut — voir [L’enregistrement brut](#the-raw-record).

## Quel magasin utiliser {#which-store-to-use}

| Magasin | Métier |
|---------|--------|
| **Mémoire** (cette page) | Faits qu’EYAS enregistre automatiquement — les agents n’écrivent jamais la mémoire eux-mêmes. EYAS joint un index d’une ligne, et ce qu’il a rappelé pour le message, à chaque tour suivant. |
| **Connaissances** wiki | Pages que **vous** éditez. Le capture n’écrit pas ici. |
| **Documents** | Fichiers téléversés pour retrieval — pas des notes d’identité. |
| **Fichiers de coffre** (markdown à la main) | Le même coffre que le capture (`<répertoire de données>/vault/…`, par défaut `data/vault/…`). Pas `~/.claude` / `~/.grok`. |
| **Wiki du projet** | Pages ticket et décision d’un projet, pas la mémoire globale. |
| **Enregistrement brut** | Chaque message qu’EYAS persiste, conservé une seconde fois mot pour mot et compressé. Écrit automatiquement depuis la 0.8.23 ; aucune page ne l’affiche, et l’assistant ne l’atteint que par le rappel. |

La mémoire hôte Claude / Grok sur la machine **n’est pas** la source de vérité, et les modèles ne peuvent pas l’atteindre. Claude Code tourne toujours isolé et ne charge ni configuration ni auto-mémoire de l’hôte ; Grok et Kimi tournent dans leur propre home EYAS ; le portail de sécurité refuse les lectures comme les écritures de la mémoire de tout autre outil ; et les serveurs MCP qui conservent une mémoire hors d’EYAS sont bloqués. Le prompt master dit la même chose à chaque agent (voir [Prompts — le contrat mémoire](/docs/fr/ai/prompts/#the-memory-contract-in-the-master-prompt)). Voir [La mémoire hors d’EYAS est refusée](#memory-outside-eyas-is-refused).

## Fonctions {#features}

Sous-titre dans l’app : *Système de mémoire hybride à 5 niveaux — travail, épisodique, coffre sémantique/procédural, archive*.

### Actions {#actions}

| Commande | Signification |
|----------|---------------|
| **Note du jour** | Aller à / créer la note du jour |
| **Consolider maintenant** | Lancer le consolidateur (promouvoir/rétrograder les mémoires) |
| **Actualiser** | Recharger les statistiques |

Au-dessus des onglets, la carte **Briefing du matin** affiche le dernier résumé de la réflexion nocturne quand il y en a un (la tâche de réflexion est coupée par défaut : `memory.reflection.enabled`).

### Onglets {#tabs}

| Onglet | Contenu |
|--------|---------|
| **Aperçu** | Statistiques, graphiques de saillance et mémoires épisodiques récentes, puis les cartes **Moteur de rappel** et **Mettre en quarantaine la mémoire d'un fournisseur** (propriétaire seulement) |
| **Mémoire de travail** | Blocs à TTL court (24 h) |
| **Mémoire épisodique** | Faits/épisodes avec saillance |
| **Fichiers du coffre** | Explorateur du coffre Markdown |
| **Archive** | Éléments archivés à faible saillance |
| **Graphe** | Vue graphe de la mémoire |
| **Étiquettes** | Explorateur d'étiquettes |
| **Révision** | File de révision pour l'hygiène de la mémoire |

### Aperçu {#overview}

| Statistique | Signification |
|-------------|---------------|
| **Blocs de travail** | Blocs de travail actifs (TTL 24 h) |
| **Faits épisodiques** | Nombre épisodique (+ invalidés) |
| **Fichiers du coffre** | Fichiers Markdown sémantiques + procéduraux |
| **Archivés** | Nombre d'archives à faible saillance |
| **Prête pour la promotion** → coffre | Candidats épisodiques de grande valeur |
| **Prête pour la rétrogradation** → archive | Candidats à faible saillance |
| Saillance min. / moy. / max. | Distribution |
| **Étiquettes principales** / **Épisodique — Par source** | Répartitions |

Sous les statistiques viennent les cartes [Moteur de rappel](#recall-engine) et [Mettre en quarantaine la mémoire d’un fournisseur](#quarantine-a-providers-memory).

### Détail des onglets {#tab-details}

Chaque ligne de **Mémoire de travail** affiche *N caractères · consulté N fois · expire (heure)*.

Dans **Mémoire épisodique**, un clic sur une ligne ouvre son détail :

| Champ | Signification |
|-------|---------------|
| **Saillance** | Score d'importance |
| **invalidée** | Plus fiable ni à jour |
| **ID / Source / ID de source / Agent** | Provenance |
| **Nombre d'accès / Nombre de conversations** | Utilisation |
| **Valide depuis / Invalidée le / Créée / Dernier accès** | Horodatages du cycle de vie |
| **Hash d'embedding** | Si l’élément a un vecteur |
| **Étiquettes** | Les étiquettes de l’élément |

**Fichiers du coffre** :

| Commande | Signification |
|----------|---------------|
| **Fichiers** | Chemins du coffre |
| **Frontmatter** | Métadonnées YAML |
| **étiquettes :** / **liens :** | Étiquettes et wikiliens |
| **Contenu** | Corps Markdown |
| **Rétroliens** | Notes qui pointent ici |

Chaque ligne d’**Archive** affiche *archivée (date) · originale (date)* et *id · id original*. Le consolidateur y déplace les éléments à faible saillance.

### Moteur de rappel {#recall-engine}

La carte **Moteur de rappel** de l’**Aperçu** montre, en lecture seule, la mécanique par laquelle chaque modèle rappelle la mémoire. Elle est la même quel que soit le fournisseur de chat qui répond, et rien ne s’y modifie.

| Ligne | Ce qu’elle montre |
|-------|-------------------|
| **Modèle de vecteurs** | Le modèle local qui transforme la mémoire et les requêtes en vecteurs : *e5 multilingue (local)* quand les poids de multilingual-e5-small se sont chargés, sinon *Embedder de radicaux haché (repli local)*, avec l’identifiant du modèle en dessous. *Désactivé* seulement si aucun embedder n’a pu être construit à ce démarrage ; le rappel vectoriel est alors coupé (voir [La recherche vectorielle tourne toujours en local](#vector-search-always-runs-locally)). |
| **Résumés avec vecteur** / **Faits avec vecteur** | *X sur Y*. Y est le nombre de résumés et de faits que le rappel peut renvoyer : actuels, non remplacés, hors quarantaine ; ceux marqués `contains-secrets` sont exclus sauf si `memory.recall.includeSecrets` est activé. X est le nombre d’entre eux qui ont déjà un vecteur de l’embedder actuel. L’écart se referme quelques secondes après la prochaine écriture en mémoire. Les vecteurs d’un embedder précédent ne comptent pas ; ils sont remplacés au démarrage suivant. |
| **Dernière mise à jour des vecteurs** | Quand le travailleur de vecteurs d’arrière-plan a tourné pour la dernière fois dans ce processus serveur. *Pas encore depuis le démarrage* jusqu’à son premier passage après un redémarrage, quelques secondes après le démarrage. |
| **Partitions de projet** | Combien de projets et de types de projet ont des vecteurs rangés dans leur propre partition — ce qui tient la mémoire d’un projet hors du rappel d’un autre. Seules comptent les partitions qui contiennent des vecteurs maintenant ; la mémoire globale a toujours la sienne. |
| **Enregistrement brut** | Si l’[enregistrement brut](#the-raw-record) est capturé : `memory.l0.enabled` est activé et la capture a démarré au lancement. |
| **Capture des sorties d'outils** | `memory.l0.captureToolResults`. *Désactivé* dès que l’enregistrement brut est coupé, puisque rien n’est alors enregistré. |
| **Capture du raisonnement** | `memory.l0.captureThinking`. *Désactivé* aussi dès que l’enregistrement brut est coupé. |
| **Rappeler les notes contenant des secrets** | `memory.recall.includeSecrets` |
| **Budget de rappel (fenêtre de 100k tokens)** | `memory.index.budgetChars` (2 400 caractères par défaut) : la taille du bloc de rappel pour une fenêtre de contexte de 100k tokens ; le bloc suit la fenêtre du modèle qui répond (voir [Lignes de mémoire permanentes](#standing-memory-lines)). |

La carte montre la configuration avec laquelle EYAS tourne, relue à chaque chargement de la page ; un changement dans `local.yaml` apparaît après un redémarrage. Derrière, `GET /api/v1/memory/engine` exige un droit de lecture sur la mémoire (rôles owner, admin, user et agent ; un invité reçoit `403`). Il ne renvoie que des comptes, des interrupteurs et l’identifiant de l’embedder — jamais de contenu de mémoire.

## Notes durables {#durable-notes}

Une note durable est un fait qui persiste, pas le compte rendu d'un événement :
qui vous êtes, comment vous voulez qu'on travaille, quelles sont les
contraintes d'un projet. Chacune est un fichier markdown dans le vault, et
le modèle reçoit à chaque tour un **index d'une ligne** — les résumés seulement,
chaque ligne avec un identifiant — dans le bloc de mémoire rappelée joint à
votre message (voir [Comment le rappel atteint le modèle](#how-recall-reaches-the-model)).
Il ouvre une note entière avec `memory_expand` quand la ligne s'avère utile, et
cherche plus loin avec `memory_search` (voir
[Chercher plus loin](#looking-further-memory_search-and-memory_expand)).

Le même bloc porte aussi ce qu'EYAS a **récupéré pour le message courant** —
résumés de conversation, faits, notes du vault, mémoire épisodique et messages
antérieurs — plus le texte intégral des meilleures correspondances. Le modèle
n'a pas à appeler `memory_search` pour que ces résultats apparaissent. Les
messages passés sont interrogeables parce qu'ils sont déjà stockés — le rappel
n'en fait aucune copie supplémentaire. (L'enregistrement brut ci-dessous est une
seconde copie distincte et délibérée.) Le bloc séparé *Travail antérieur lié*
qu'on ajoutait autrefois au prompt système a disparu : le travail antérieur
arrive désormais dans le bloc de mémoire rappelée.

Deux champs de frontmatter pilotent cela :

| Champ | Rôle |
|-------|------|
| `kind` | `user`, `feedback`, `domain`, `project` ou `reference` — et l'ordre de tri |
| `summary` | La ligne unique affichée dans l'index |

`user` et `feedback` passent en premier, car ils changent la façon dont chaque
réponse est produite. `domain` est le type de projet (partagé entre projets
frères) ; `project` est ce client. Sans `kind`, une note dans `procedural/` est lue comme
`feedback`, les autres comme `reference` — jamais comme `user` : déclarer
d'office qu'une note parle de vous reviendrait à la placer en tête de chaque
prompt. Sans `summary`, la première vraie ligne sert d'index, donc un fichier
écrit à la main fonctionne sans frontmatter propre à EYAS.

Emplacement : `<répertoire de données>/vault/semantic/`, `procedural/`,
`projects/` et `project-types/` — par défaut sous `data/vault/`. Le coffre vit
toujours dans le répertoire de données et suit `EYAS_DATA_DIR` ; il n'a pas de
réglage de chemin propre (voir [Configuration — Répertoire de données et coffre](/docs/fr/deploy/configuration/#data-directory-and-vault)).
Écrivez-en une vous-même et EYAS la prend en compte.

**Elles se remplissent d'elles-mêmes.** Une fois la réponse délivrée — dans un chat,
une exécution de carte en arrière-plan, une exécution de spécialiste ou déléguée,
l’exécution d’un membre d’équipe, une tâche A2A ou une réponse de canal —, un petit
appel au modèle d'arrière-plan d'EYAS relit l'échange et se demande s'il s'y
trouve quelque chose qui sera encore vrai et encore utile dans un mois (voir
[La capture tourne sur le modèle d'arrière-plan](#capture-runs-on-the-background-model)). Deux notes au plus par tour, et
sur la plupart des tours, à juste titre, aucune. Cela ne se produit jamais dans
le chemin critique de votre réponse : une capture qui échoue coûte une note,
jamais une réponse.

Devant cet appel, il n’y a qu’une vérification de longueur et un plafond par conversation, et vous pouvez le couper — voir [Le capture est activé par défaut](#capture-is-on-by-default). Écrire une note à la main fonctionne toujours. Les agents ne peuvent pas écrire la mémoire : EYAS l’enregistre automatiquement, et `save_memory` est retiré — il n’écrit rien et dit à l’agent d’utiliser `memory_search` à la place. Le modèle d’OpenCode ne peut pas écrire non plus : le plugin mémoire EYAS dans OpenCode n’offre que `memory_search` et `memory_expand`.

Une note candidate passe le même filtre d'instructions que les faits et les
résumés avant d'être écrite (voir [Pourquoi certaines phrases sont refusées](#why-some-sentences-are-refused)),
et chaque note écrite par un modèle porte une `origin` dans son frontmatter —
`by: capture`, plus le fournisseur, le modèle et la conversation quand ils sont
connus — si bien qu'elle est mémorisée comme écrite par un modèle, jamais comme
vos propres mots.

Un fait répété renforce la note qui existe déjà au lieu d'en créer une seconde :
la nouvelle formulation s'ajoute en puce datée sous `## History` et n'écrase
rien. Le texte est masqué par le module de confidentialité avant d'atteindre
le disque, et non à la relecture, avec la même fonction et les mêmes règles que
le trafic sortant vers les modèles : les dates sont conservées, et les valeurs
des classes mask et block sont remplacées — un IBAN dans une note est stocké
sous la forme `[IBAN]`. Cela vaut pour les notes du vault ; l'enregistrement brut
ci-dessous, les résumés de conversation et les faits sont stockés tels quels
dans EYAS et ne sont masqués qu'en sortant (voir
[Mémoire et confidentialité](#memory-and-privacy)).

**Mémoire de projet.** Un fait appris dans les conversations d'un projet est
rangé sous `projects/<id-du-projet>/`, passe devant les notes `reference`
générales tant que vous travaillez dans ce projet, et n'apparaît nulle part
ailleurs : les notes d'un autre projet n'atteignent jamais votre prompt. Le
projet fourre-tout **General**, dans lequel démarre chaque conversation, ne
compte pas comme une identité de projet : ce qui y est appris reste un fait sur
vous ou sur la façon de travailler, et vous suit donc partout.

### Le capture est activé par défaut {#capture-is-on-by-default}

Le capture tourne sur **chaque** conversation, globalement, sauf si vous réglez `memory.capture.enabled: false` (dans `local.yaml`, puis redémarrage). Il tourne sur toutes les façons dont EYAS exécute un modèle : vos propres tours de chat, les exécutions de cartes en arrière-plan, les exécutions de spécialiste et déléguées (`run_specialist` / `delegate_to_agent`, étapes de pipeline ticket-vers-code comprises), les tâches A2A d’un agent pair, l’exécution de chaque membre d’équipe et chaque réponse de canal (Telegram, e-mail, Slack, …). Tous passent par la même porte et les mêmes réglages, et `memory.capture.enabled: false` coupe tous les chemins. Une exécution qui n’a rien répondu n’écrit aucune ligne. Un message plus court que `minUserChars` ne déclenche jamais d’appel modèle, et une conversation en reçoit au plus `maxPerConversation`. Un spécialiste ou un membre d’équipe tourne dans sa propre sous-conversation et a donc son propre plafond ; une conversation de canal partage un seul plafond entre tous ses messages. Chaque spécialiste, membre d’équipe et réponse de canal dont l’instruction fait au moins `minUserChars` caractères peut donc coûter un appel de modèle d’arrière-plan supplémentaire. Quand aucun modèle d’arrière-plan n’est éligible, ou que le budget est à *stop*, aucun appel n’a lieu et le run est enregistré comme saut (voir [Journal des captures](#capture-run-ledger)).

**Qui a écrit le message décide comment il est lu.**

- Vos propres messages de chat sont lus comme les vôtres.
- Une tâche déléguée, une consigne d’équipe, une consigne de passage de relais ou l’objectif d’une carte est lu comme une instruction de tâche qu’un agent a pu écrire pour vous. Seuls les faits qu’elle énonce sur vous, le projet ou le monde sont gardés, jamais les étapes de la tâche elle-même.
- Un message de canal ou une tâche A2A sont les mots d’un tiers. Ils ne peuvent jamais créer de note sur qui vous êtes (`user`) ni de règle sur la façon de travailler (`feedback`) — dites-les à EYAS dans l’application. Ils ne peuvent produire que des notes `reference`, `project` ou `domain`, qui portent `trust: peer` dans leur frontmatter et sont stockées avec la confiance *peer*, pas comme dérivées d’un modèle. Une telle note ne complète jamais une de vos notes existantes : un fait redit obtient son propre fichier. Le contrôle de longueur ne compte que les mots de l’expéditeur : un court « ok » sur un canal ne déclenche donc aucun appel au modèle.

| Porte | Défaut | Signification |
|-------|--------|---------------|
| `memory.capture.enabled` | **on** | Interrupteur maître |
| `minUserChars` | 40 | Points de code Unicode ; les messages plus courts sautent l’appel modèle |
| `maxPerConversation` | 20 | Plafond de dépense modèle (les runs réussis, illisibles, de forme rejetée, refusés par le filtre d’instructions (`poison_gate`) et en erreur comptent ; les sauts trop-court, sans-modèle-éligible et budget-stop ne comptent pas, car aucun modèle n’a été appelé) |
| `maxInputChars` | 4000 | Votre message et la réponse sont chacun coupés à ce nombre de caractères avant que le modèle de capture les voie |

Pas de liste de mots-clés. `{"notes":[]}` est la réponse fréquente et correcte (0–2 notes).

### La capture tourne sur le modèle d’arrière-plan {#capture-runs-on-the-background-model}

La capture mémoire, la consolidation nocturne et le briefing de réflexion utilisent tous le **modèle d’arrière-plan** d’EYAS : un fournisseur API, ou une CLI capable de faire un appel isolé (aujourd’hui Claude Code ; Grok CLI et Kimi Code CLI une fois qu’EYAS a vérifié leur isolation sur cet hôte). L’ordre est le niveau de routage Heartbeat, puis le défaut de l’install, puis les fournisseurs API, puis les CLI capables de s’isoler. Il ne retombe jamais sur un fournisseur que la passerelle choisit d’elle-même, ni sur une CLI qui ne peut pas s’isoler.

Chaque appel d’extraction, de consolidation et de réflexion est **isolé** : un seul tour, pas d’outils, ni mémoire ni configuration native de la CLI, et l’instruction envoyée comme prompt système. Quand le modèle d’extraction est distant, les valeurs de classe block de l’échange lui arrivent masquées (`[IBAN]`) avec les dates intactes : un tour qui mentionne un IBAN produit donc quand même sa note.

Avec un fournisseur API ou Claude Code activé, rien de visible ne change. Sur une install sans modèle d’arrière-plan éligible — par exemple Grok seul ou Kimi seul avant que leur isolation soit vérifiée :

- **La capture ne fait aucun appel modèle.** Chaque tour éligible écrit une ligne dans le journal des captures avec la raison de saut `no_eligible_model` et aucun fournisseur. C’est un saut enregistré, pas une erreur.
- **La consolidation nocturne** ne transforme pas les souvenirs épisodiques récurrents en note de coffre. Ces groupes restent intacts (ni résumés, ni invalidés) et sont promus une nuit ultérieure, une fois qu’un modèle éligible existe.
- **Le briefing de réflexion / du matin** ne garde que sa partie déterministe (par exemple les tâches en retard), sans réalisations, apprentissages ni suggestions écrits par un modèle.

Quand le budget modèle est à *stop*, la capture enregistre la raison de saut `budget_stop` et ne fait aucun appel.

Sans isolation, l’extracteur a lu une fois la mémoire hôte du propriétaire, a dit le fait « déjà enregistré », et le coffre EYAS est resté vide. C’est le bug que ceci ferme.

### Journal des captures {#capture-run-ledger}

Chaque résultat qui atteint la porte écrit une ligne `memory_capture_runs` : les sauts avec leur raison (`too-short`, `cap-reached`, `unparsable`, `rejected-shape`, `poison_gate`, `no_eligible_model`, `budget_stop`, `error`), les extractions avec les kinds écrits (un run `poison_gate` compte quand même les notes de la même réponse qui ont été enregistrées), plus une colonne `provider` : `fournisseur/modèle`, `fournisseur/route` quand une CLI a répondu sans nommer son modèle (par exemple `claude-code/isolated-cli`), ou null quand aucun modèle n’a été appelé. Un appel d’extraction échoué ou vide écrit une ligne `error` qui nomme le fournisseur tenté. La colonne `entry_path` note de quel chemin d’exécution vient la ligne : `interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team` ou `channel` (vide sur les lignes écrites avant cette version). Deux silences : capture off n’écrit rien ; un run sans texte assistant n’atteint pas la porte. Une course **God Mode** rend son propre flux avant le bloc post-tour : le tour propre de la course n’écrit donc ni note de coffre, ni ligne ici ; chaque travailleur tourne comme une exécution d’arrière-plan à part et y est capturé, en lisant la tâche comme une instruction écrite par un agent. L’enregistrement brut ci-dessous est un journal distinct, et celui-là les couvre.

## Comment fonctionne le rappel {#how-recall-works}

À chaque tour, quel que soit le modèle qui répond, EYAS joint à votre message ce dont il se souvient, en un seul bloc :

- **Les notes permanentes** — un index d’une ligne des notes durables et des résumés, chaque ligne avec un identifiant que le modèle peut ouvrir ;
- **Les résultats rappelés** — les résumés, faits, notes, mémoires épisodiques et messages passés qui correspondent à ce message, classés par pertinence, ancienneté et auteur ;
- **Les meilleures correspondances en texte intégral** — les deux premières (quatre pour un modèle qui ne peut pas appeler d’outils).

Tout cela ne vient que de la mémoire que la conversation peut voir (son projet, son type de projet et la mémoire globale), est cherché dans la langue où vous écrivez et pondéré par la confiance. Le modèle peut chercher plus loin avec `memory_search` et `memory_expand`, trois appels par réponse. Les sections ci-dessous les prennent une à une.

### Quelle mémoire une conversation peut voir {#which-memory-a-conversation-can-see}

Une conversation voit trois sortes de mémoire : celle de son propre projet,
celle de son type de projet, et la mémoire globale. Elle ne voit jamais la
mémoire d’un autre projet. Une conversation hors de tout projet — y compris dans
le projet par défaut **General** — ne voit que la mémoire globale.

Une seule règle couvre tout ce que reçoit le modèle : la mémoire injectée à
chaque tour, les lignes de l’index permanent, le rappel vectoriel, et les outils
`memory_search`, `memory_expand` et `search_memory`.

C’est le frontmatter d’une note du coffre qui décide où elle appartient :

| La note déclare | Visible dans |
|-----------------|--------------|
| `project:` | Ce projet seulement, quel que soit le `kind` de la note. (Auparavant, les notes `user` / `feedback` / `reference` s’affichaient partout, même quand elles nommaient un projet.) |
| seulement `projectType:` | Les projets de ce type |
| ni l’un ni l’autre | Partout (global) |

Déplacer une note dans `projects/<id>/` d’un projet qui existe, ou ajouter
`project:` à son frontmatter, la restreint à ce projet — de même que les faits
et le résumé qu’EYAS en dérive : ils ne sont rappelés que dans ce projet au lieu
de l’être dans chaque conversation. La recherche de la page Mémoire (`/memory`)
n’est toujours pas filtrée.

### Comment le rappel atteint le modèle {#how-recall-reaches-the-model}

Ce dont EYAS se souvient pour un message est joint **à ce message**, pas au
prompt système. Cela arrive sous la forme d’un seul bloc délimité,
`<eyas-memory>`, à l’intérieur d’un bloc `<turn-context>` qu’EYAS ajoute en tête
de votre message courant, avec la date et l’heure courantes (dans
`i18n.timezone`, sinon le fuseau du serveur). Le bloc contient, dans cet ordre :

1. les notes permanentes — l’index d’une ligne, chaque ligne avec son identifiant ;
2. les notes récupérées pour ce message ;
3. le texte intégral des meilleures correspondances.

Le format est le même sur tous les fournisseurs — modèles API, Claude Code, Grok
CLI, Kimi Code CLI, modèles locaux — et pour toute sorte d’exécution : chat
interactif ; exécutions d’arrière-plan (cartes du bot de tableau, nouvelles
tentatives et reprises, travailleurs du Mode Dieu) ; spécialistes et agents
délégués (`run_specialist` / `delegate_to_agent`) et étapes du pipeline
ticket-vers-code ; membres d’équipe ; réponses de canal formulées avec la voix
(interne) du propriétaire ; et tâches [OpenCode](/docs/fr/automation/opencode/).
Un chat sans collègue, dans un projet sans agent par défaut, ne reçoit pas de
prompt système assemblé mais reçoit quand même la date, l’heure et la mémoire
rappelée. Une surcharge `system` dans la requête du message ne remplace que le
prompt système ; le rappel arrive quand même. Une exécution reprise
(rafraîchissement, reprise après approbation, retour du critique) reçoit une
date, une heure et un rappel frais, pas ceux capturés au démarrage de
l’exécution.

- **Des données, pas des instructions.** Le bloc dit au modèle qu’il s’agit de
  données, pas d’instructions, et lui demande de citer ce qu’il utilise sous la
  forme `[source:<id>]`. Le texte qu’il contient ne peut ni fermer le bloc ni se
  faire passer pour un message système ou utilisateur : ces balises sont
  neutralisées mais restent lisibles.
- **Jamais enregistré.** Votre message stocké n’est jamais modifié ; le bloc
  n’est ajouté qu’à la copie envoyée au modèle, si bien qu’EYAS ne recapture
  jamais son propre rappel comme mémoire.
- **Un prompt système stable.** Comme l’horloge a aussi rejoint ce bloc, le
  prompt système reste identique d’un tour à l’autre, ce qui lui permet de
  rester en cache.
- **Des noms d’outils adaptés à l’hôte.** Les indications d’exploration nomment
  les outils comme l’hôte du modèle les liste : `memory_search` /
  `memory_expand` chez les fournisseurs natifs, `mcp__eyas__memory_search` sur
  Claude Code, `use_tool` avec `eyas__memory_search` sur Grok CLI, et
  `memory_search` sur le serveur MCP `eyas` pour Kimi. Un modèle qui ne peut pas
  appeler d’outils ne reçoit pas d’indication d’exploration et jusqu’à quatre
  notes en texte intégral au lieu de deux, et son prompt dit que ce bloc est
  toute la mémoire qu’il reçoit et qu’il ne peut pas chercher plus loin, au lieu
  de le renvoyer vers `memory_search` / `memory_expand` (voir
  [Prompts — Le contrat mémoire](/docs/fr/ai/prompts/#the-memory-contract-in-the-master-prompt)).
- **Pas de mémoire du propriétaire pour les lecteurs extérieurs.** Les tâches
  d’un pair A2A, et les réponses de canal dont la portée de voix est Externe
  (**Forcer Externe** sur la conversation, ou une surcharge temporaire), ne
  reçoivent que la date et l’heure. Si EYAS ne peut pas déterminer la portée de
  voix d’une réponse de canal, la réponse part aussi sans mémoire rappelée. Les
  outils mémoire eux-mêmes ne changent pas et restent gouvernés par le portail de
  sécurité.

Tout le bloc, cadre compris, est dimensionné par `memory.index.budgetChars`
(voir [Lignes de mémoire permanentes](#standing-memory-lines)), à l’échelle de la
fenêtre du modèle qui répond — pour une tâche OpenCode, la fenêtre qu’OpenCode
indique pour le modèle choisi (voir [OpenCode — Mémoire envoyée avec une tâche](/docs/fr/automation/opencode/#memory-sent-with-a-task)). Dans le panneau
[Composition du contexte](/docs/fr/daily/conversations/#context-composition), le
rappel est la section **memory-recall** de la zone **turn**, à côté de
**turn-time** (l’horloge) ; les sections *memory-index* et *related-work*
n’apparaissent plus. L’encadré **Mémoire transmise** du panneau montre, pour
tous les fournisseurs, le modèle et la fenêtre pour lesquels le bloc a été
dimensionné, combien d’éléments ont été rappelés et combien en entier par
rapport au plafond du bloc, pourquoi le rappel a été retenu s’il l’a été, et les
appels d’approfondissement du tour sur le plafond de 3.

Pour comparer les fournisseurs sur une période, **Observabilité → Contexte** propose la carte **Transmission de la mémoire par fournisseur** : par fournisseur, combien de tours ont porté de la mémoire, la moyenne d’éléments par couche et de tokens de mémoire sur ces tours, et la fréquence à laquelle le modèle a ouvert la mémoire lui-même. Des chiffres proches signifient que chaque modèle a reçu la même mémoire. Voir [Observabilité](/docs/fr/admin/observability/).

### Avec quoi le rappel cherche {#what-recall-searches-with}

Chaque tour cherche dans la mémoire avec la même requête, qu’il s’agisse d’un
chat ou d’une exécution d’arrière-plan ou planifiée d’une conversation. La
requête est construite, sans appel modèle, à partir de :

- votre message courant (s’il est vide, votre dernier message dans cette conversation) ;
- votre message précédent, s’il est différent (400 premiers caractères) ;
- le titre de la conversation (120 premiers caractères ; un titre provisoire
  *Sans titre* est ignoré) ;
- la description de la tâche ou l’objectif de la conversation (400 premiers
  caractères).

Elle fait au plus 1 200 caractères, votre message vient en premier, et une
partie déjà contenue dans une précédente (par exemple un titre tiré de votre
premier message) n’est pas répétée. Seuls les messages de cette conversation
sont utilisés, jamais ceux d’une autre. Une courte relance comme *oui, vas-y*
rappelle donc la tâche en discussion, et une exécution d’arrière-plan d’une
conversation sans description cherche quand même par son titre. (Avant, le chat
cherchait avec le seul message courant, et une exécution d’arrière-plan avec la
seule description de la tâche.)

**La recherche lit votre langue.** La langue est tirée de la requête elle-même.
Pour un message court sans langue nette, EYAS utilise la langue dans laquelle la
conversation s’est tenue ; si celle-ci est inconnue aussi, les mots-outils
courants de toutes les langues prises en charge sont ignorés. Les mots-outils
hongrois, allemands, espagnols et français (*hogy*, *csak*, *aber*, *para*,
*avec* …) ne comptent donc plus comme termes de recherche et ne laissent plus
passer des notes sans rapport, et les requêtes en klingon reçoivent la
pondération renforcée des mots-clés. Les requêtes `memory_search` du modèle — celles d’OpenCode comprises — déterminent leur langue de la même façon.

### Comment le rappel classe {#how-recall-ranks}

Tous les modèles, tous les chemins d’entrée et les outils `memory_search` /
`memory_expand` utilisent le même classement. Rien à configurer ni à migrer.

- **La pertinence d’abord** : à quel point une note ou un message passé
  correspond à votre message. Viennent ensuite sa récence et son importance,
  plus un petit bonus pour la mémoire de la même tâche (conversation) ou du même
  projet.
- **L’âge compte selon le type de mémoire.** Les faits vieillissent le plus vite
  (environ un mois), les messages passés en environ trois mois, les résumés et
  les notes du coffre lentement (environ un an), et les résumés épinglés ne
  vieillissent jamais. Pour une note du coffre, l’âge est le moment où EYAS l’a
  indexée pour la dernière fois — quand la note a changé pour la dernière fois ;
  pour un message passé, le moment où il a été écrit. (Avant, chaque note et
  chaque message passé comptaient comme tout neufs.)
- **Qui l’a écrit pèse.** Vos propres messages et le texte écrit par les agents
  ou modèles d’EYAS comptent pleinement ; la sortie d’outils et le texte importé
  de tiers pèsent 0,6× ; le texte des expéditeurs de canaux pèse 0,3×. Cela
  utilise la confiance qu’EYAS a enregistrée en stockant l’élément (voir
  [Confiance : qui l’a écrit](#trust-who-wrote-it)).
- **Jamais rappelés :** le texte signalé comme possible injection de prompt (en
  quarantaine), y compris via le résumé de la conversation d’où il vient, le
  raisonnement propre d’un modèle et les appels d’outil enregistrés (voir
  [Les résultats d’outil ne sont pas enregistrés](#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).
- **Un message passé, ce sont ses propres mots.** Une ligne rappelée d’une
  conversation antérieure affiche le texte propre de ce message — le passage
  autour de vos mots de recherche, 280 caractères au plus — au lieu du résumé de
  la conversation ou de son seul identifiant. Les notes du coffre et les
  messages passés sont en concurrence à égalité (avant, les correspondances par
  mots-clés des messages passés passaient toujours devant les notes
  correspondantes), et une note importée dans l’enregistrement brut ne revient
  qu’une fois, en tant que note.
- La recherche de la page Mémoire (`GET /api/v1/memory/search`) et le repli de
  `memory_search` affichent aussi le texte propre des messages passés, jamais du
  texte signalé, le raisonnement d’un modèle ni un appel d’outil enregistré.

### La recherche vectorielle tourne toujours en local {#vector-search-always-runs-locally}

Quel que soit le fournisseur de chat qui répond — Claude Code, Grok, Kimi ou un
fournisseur API —, EYAS transforme la mémoire en vecteurs sur la machine même :
avec le modèle multilingual-e5-small quand ses poids sont disponibles, sinon
avec un embedder haché intégré plus simple (qualité moindre, aucun
téléchargement). Le texte de la mémoire n’est jamais envoyé à l’API
d’embeddings d’un fournisseur pour être rappelé.

- Le niveau de routage **Embedding** n’alimente plus que l’ancien index de
  recherche du vault et épisodique ; le rappel ne l’utilise jamais. (Avant,
  régler ce niveau coupait en silence le rappel vectoriel des résumés et des
  faits et les envoyait à cette API à chaque démarrage.) Quand l’embedder de cet
  ancien index change, l’index est vidé une fois et reconstruit automatiquement.
- **La nouvelle mémoire est interrogeable en quelques secondes.** Quand EYAS
  écrit en mémoire les messages retenus d’une conversation — à la fermeture de
  la tâche, après 30 minutes d’inactivité, ou quand le tampon est plein —, les
  résumés et faits qu’il en extrait reçoivent leurs vecteurs environ une
  demi-seconde plus tard, pas seulement après un redémarrage.
- Les résumés remplacés, les faits remplacés ou supprimés, les éléments en
  quarantaine et les éléments marqués comme contenant des secrets (sauf si
  `memory.recall.includeSecrets` est activé) sont retirés de l’index vectoriel :
  ils n’occupent plus de places de rappel.
- Le modèle e5 local est chargé au démarrage sur toutes les installs, y compris
  là où un niveau Embedding est réglé (environ 100 Mo de RAM). S’il ne peut pas
  se charger, EYAS utilise l’embedder de repli et continue de fonctionner.
  `eyas doctor` indique lequel est utilisé sur sa ligne **Memory embedder** —
  voir [CLI](/docs/fr/deploy/cli/#what-doctor-checks).

Rien à configurer ni à migrer : les vecteurs produits par un embedder précédent
sont remplacés automatiquement au démarrage suivant.

### Chercher plus loin : memory_search et memory_expand {#looking-further-memory_search-and-memory_expand}

Quand le bloc de mémoire rappelée ne suffit pas, le modèle appelle
`memory_search`, puis `memory_expand` pour ouvrir un résultat.
`search_memory` est un alias de `memory_search`.

- **3 appels par réponse, sur tous les fournisseurs.** Les trois outils
  ensemble permettent 3 appels par réponse — modèles API, Claude Code, Grok et
  Kimi de la même façon. Le compte repart à chaque nouveau message que vous
  envoyez et ne s’épuise pas en cours de réponse, quelle que soit la longueur de
  la boucle d’outils du modèle.
- **Ouvrir un message passé.** `memory_expand` sur un identifiant `rw:` renvoie
  le texte original du message, jusqu’à 8 000 caractères, avec son type de
  source et sa confiance. Il n’ajoute le résumé de la conversation comme
  contexte que si ce résumé est lui-même rappelable (non signalé, non dérivé de
  secrets sauf si `memory.recall.includeSecrets` est activé).
- **Verrouillé sur le projet de la conversation, par EYAS côté serveur.** Quoi
  qu’envoient le modèle, une CLI ou un pont, les outils lisent le projet de la
  conversation, son type et la mémoire globale. Un argument `scope` ou projet
  est ignoré : regarder un autre projet se fait dans l’UI, jamais par un
  argument d’outil. Un appel qui nomme une conversation qu’EYAS ne connaît pas
  renvoie l’erreur *memory scope unresolved* et aucun résultat.
- Les clients extérieurs du serveur MCP propre d’EYAS n’ont pas de conversation
  EYAS : leurs appels d’outils mémoire ne lisent que la mémoire globale, avec
  une limite de 3 appels par 90 secondes. La même limite vaut pour les appels d’OpenCode qui ne sont liés à aucune tâche.
- **OpenCode** offre au modèle les deux mêmes outils, avec les mêmes noms et arguments, en lecture seule. Pour une tâche qu’EYAS délègue avec `opencode_run`, ils sont verrouillés sur le projet de cette conversation et partagent les 3 appels du tour appelant. Partout ailleurs — une session de terminal OpenCode ouverte dans le panneau, une session qu’EYAS n’a pas créée, ou un utilisateur connecté qui n’est pas celui de la session — ils ne lisent que la mémoire globale. Un serveur OpenCode rattaché de l’extérieur n’a aucun accès à la mémoire EYAS. Voir [OpenCode](/docs/fr/automation/opencode/).

Chaque hôte liste ces outils sous son propre nom — `memory_search` chez les
fournisseurs API, `mcp__eyas__memory_search` dans Claude Code, `use_tool` avec
`eyas__memory_search` dans Grok. Voir [MCP — noms d’outils par hôte](/docs/fr/ai/mcp/#tool-names-per-host).

### Lignes de mémoire permanentes {#standing-memory-lines}

Chaque ligne de l’index de mémoire permanent affiche un identifiant que
`memory_expand` ouvre : `(vt:<chemin>)` pour une note du coffre, `(gs:<id>)`
pour un résumé de conversation. `memory_expand` ouvre aussi les identifiants
d’entité (`en:<id>`) : il renvoie le nom de l’entité, son type, ses alias et
jusqu’à 10 faits courants tirés de la mémoire que la conversation peut voir.

Les lignes de résumé de l’index sont les résumés épinglés, le résumé propre du
projet, et jusqu’à 5 résumés de tâches les plus récents du même projet (ou, hors
projet, d’autres conversations sans projet) — jamais ceux d’un autre projet,
jamais celui de la conversation en cours, et jamais ceux en quarantaine.
(Auparavant : les 20 résumés les plus importants de n’importe quel projet.)

`memory.index.budgetChars` (2400 caractères par défaut, environ 600 tokens) est
la taille de **tout le bloc de mémoire rappelée**, cadre compris : notes
permanentes, notes récupérées et correspondances en texte intégral ensemble. Ce
défaut est prévu pour un modèle à fenêtre de contexte de 100k tokens ; le bloc
suit la fenêtre du modèle qui répond (jusqu’à 2,5× à partir de 250k tokens,
moins en dessous d’environ 29k tokens, et rien du tout pour une très petite fenêtre). Une
tâche OpenCode est dimensionnée de la même façon, pour la fenêtre qu’OpenCode
indique pour son modèle, ou exactement `memory.index.budgetChars` quand cette
fenêtre est inconnue (avant, OpenCode recevait toujours la valeur non ajustée). Les notes permanentes passent en premier mais
laissent toujours de la place — jusqu’à la moitié du bloc — à ce qui a été
récupéré pour le message courant. Les notes qui ne tiennent pas sont résumées
dans une ligne finale, *… N more notes not shown*, qui nomme l’outil
d’exploration comme l’hôte le liste ; elles restent accessibles par
`memory_search`. Augmentez le budget dans `config/local.yaml` (et redémarrez)
quand vos lignes `user` et `feedback` n’y tiennent plus. Les versions précédentes livraient 8000 dans
`config/default.yaml` — voir la [note de mise à jour](/docs/fr/deploy/configuration/#memory-index-and-recall).

Au premier démarrage après la mise à jour, EYAS range chaque vecteur de mémoire
existant sous son projet, une fois et par lots (logué *L3 repartition: vectors
filed under their project*). S’il ne peut pas terminer, il logue un
avertissement et réessaie au démarrage suivant. Il n’y a rien à faire.

### Notes de projet sans projet {#project-notes-without-a-project}

Une note dont le `kind` est `project` ou `domain` mais qui ne porte aucun
`project:` / `projectType:` est **globale** : elle figure dans l’index permanent,
dans `memory_search` et dans le rappel de chaque conversation, classée comme
note de projet. La déplacer dans `projects/<id>/` — ou inscrire `project:` dans
son frontmatter — la restreint à ce projet. Les notes apportées par un import
restent ainsi tant que vous n’avez pas créé les projets correspondants.

### Les secrets importés restent hors du rappel {#imported-secrets-stay-out-of-recall}

L’importateur n’écarte jamais un fichier parce qu’il contient un identifiant.
Il est stocké tel quel et l’élément porte le tag `contains-secrets` — comme tag
de note, capacité de compétence ou tag épisodique, selon ce qu’il est devenu.

Par défaut, un tel élément reste en dehors de tout ce que le modèle atteint de
lui-même : l’index permanent, le rappel, `memory_search`, la tâche de
réflexion, le consolidateur nocturne et l’appariement des compétences. Il n’est
jamais vectorisé ni remis au modèle d’enrichissement facultatif. La page
Mémoire vous le montre toujours en entier.

**Tout ce qui en est dérivé reste dehors aussi.** Le tag passe de la note ou de
l’épisode à sa copie dans l’enregistrement brut, à chaque fait qu’EYAS en a
extrait et à chaque résumé construit à partir de lui ; un fait déjà connu devient
secret lui aussi quand une note taguée le confirme plus tard. Une telle ligne
brute, un tel fait ou un tel résumé n’est pas vectorisé, n’est pas listé dans les
lignes permanentes, n’est pas renvoyé par `memory_search` ni par
`GET /api/v1/memory/search`, et ne peut pas être ouvert avec `memory_expand`.
Quand une entité est dépliée, ses faits secrets sont laissés de côté, et un
message passé dont le résumé de conversation est secret est montré sans ce
résumé. (Avant, ces faits et résumés dérivés pouvaient
encore atteindre le modèle.) Une note écrite directement sur le disque avec
`contains-secrets` dans son frontmatter est traitée comme secrète avant même que
l’indexeur du coffre l’ait vue.

Mettre `memory.recall.includeSecrets: true` dans `config/local.yaml` puis
redémarrer ouvre tout cela au modèle, comme avant.

**Mise à jour.** Au premier démarrage après la mise à jour, EYAS marque les
lignes brutes, faits et résumés existants issus de notes et d’épisodes tagués —
une fois, avant de construire les vecteurs — et logue une ligne. Si une autre
note ou un autre épisode reçoit le tag plus tard, le démarrage suivant marque
aussi ses lignes dérivées. Les marqueurs ne font que s’ajouter : retirer
`contains-secrets` d’une note à la main ne rend pas à nouveau rappelables les
résumés et faits déjà dérivés d’elle.

Cette porte empêche l’inclusion automatique ; ce n’est pas un bac à sable du
système de fichiers. Un agent doté d’outils de lecture de fichiers peut
toujours lire le fichier d’origine sur le disque. Une persona d’agent importée
et un fichier de règles de workspace approuvé ne sont pas filtrés du tout — là,
le contenu *est* le prompt — relisez donc ces lignes avant de les approuver.

Les tags `legacy` (un ancien dossier de mémoire) et `third-party` (de la
documentation produit tierce) désignent des notes ordinaires, pleinement
rappelables ; ils disent seulement d’où vient une note. Chaque élément importé
porte aussi `source:<adaptateur>`, qui nomme l’adaptateur l’ayant lu. Une note
que vous écrivez vous-même peut déclarer `contains-secrets` dans son propre
frontmatter et reçoit le même traitement. Voir
[Import et export de données](/docs/fr/admin/data-port/).

### Mémoire et confidentialité {#memory-and-privacy}

EYAS stocke la mémoire brute et la masque en sortie. Quand la mémoire est envoyée à un modèle distant — injectée dans le prompt, ou renvoyée par `memory_search`, `memory_expand` et les autres outils mémoire — la politique de confidentialité la masque pour cette destination, et un même élément de mémoire est masqué à l’identique dans les deux cas. Un modèle local (loopback, ou un hôte listé comme local dans la politique de confidentialité) la reçoit non masquée. Les notes du coffre sont aussi masquées au repos à leur écriture (les dates sont conservées).

Les résultats des outils mémoire sont masqués de la même façon sur **chaque** chemin par lequel un modèle peut lire la mémoire EYAS : fournisseurs API et locaux, outils EYAS internes au processus de Claude Code, Grok et Kimi via le pont MCP d’EYAS, clients MCP extérieurs du serveur MCP propre d’EYAS, et le sidecar OpenCode (le prompt de sa tâche, la mémoire rappelée envoyée avec la tâche, et les réponses de ses outils `memory_search` / `memory_expand`). Une CLI, un client MCP extérieur et OpenCode comptent toujours comme distants. Si l’analyse de confidentialité échoue, le résultat est retenu plutôt qu’envoyé non masqué. Voir [Sécurité et confidentialité — Où s’applique le masquage](/docs/fr/admin/security-privacy/#where-masking-applies).

### La mémoire hors d’EYAS est refusée {#memory-outside-eyas-is-refused}

Les agents apprennent que la mémoire EYAS est la seule qu’ils ont, qu’EYAS l’enregistre, et qu’ils l’atteignent avec `memory_search` / `memory_expand`. C’est aussi appliqué :

- **Le portail de sécurité refuse les lectures comme les écritures** de la mémoire d’autres outils (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, les dossiers d’OpenCode, les dossiers `ai-memory` et le reste de la liste), des coffres Obsidian, de chaque chemin de `security.foreignMemoryPaths`, du dossier de données propre d’EYAS (coffre, base, clés, homes de connexion CLI) et de l’espace de travail d’une autre conversation — pour tous les modèles et chaque appel d’outil que vérifie le portail. On dit au modèle, par exemple, *Memory outside EYAS (Claude Code) — use memory_search / memory_expand from EYAS* — sauf avec Grok CLI, qui termine sa réponse sur l’appel refusé sans que son modèle voie la raison (voir [Fournisseurs — Grok CLI et Kimi Code CLI](/docs/fr/ai/providers/#grok-cli-and-kimi-code-cli)). Avant, seuls les écritures et l’accès shell vers `~/.claude`, `~/.grok` et `ai-memory` étaient bloqués, et les lectures étaient permises.
- **Les outils propres de Claude Code** passent la même vérification avant de s’exécuter, y compris les lectures que Claude Code s’autoriserait tout seul dans son dossier de travail.
- **Les recherches sont jugées sur ce qu’elles peuvent atteindre.** Une recherche propre d’une CLI (Grep, Glob, une commande shell récursive) dont le dossier contient la mémoire d’un autre outil, un coffre ou les données d’EYAS est refusée comme *Search too broad*, parce que la CLI ne peut pas écarter cet emplacement ; et un Dossier qui contient un tel emplacement ne peut plus être enregistré. Voir [Sécurité et confidentialité — Mémoire hors d’EYAS](/docs/fr/admin/security-privacy/#memory-outside-eyas).
- **Le sandbox de fichiers du noyau.** Les commandes shell de Claude Code et les propres outils de Grok CLI tournent aussi dans le sandbox de fichiers du système d’exploitation là où il est disponible, qui bloque les mêmes emplacements même quand une commande shell les atteint par des voies qu’EYAS ne peut pas lire (voir [Fournisseurs — Sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox)). **Événements de sécurité** liste ce qui est protégé sur ce serveur dans sa carte **Mémoire hors d’EYAS**.
- **Les CLI tournent isolées.** Claude Code ne charge ni `CLAUDE.md`, ni réglages, ni skills, ni serveurs MCP, ni auto-mémoire de l’hôte ; Grok CLI et Kimi Code CLI tournent dans leur propre home EYAS et ne voient jamais `~/.grok`, `~/.kimi` ni `~/.claude`. Voir [Fournisseurs](/docs/fr/ai/providers/#claude-code-isolation).
- **Les serveurs MCP qui conservent une seconde mémoire** (le serveur de graphe de connaissances Memory, Qdrant, Obsidian, MCPVault, …) ou qui pointent vers un dossier protégé sont bloqués pour tous les modèles. Voir [MCP](/docs/fr/ai/mcp/#memory-store-servers-are-blocked).

**Migration.** Les agents qui lisaient directement `~/.claude/CLAUDE.md`, la mémoire de `~/.grok`, des notes de coffre ou des fichiers sous `data/` sont désormais refusés (les Événements de sécurité montrent chaque refus). Faites entrer ce savoir dans EYAS une fois avec l’[Import de données](/docs/fr/admin/data-port/). Détails et ce qui n’est pas encore couvert : [Sécurité et confidentialité — Mémoire hors d’EYAS](/docs/fr/admin/security-privacy/#memory-outside-eyas).

---

## L’enregistrement brut {#the-raw-record}

**Rien de ce qui est dit ne se perd.** Chaque message qu’EYAS consigne — les
vôtres, ceux de l’assistant et la sortie des runs d’agent en arrière-plan — est
désormais conservé une seconde fois, mot pour mot, dans un enregistrement brut
placé à côté de la conversation elle-même. Il est compressé à l’entrée (environ
2,7× plus petit sur du texte réel) et rangé sous l’empreinte de ses propres
octets : une même phrase répétée dans une conversation est donc stockée une
fois et comptée deux fois.

**Ce qui le lit.** Aucune page et aucune commande ne vous montre
l’enregistrement brut. L’assistant ne l’atteint que par le rappel de mémoire,
dans la même portée de projet que tout le reste : les résumés et les faits
qu’EYAS en déduit (ci-dessous) apparaissent comme lignes de mémoire permanentes
et résultats de recherche, et `memory_search` / `memory_expand` peuvent les
ouvrir, ainsi que les lignes brutes — voir
[Quelle mémoire une conversation peut voir](#which-memory-a-conversation-can-see).

Ce qui change pour vous aujourd’hui, c’est l’endroit où vivent vos mots. Une
conversation n’est plus la seule copie de ce qui s’y est dit : la fermer,
l’archiver ou la supprimer laisse l’enregistrement brut en place, et aucun
bouton nulle part ne l’efface. Si ce n’est pas ce que vous voulez, coupez
l’enregistrement brut avant d’utiliser EYAS pour quoi que ce soit dont vous
voudriez plus tard qu’il ait disparu (voir ci-dessous).

L’écriture se fait par lots, pas immédiatement. Les messages sont retenus par
conversation, puis écrits quand la conversation se ferme (ou passe dans une
étape fermée), quand environ 8 000 tokens se sont accumulés, quand la
conversation est restée inactive 30 minutes, ou quand EYAS s’arrête — un
redémarrage ne perd rien de ce qui avait déjà été dit.

Chaque message est en outre estampillé de son origine, et cette estampille ne
s’hérite jamais. Un résumé ou un fait ne peut jamais finir plus digne de
confiance que les mots dont il est tiré — voir
[Confiance : qui l’a écrit](#trust-who-wrote-it).

### Confiance : qui l’a écrit {#trust-who-wrote-it}

Le degré de confiance qu’EYAS accorde à un texte mémorisé dépend de **qui l’a
écrit**, pas du côté de la conversation où il est apparu.

| Confiance | Ce qu’elle couvre |
|-----------|-------------------|
| **owner** | Ce que vous tapez dans une conversation, y compris un tour Mode Dieu |
| **derived** | Le texte qu’un agent ou EYAS lui-même a écrit : les réponses du modèle, une tâche qu’un agent délègue à un autre, un brief de passation, le prompt que Prompt coach / Prompt enhancer compose autour de votre brouillon, l’objectif d’une carte du tableau quand elle tourne en arrière-plan, et le brief que reçoit un membre d’équipe |
| **peer** | Les messages des expéditeurs de canaux (Telegram, e-mail et autres canaux) et les tâches qu’un autre système envoie par A2A, ainsi que les notes de coffre que la capture de mémoire en tire (`trust: peer`) |
| **ingested** | La sortie d’outil |
| **quarantined** | Texte signalé — conservé, mais jamais rappelé |

Les faits et résumés ne sont jamais plus dignes de confiance que le texte dont
ils viennent : une ligne comme *Target model: X* dans un prompt du coach, ou
*Deadline: Friday* dans une tâche déléguée, ne peut plus devenir un fait de
niveau propriétaire. Le rappel pondère aussi ces niveaux (voir
[Comment le rappel classe](#how-recall-ranks)) : la sortie d’outils et le texte
importé de tiers comptent 0,6×, les expéditeurs de canaux 0,3×, le texte en
quarantaine jamais.

**Les instructions d’arrière-plan et d’équipe sont mémorisées aussi :**
l’objectif d’une carte quand une exécution d’arrière-plan la démarre, et le
brief de chaque membre d’équipe. Chaque instruction distincte est mémorisée une
fois, quel que soit le nombre de nouvelles tentatives ou de reprises. Rien de
nouveau n’apparaît dans la conversation elle-même.

**Les notes du coffre ont aussi un niveau de confiance.** Une note écrite par un
modèle est *derived*, pas la vôtre — les notes automatiques par tour, la
consolidation nocturne et les résumés d’équipe. Vous les reconnaissez à une
entrée `origin` dans le frontmatter (`by: capture`, `consolidation` ou `team`,
plus le fournisseur, le modèle et la conversation quand ils sont connus), au tag
`auto-consolidated`, ou à leur lien vers la conversation qui les a capturées.
Retirer à la main l’`origin` d’une note ne rend pas à une note de capture le
niveau propriétaire, parce que le lien de capture la marque toujours. Une note que la capture a tirée d’un message de canal ou d’une tâche A2A porte
`trust: peer` et est stockée avec la confiance *peer* ; elle ne renforce jamais une note plus fiable qu’elle, si bien qu’un fait redit obtient son propre fichier. Les notes que vous avez écrites à la
main ou importées vous-même restent *owner*. Vous pouvez ajouter `trust:` au
frontmatter d’une note, mais il ne peut que **baisser** le niveau, jamais le
relever : `trust: quarantined` garde une note hors des lignes de mémoire
permanentes, et l’assistant ne peut pas l’ouvrir avec `memory_expand` (le
fichier reste dans le coffre et dans l’explorateur du coffre).

**Mise à jour.** Au premier démarrage après la mise à jour, EYAS lit chaque note
du coffre une fois pour enregistrer son niveau de confiance : ce démarrage prend
donc un peu plus de temps. Quelques secondes plus tard, une passe d’arrière-plan
unique corrige la mémoire des notes existantes du coffre — les notes écrites par
un modèle perdent le niveau propriétaire, les notes de projet rejoignent leur
projet — et reconstruit leurs faits et leur résumé. Il n’y a rien à faire, et la
passe ne se répète pas.

<h3 id="what-eyas-works-out-from-it--with-no-model-call">Ce qu’EYAS en déduit — sans aucun appel modèle</h3>

À chaque lot écrit, EYAS relit ce qu’il vient d’écrire et en déduit, tout seul :

- des **faits**, à partir des lignes `key: value` du texte, plus quelques-uns
  tirés de la carte de Tableau de la conversation elle-même (titre, projet, type
  de projet, agent) ;
- **un résumé court**, de 280 caractères au plus — le premier et le dernier
  message, plus quelques-unes des phrases les plus caractéristiques entre les
  deux ;
- des **entités** : dates, `@mentions`, `#tickets`, identifiants de code, termes
  entre accents graves, noms à majuscule initiale ;
- des **thèmes**, et un **score d’importance** construit sur la longueur de la
  conversation, la part qui vous revient, la présence de formulations de
  décision (en cinq langues), le fait qu’elle soit fermée et le fait que vous
  l’ayez épinglée.

Rien de tout cela n’appelle un modèle. Aucun fournisseur n’est contacté, aucune
clé API n’est utilisée, aucun budget n’est dépensé, et il n’y a rien à
configurer. La contrepartie, c’est que la lecture est appliquée plutôt que
maligne : elle trouve ce qui a été dit clairement et manque ce qui n’était que
sous-entendu.

Les faits ne s’empilent pas. Redire la même chose renvoie au fait qui existe
déjà. Dire du neuf sur le même sujet — une échéance qui passe du lundi au
vendredi — retire l’ancien fait avec une date de fin au lieu de l’écraser : il y
a donc exactement une réponse courante, et un historique intact derrière elle.
Rien n’est modifié sur place et rien n’est jeté. Un fait n’hérite pas non plus
d’une étiquette de projet ou de conversation que toutes ses sources ne portent
pas.

Les résumés et les faits sont ce que lisent les lignes de mémoire permanentes
(identifiants `gs:`), le rappel, `memory_search` et `memory_expand`. Ils reçoivent
leurs vecteurs de recherche environ une demi-seconde après l’écriture d’un lot
(voir [La recherche vectorielle tourne toujours en local](#vector-search-always-runs-locally)).

### Ce que ça vous coûte, et comment le couper {#what-it-costs-you-and-how-to-switch-it-off}

L’enregistrement brut grossit avec l’usage, et **rien ne l’élague encore** — ni
réglage de rétention, ni tâche de nettoyage dans cette version. Mesuré, un
message enregistré coûte de l’ordre de 5 Ko sur le disque une fois ses index
comptés : attendez-vous donc à voir la base grossir nettement plus vite qu’avant.

Trois réglages dans `config/default.yaml`, tous sous `memory` :

| Réglage | Défaut | Signification |
|---------|--------|---------------|
| `memory.l0.enabled` | **on** | Interrupteur maître. `false` n’enregistre plus rien ; effectif au redémarrage suivant |
| `memory.l0.extractInLegacy` | **on** | `false` garde le texte et n’en déduit rien — ni faits, ni résumés, ni thèmes |
| `memory.engine` | `legacy` | Décide seulement si l’extraction déterministe des faits tourne : `v2` extrait toujours ; `legacy` extrait tant que `memory.l0.extractInLegacy` est activé (le défaut). Le rappel est toujours le rappel par couches décrit sur cette page, quelle que soit la valeur |

`memory.capture.enabled: false` ne coupe **pas** l’enregistrement brut. Ce
réglage-là gouverne les notes de coffre et le petit appel modèle qui les
produit ; les deux sont indépendants, et couper l’un laisse l’autre tourner.

`eyas doctor` indique si la compression est disponible et quelle implémentation
est utilisée. S’il n’y en a aucune, EYAS le dit dans le log et n’enregistre
rien, plutôt que de remplir un tampon en silence.

<h3 id="tool-results-are-not-recorded--and-why-to-leave-it-that-way">Les résultats d’outil ne sont pas enregistrés — et pourquoi en rester là</h3>

`memory.l0.captureToolResults` est **off par défaut**. Lisez ceci avant de l’activer.

Un seul interrupteur couvre chaque outil qu’appelle une exécution d’agent, quel que soit le modèle qui répond : les propres outils d’EYAS ; les outils EYAS que Claude Code, Grok ou Kimi appellent via le pont EYAS ; et les outils intégrés de Claude Code, Grok et Kimi — exécuter des commandes, lire, écrire ou chercher dans des fichiers. Il couvre aussi OpenCode : les outils qu’OpenCode exécute dans une tâche `opencode_run`, et la sortie du terminal OpenCode de la conversation (l’icône terminal dans la barre du haut de la conversation), enregistrée seulement pour une conversation qui existe et appartient à l’utilisateur du terminal. La réponse finale et les diffs d’OpenCode sont le résultat d’`opencode_run` et sont enregistrés comme n’importe quel autre résultat d’outil. (Avant, OpenCode stockait sa sortie de terminal et ses événements quel que soit cet interrupteur.)

- Seuls les appels qui ont réellement tourné sont enregistrés. Un appel en échec est enregistré et marqué comme erreur. Les appels refusés, ignorés ou en attente d’approbation ne sont pas enregistrés, pas plus que les résultats vides ou les répétitions du même appel.
- Chaque appel enregistré garde ce que l’appel a renvoyé : le nom de l’outil, la sortie, s’il a échoué, son issue, et qui l’a exécuté (EYAS ou la CLI propre du modèle). Les 2 048 premiers caractères de ses arguments sont gardés à côté comme simple provenance : ils ne sont pas indexés en texte intégral et n’orientent jamais les thèmes, noms ou faits qu’EYAS extrait.
- Seuls les appels faits dans une exécution d’agent qui appartient à une conversation sont enregistrés. Un outil appelé hors de toute exécution d’agent (par exemple par un client MCP extérieur) n’est pas enregistré. La sortie du terminal n’est enregistrée que pour une conversation qui existe et appartient à l’utilisateur du terminal.
- Les appels enregistrés sont rangés dans le projet de la conversation, avec la confiance *ingested* (voir [Confiance : qui l’a écrit](#trust-who-wrote-it)).

Une fois activé, l’enregistrement brut garde **la sortie entière de chaque appel d’outil, mot pour mot et sans retouche**, plus les 2 048 premiers caractères de ses arguments. Autrement dit : la sortie complète d’une commande, le contenu de chaque fichier que l’assistant lit, et tout code à usage unique ou jeton qu’un outil viendrait à renvoyer — le tout posé dans la base comme du texte ordinaire. Rien ne le masque, rien ne l’analyse, et la compression n’est pas du chiffrement. Les notes de coffre traversent le module de confidentialité avant d’être écrites ; les résultats d’outil enregistrés, non.

**Ce qui revient dans un prompt.** Un appel d’outil enregistré n’est jamais rappelé ni cité : ni dans la mémoire qu’EYAS ajoute à un tour, ni via `memory_search` ou `memory_expand`, ni dans la recherche de la page Mémoire, ni dans le résumé de sa conversation. Seule sa sortie oriente les thèmes et les noms (un nom de fichier ou de fonction, par exemple) qu’EYAS extrait de la conversation ; les arguments n’orientent rien. Un mot de passe qu’un outil a saisi dans un formulaire, un terme de recherche ou un chemin que le modèle a passé ne devient donc jamais un thème, un nom ou un fait, et un jeton qu’une commande a affiché ou une page web qu’un outil a récupérée ne réapparaît jamais dans le prompt d’une autre conversation — y compris quand ce prompt part vers un modèle distant.

`memory.l0.toolResultMaxBytes` (8 Ko) plafonne l’enregistrement de ce que l’appel a renvoyé — nom de l’outil, sortie, drapeau d’erreur, issue et qui l’a exécuté —, coupé sur une frontière de caractère avec un marqueur de troncature visible. Les arguments n’y comptent pas ; ils sont coupés à part à leurs 2 048 premiers caractères. L’interrupteur activé, EYAS journalise à chaque démarrage un avertissement : les résultats d’outil sont stockés tels quels et sans caviardage, et rien ne les analyse ni ne les chiffre.

### Raisonnement du modèle (audit seulement) {#model-reasoning-audit-only}

`memory.l0.captureThinking` (défaut **off**) garde dans l’enregistrement brut le
raisonnement (« thinking ») de tout modèle qui en rapporte un, une entrée par
appel au modèle. C’est pour l’audit seulement : jamais transformé en faits,
jamais rappelé dans un prompt. Il est stocké mot pour mot et non expurgé comme
les résultats d’outil, et EYAS affiche un avertissement au démarrage tant qu’il
est activé.

Les deux interrupteurs sont lus au début de chaque exécution depuis la
configuration en cours ; une modification de `local.yaml` s’applique après un
redémarrage d’EYAS.

**Provenance.** Les résultats d’outil et le raisonnement enregistrés, ainsi que
les réponses des exécutions d’arrière-plan, d’équipe et déléguées, enregistrent
désormais le fournisseur et le modèle qui ont réellement répondu (pas toujours
celui demandé, par exemple après un fallback) et comment l’exécution a démarré :
interactive, arrière-plan, équipe, délégation, A2A, canal ou pipeline. Les
lignes plus anciennes n’ont simplement pas ces champs.

### Pourquoi certaines phrases sont refusées {#why-some-sentences-are-refused}

Un texte qui se lit comme une instruction adressée à l’assistant n’a pas le
droit de devenir un fait de confiance. « Ignore toutes les instructions
précédentes », un changement de rôle « à partir de maintenant, tu es… », ou tout
ce qui est déguisé en message système, est refusé net. Les ordres simples visant
l’assistant, les injonctions à lancer un outil et les formulations du type
« oublie tout » sont conservés, mais marqués non fiables, pour qu’un rappel
ultérieur puisse les écarter. Le contrôle couvre l’anglais, le hongrois,
l’allemand, l’espagnol et le français.

Quand un résumé est refusé, EYAS redescend d’un cran plutôt que de renoncer :
d’abord un résumé plus sobre, puis les seules phrases qui se lisent proprement,
et en dernier un talon qui nomme la conversation sans en répéter le texte. Vous
ne perdez jamais la conversation, seulement son résumé.

C’est un filtre à motifs, pas une preuve, et il penche du côté de la prudence :
de la prose de travail ordinaire comme `Run the following command in the pod: …`
se retrouve parfois marquée non fiable elle aussi. Le texte marqué comme
possible injection de prompt (en quarantaine) n’est jamais rappelé ni ouvert avec
`memory_expand`, pas non plus via le résumé de la conversation d’où il vient.

**Les notes qu’écrit un modèle passent le même filtre.** La capture de mémoire
par tour, les résumés de la consolidation nocturne et les résumés de session
d’équipe sont vérifiés avant que quoi que ce soit ne soit écrit dans le coffre,
et toute détection refuse l’écriture :

- **Capture :** la note refusée est abandonnée. Le run de capture est enregistré
  avec la raison `poison_gate`, et il compte dans `maxPerConversation`, parce
  que le modèle a été appelé.
- **Consolidation :** rien n’est écrit et les souvenirs épisodiques restent ; le
  run nocturne suivant réessaie.
- **Sessions d’équipe :** seul le constat ou la décision en cause est laissé de
  côté.

Les refus apparaissent dans le log du serveur avec le nom du détecteur, jamais
avec le texte refusé : un faux positif est donc visible, jamais silencieux.

---

## Mettre en quarantaine la mémoire d’un fournisseur {#quarantine-a-providers-memory}

À utiliser quand un modèle — typiquement une CLI comme Grok CLI, Kimi Code CLI ou Claude Code — a tourné sans l’isolation d’EYAS et a pu répondre à partir d’une
mémoire hors d’EYAS, comme le dossier de mémoire d’un autre outil ou un coffre
Obsidian. Ses réponses ont été enregistrées dans la mémoire EYAS comme tout
autre tour et pouvaient ensuite revenir à tous les modèles.

**Où :** **Mémoire → Aperçu**, carte **Mettre en quarantaine la mémoire d’un
fournisseur**. Seul le propriétaire peut l’utiliser ; les admins et les
utilisateurs voient *Seul le propriétaire peut mettre la mémoire en quarantaine
ou la libérer.*

1. Cochez un ou plusieurs **Fournisseurs**. La liste montre chaque fournisseur
   qui a écrit de la mémoire, avec le nombre de ses lignes encore rappelables.
2. Réglez en option les dates **Du** / **Au**. Ce sont des jours locaux entiers,
   inclus ; vide signifie sans limite.
3. Cliquez sur **Aperçu**. Il indique combien de lignes brutes, de faits, de
   résumés et de notes capturées seraient cachés, et depuis combien de
   conversations. Rien ne change encore.
4. Cliquez sur **Quarantaine**, puis confirmez sur place. Annuler ne change
   rien.

**Ce qui est caché à tous les modèles**, sur tous les chemins (le bloc de
mémoire par tour, `memory_search` / `memory_expand`, l’index de mémoire
permanent et la recherche vectorielle) :

- les réponses du fournisseur et la sortie des outils de ses exécutions —
  d’après le fournisseur enregistré sur chaque ligne ; les lignes plus anciennes
  qui n’en ont pas utilisent le fournisseur auquel la conversation est fixée ;
- chaque fait et chaque résumé qui en dérive, y compris le résumé d’une
  conversation qui couvre aussi vos messages, et tout fait qui a au moins une
  telle source ;
- les notes capturées des conversations concernées. Elles sont déplacées dans le
  dossier du coffre `.quarantine/<id>/…`, et sortent donc de l’explorateur du
  coffre, de l’index des notes et de la recherche.

**Ce qui n’est pas concerné :** vos propres messages ne sont jamais mis en
quarantaine ; la transcription de la conversation ne change pas ; rien n’est
supprimé. Les tours futurs du fournisseur sont toujours enregistrés
normalement — la quarantaine est un nettoyage, pas un blocage : passez la
conversation sur un autre modèle ou assurez-vous que la CLI tourne isolée. Les
notes sémantiques que la consolidation nocturne a écrites à partir de plusieurs
conversations ne portent pas de lien vers une conversation et ne sont pas
retracées ; revoyez-les dans l’explorateur du coffre.

**Historique et libération.** L’historique liste chaque quarantaine avec ses
fournisseurs, son heure et ses nombres, et un bouton **Libérer** (ou *Libérée le
&lt;date&gt;*). La libération restaure exactement les niveaux de confiance
qu’avaient les lignes et remet les notes en place. Si une nouvelle note a pris
le chemin d’une note restaurée, l’ancienne revient sous `<nom>-restored.md`,
toujours marquée comme écrite par un modèle. Une note supprimée à la main du
dossier `.quarantine` est signalée comme manquante ; tout le reste est quand
même restauré. Ce que le contrôle automatique d’empoisonnement avait déjà mis en
quarantaine y reste, tout comme les faits et résumés créés à partir de lignes en
quarantaine après la quarantaine. Remettre en quarantaine la même sélection ne
fait rien ; des quarantaines qui se chevauchent peuvent être libérées
indépendamment.

**Audit.** Chaque application et chaque libération est écrite dans le journal
d’audit (actions `memory.quarantine.apply` / `memory.quarantine.release`, module
`memory`) et dans le log du serveur ; l’enregistrement exact (identifiants de
lignes par niveau de confiance précédent, notes déplacées) est gardé dans le
journal de purge de la mémoire.

**API (propriétaire seulement ; `delete` sur MemoryEntry).** Le corps est
`{providers: string[], from?: epochMs, to?: epochMs, conversationIds?:
string[]}` ; un corps invalide reçoit `400`. `GET /api/v1/memory/quarantine`
renvoie `{entries, providers}` ; `POST /api/v1/memory/quarantine/preview`
renvoie `{counts}` ; `POST /api/v1/memory/quarantine` renvoie
`201 {id, counts}`, ou `200 {id: null}` quand il ne reste rien à mettre en
quarantaine ; `POST /api/v1/memory/quarantine/:id/release` renvoie `404` pour un
identifiant inconnu et `409` si la quarantaine est déjà libérée.

## Blocs de mémoire partagés (retirés) {#shared-memory-blocks-retired}

Les outils d’agent `memory_block_read` et `memory_block_write` n’existent plus.
Ce que les agents avaient stocké dans des blocs n’est pas perdu : au premier
démarrage après la mise à jour, chaque bloc est copié une fois dans la mémoire
EYAS comme note écrite par un modèle, et on le retrouve ensuite comme toute
autre mémoire — dans le rappel permanent, avec `memory_search` et avec
`memory_expand` (comme résultat `rw:`). Les blocs deviennent de la mémoire
globale, ce qu’ils étaient en pratique (n’importe quel agent pouvait lire
n’importe quel bloc). Un bloc dont le texte ressemble à une instruction adressée
à l’assistant est gardé pour l’audit mais jamais rappelé. Un agent personnalisé
dont la liste d’outils nomme encore `memory_block_*` ne reçoit simplement plus
ces outils ; rien n’échoue.

## Voir aussi {#related}

- [Base de connaissances](/docs/fr/knowledge/knowledge-base/)
- [Documents](/docs/fr/knowledge/documents/)
- [Wiki du projet](/docs/fr/knowledge/client-wiki/)
- [Fournisseurs](/docs/fr/ai/providers/) (isolation CLI)
- [Sécurité et confidentialité](/docs/fr/admin/security-privacy/) (mémoire hors d’EYAS)
- [Import de données](/docs/fr/admin/data-port/)
- [Configuration](/docs/fr/deploy/configuration/) (clés `memory.l0.*`)
- [Outils](/docs/fr/automation/tools/)
- [OpenCode](/docs/fr/automation/opencode/) (outils mémoire dans OpenCode)
- [Observabilité](/docs/fr/admin/observability/) (transmission de la mémoire par fournisseur)
