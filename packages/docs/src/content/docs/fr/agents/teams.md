---
title: Équipes et délégation
description: Les collègues à qui vous parlez, les spécialistes qu’ils lancent, et quand une proposition d’équipe apparaît encore.
---

**À quoi ça sert.** Vous parlez à des **collègues** (agents principaux et d’équipe). Ils ont des rôles stricts. Ils passent le travail à un autre collègue ou lancent des **spécialistes** depuis un pool partagé — automatiquement, souvent en parallèle. Une carte de proposition d’équipe n’apparaît que s’il manque un spécialiste, si vous avez demandé une équipe, ou si le travail est épique.

C’est de la collaboration, pas le Mode Dieu (plusieurs modèles en course sur la même tâche).

## Quand l’utiliser

- Vous voulez parler à l’Assistant personnel ou à l’Ingénieur système comme à des personnes, pas via un menu déroulant caché.
- Un travail demande plusieurs spécialistes à la fois (`run_specialist` dans un même tour).
- Des worktrees git pour que des éditeurs en parallèle ne se gênent pas (sessions implicites avec deux spécialistes rédacteurs ou plus, et propositions d’équipe épiques).
- Vous voulez toujours un plan visible à **Approuver** quand un spécialiste n’existe pas encore.

## Déroulement typique

1. Ouvrez un **collègue** depuis la barre latérale (**Collègues**), ou choisissez-en un dans une nouvelle conversation.
2. Demandez-lui le travail. Il doit utiliser `handoff_to_colleague` ou `run_specialist` au lieu de faire le travail d’un autre rôle.
3. Les exécutions de spécialistes apparaissent comme sous-conversations. La mémoire d’équipe fonctionne sans carte de proposition (session implicite).
4. Cliquez sur **Ouvrir le tableau de bord d'équipe** quand plusieurs spécialistes travaillent en même temps.
5. Une carte **Proposition d'équipe** apparaît encore pour `/team`, « utilise une équipe » ou un travail épique — **Approuver** ou **Ignorer**.

## Concepts

| Concept | Signification |
|---------|---------------|
| **Collègue** | Agent principal ou d’équipe à qui vous écrivez directement. A un fil d’accueil et une voix (SOUL). |
| **Spécialiste** | Travailleur au périmètre étroit. Pool partagé — tout collègue peut lancer tout spécialiste activé. |
| **`run_specialist`** | Lancement en ligne ; attend un résumé. Vert (sans clic). Alias : `delegate_to_agent`. |
| **`handoff_to_colleague`** | Ouvre le fil d’accueil de l’autre collègue et y lance aussitôt une exécution, avec la consigne comme objectif. Refusé avec un message *busy* tant que ce fil est occupé. Vert. Voir [Conversations — Passage de relais](/docs/fr/daily/conversations/#handoff). |
| **`assign_task`** | Carte de tableau asynchrone. Vert si la cible est activée. |
| **`propose_team`** | Carte pour des rôles manquants / un travail épique / une demande explicite. Jaune. |
| **Fil d’accueil** | Une conversation continue par collègue. |
| **Session de travail implicite** | Créée au premier lancement de spécialiste pour que la mémoire d’équipe fonctionne sans carte. |

## Niveaux

| Niveau | Vous leur parlez ? | Travail typique |
|--------|--------------------|-----------------|
| **Principal** | Oui | Coéquipiers créés à l’installation (Assistant, Ingénieur) |
| **Équipe** | Oui | Collègues permanents (réviseur, critique, …) |
| **Spécialiste** | Non (enfant / tâche uniquement) | Exécution dans un seul domaine |

## Une seule façon de lancer des spécialistes, sur tous les fournisseurs

Les spécialistes passent toujours par EYAS. Quand un collègue répartit le travail — en orchestration **Auto** comme **Profond** —, il lance des spécialistes avec `run_specialist`, quel que soit le fournisseur sur lequel il tourne : Claude Code, Grok CLI, Kimi CLI ou un fournisseur d’API. Claude Code ne lance pas de sous-agents cachés à lui : son outil intégré Task/Agent ne lui est pas proposé.

Chaque spécialiste tourne avec sa configuration d’agent EYAS — prompt de persona, mémoire EYAS, outils configurés — et apparaît comme une sous-conversation que vous pouvez ouvrir, avec sa propre exécution supervisée et sa transcription. Le mode **Profond** sur Claude Code peut prendre plus de temps, car chaque spécialiste est une exécution EYAS complète.

**Profond donne à chaque modèle la même consigne :** découper le travail non trivial et lancer un spécialiste par partie indépendante, en parallèle, chacun avec une consigne précise et autonome ; passer le relais avec `handoff_to_colleague` quand le travail revient à un autre collègue ; ne proposer une équipe que si un spécialiste nécessaire n’existe pas encore ; vérifier les résultats importants avant de conclure ; et garder pour soi la synthèse finale.

**Sécurité.** La porte de sécurité ne pré-approuve pas le nom de l’outil de sous-agents de Claude Code. Claude Code ne se voit jamais proposer cet outil, et un appel à celui-ci serait traité comme non classé et soumis à approbation au lieu d’être autorisé.

<h2 id="which-model-and-effort-a-specialist-or-member-uses">Quel modèle et quel effort utilise un spécialiste ou un membre</h2>

**Modèle.** Le modèle d’un agent est une paire fournisseur + modèle (voir [Créer et configurer — Modèle et effort](/docs/fr/agents/configure/#model--effort)). S’il est vide, l’agent tourne sur le modèle propre de la conversation :

- Un **spécialiste** lancé avec `run_specialist` / `delegate_to_agent`, une carte distribuée avec `assign_task` et une sous-conversation créée avec `create_sub_conversation` tournent sur le modèle **sur lequel le tour qui délègue a réellement tourné**. Cette paire est enregistrée sur la nouvelle sous-conversation ; elle n’est pas copiée depuis les réglages enregistrés de la conversation parente. Sur Claude Code, Grok et Kimi, le modèle du tour qui délègue atteint aussi les outils EYAS appelés via le pont.
- Un **membre d’équipe** tourne sur son propre modèle, sinon sur le modèle actuel du chef (le modèle sur lequel tourne en ce moment la conversation parente ; pour une conversation en routage automatique, son niveau Standard), sinon sur le défaut de l’installation.
- À défaut de tout cela, le défaut de l’installation s’applique (niveau Standard → fournisseur par défaut → premier fournisseur actif ayant un modèle activé, fournisseurs CLI compris), et il est fixé sur cette conversation à sa première exécution.
- Si le modèle propre de l’agent n’est pas utilisable (son fournisseur est désactivé ou le modèle est désactivé), l’exécution utilise le modèle enregistré de la conversation (celui du tour qui délègue), sinon le défaut, et la réponse enregistre la note `agent-binding-unavailable`. EYAS ne choisit jamais un autre fournisseur par son nom. Si aucun modèle n’est configuré, l’exécution échoue avec *Aucun modèle n'est configuré…* et n’est pas relancée.

Il n’existe pas de routeur de modèles d’équipe réservé à Anthropic : un membre sans modèle ne tourne pas sur l’API Anthropic simplement parce qu’une clé Anthropic est configurée, et les configurations d’équipe n’ont pas de `modelRouting`.

**Effort.** Un membre ou spécialiste doté de son propre effort le garde. Un membre sans effort hérite du niveau de la conversation qui a délégué le travail : une conversation **Profond** envoie donc ses spécialistes en *Maximum* — ce qui coûte plus cher. Chaque niveau est ensuite ajusté au modèle qui répond, et chaque réponse enregistre ce qui a été demandé et ce qui a tourné. Voir [Fournisseurs — Effort de raisonnement](/docs/fr/ai/providers/#reasoning-effort).

## Mémoire et outils dans les exécutions d’équipe

- Les spécialistes, les agents délégués et les membres d’équipe reçoivent le même bloc de mémoire rappelée qu’un tour de chat, joint à leur tâche ou à leur consigne (voir [Mémoire — Comment le rappel atteint le modèle](/docs/fr/knowledge/memory/#how-recall-reaches-the-model)).
- La consigne de chaque membre est aussi mémorisée, comme un texte écrit par un agent et non par vous.
- La capture de mémoire durable s’exécute aussi sur chaque spécialiste, agent délégué et membre d’équipe, sous les mêmes réglages `memory.capture.*` qu’un tour de chat. La tâche ou la consigne est lue comme une instruction qu’un agent a pu écrire : seuls les faits qu’elle énonce sur vous, le projet ou le monde sont gardés, jamais les étapes de la tâche elle-même. Chacun tourne dans sa propre sous-conversation et a donc son propre plafond `maxPerConversation`, et chaque exécution dont l’instruction fait au moins `minUserChars` caractères peut coûter un appel de modèle d’arrière-plan supplémentaire. Voir [Mémoire — Le capture est activé par défaut](/docs/fr/knowledge/memory/#capture-is-on-by-default).
- Chaque membre se voit proposer la liste **Outils** de son agent plus les outils mémoire ([Créer et configurer — Outils](/docs/fr/agents/configure/#tools--constraints)), avec chaque fournisseur.
- Dans une exécution d’équipe, chaque membre affiche en direct l’outil en cours, quel que soit son fournisseur.

## Proposition d’équipe et re-planification

La proposition d’équipe est rédigée par le modèle d’arrière-plan d’EYAS en un appel isolé sans outils, sur les niveaux de planification : **Rapide**, puis **Standard**, puis le défaut de l’installation ou un autre fournisseur capable d’exécuter des appels isolés. Sans modèle d’arrière-plan éligible — par exemple une installation dont le seul modèle est une Grok CLI ou Kimi CLI dont EYAS n’a pas encore vérifié la capacité à exécuter des appels isolés, ou quand le budget modèle est épuisé — la carte propose un seul agent (le premier agent activé). Entre les phases, le re-planificateur fonctionne de la même façon : sans modèle d’arrière-plan éligible, l’équipe garde son plan actuel. Voir [Routage et budget — Le modèle d’arrière-plan](/docs/fr/ai/routing-budget/#background-model).

## Worktrees et vérification

| Comportement | Quand |
|--------------|-------|
| **Worktrees git** | Deux spécialistes rédacteurs ou plus dans une session implicite, et propositions d’équipe pour des objectifs **complex** / **epic** — sous `.eyas-worktrees/` |
| **Commandes de vérification** | `agent.verifyCommands` optionnel en YAML — voir [Configuration](/docs/fr/deploy/configuration/) |

## Dans les conversations

Voir [Conversations](/docs/fr/daily/conversations/) :

- Arbre des sous-conversations
- Tableau de bord d’équipe (constats, décisions, blocages)
- Carte de proposition d’équipe : **Approuver** / **Ignorer**, et **Créer maintenant** pour les spécialistes manquants
- **Ouvrir &lt;nom&gt;** sur la ligne d’outil quand un collègue prend le relais

## Parcours d’installation

L’assistant de configuration crée deux collègues principaux. L’étape optionnelle **Agents d'équipe** ajoute d’autres collègues et spécialistes. Les spécialistes viennent aussi des modèles ou de **Créer un agent**. Modifiez-les ensuite sous **Agents**.

## Voir aussi

- [Conversations](/docs/fr/daily/conversations/)
- [Exécutions et Mission Control](/docs/fr/agents/runs/)
- [Vue d'ensemble des agents](/docs/fr/agents/overview/)
