---
title: Routage et budget
description: Niveaux de routage automatique, secours, appels de modèle en arrière-plan, plafonds de dépenses et affectations de modèles par agent.
---

**À quoi ça sert.** Le routage décide *quel* modèle répond — le modèle auquel une nouvelle conversation est fixée, les niveaux entre lesquels est routée une conversation réglée sur Auto, et le modèle sur lequel tourne le travail d'arrière-plan d'EYAS. Le budget décide *combien* vous dépensez avant qu'EYAS avertisse, rétrograde ou s'arrête net. Les affectations de modèles épinglent un modèle par défaut sur chaque agent intégré après la configuration initiale. Ensemble, ils évitent qu'une instance à plusieurs fournisseurs utilise toujours le modèle cher ou se retrouve à court d'argent sans prévenir.

**Chemin :** `/providers` (barre latérale **Fournisseurs**) → onglets **Niveaux de routage** et **Budget**. Affectations de modèles : Paramètres (`/settings`) → carte **Affectations de modèles**.

## Quand l'utiliser

- Les conversations réglées sur Auto doivent recevoir un modèle bon marché pour les questions rapides et un plus puissant pour le code.
- Le travail d'arrière-plan — titres, heartbeat, juge de sécurité, capture mémoire — doit tourner sur un modèle que vous choisissez (le niveau **Battement**).
- Un fournisseur principal cloud/CLI est instable et vous voulez un **Secours** explicite (ou le basculement automatique facultatif).
- Il vous faut des plafonds quotidiens/hebdomadaires/mensuels, un seuil d'avertissement, une rétrogradation et un arrêt net.
- Les agents intégrés n'ont toujours pas de modèle après l'assistant — affectez-les dans les Paramètres.

## Déroulement typique

1. Ouvrez **Fournisseurs** (`/providers`) → **Niveaux de routage**.
2. Vérifiez en haut la carte **Appels de modèle en arrière-plan** : chaque groupe de travail d'arrière-plan doit afficher un modèle, pas *Aucun modèle — repli déterministe*.
3. Passez **Autoriser le routage automatique** sur **Activé** si les conversations réglées sur Auto peuvent être routées par l'analyse du message (indication : *Activé, une conversation réglée sur le routage automatique choisit son modèle à chaque message. Les conversations à modèle fixe ou suivant le modèle par défaut du collègue ne sont jamais réacheminées.*).
4. Pour chaque niveau, réglez le fournisseur et le modèle **Principal**, un **Secours** facultatif et l'**Effort** par défaut du niveau.
5. Ouvrez **Budget** : renseignez **Quotidien / Hebdomadaire / Mensuel** sous **Plafonds de dépenses**, puis **Avertir à / Rétrograder à / Arrêt définitif à** sous **Seuils**.
6. Ouvrez **Paramètres** → **Affectations de modèles** pour épingler un fournisseur et un modèle sur chaque agent de départ, puis **Enregistrer les affectations**.

## Fonctions

<h3 id="auto-failover">Basculement automatique entre fournisseurs (facultatif)</h3>

Quand le **basculement automatique** est activé (`EYAS_AUTO_FAILOVER=1`, ou `model.autoFailover: true` dans la configuration), un second fournisseur actif remplit au démarrage les emplacements de **Secours** vides des niveaux. **Les secours que vous avez réglés ne sont jamais écrasés.**

Servez-vous-en pour la résilience quand un fournisseur principal cloud/CLI est instable ; pour maîtriser coût et qualité, préférez tout de même des secours choisis par vous.

Les budgets mensuels de tokens par agent sont à part (onglet **Configuration** de l'agent).

<h3 id="default-binding">Quel modèle répond quand rien n'en nomme un</h3>

Certains appels d'EYAS ne nomment ni fournisseur ni modèle : le premier message d'une nouvelle conversation (la conversation garde ensuite ce modèle — voir [Conversations — Quel modèle répond](/docs/fr/daily/conversations/#which-model-answers)), les modifications de design par IA, et les exécutions d'agents dont l'agent n'a pas de modèle. Ils vont au **défaut de l'installation**, vérifié dans cet ordre :

1. le niveau de routage **Standard**, si son fournisseur est activé ;
2. sinon le fournisseur et le modèle par défaut de l'installation — fixés quand vous choisissez la **CLI principale** dans l'[assistant de configuration](/docs/fr/setup-wizard/), ou avec `PUT /api/v1/model/defaults` ;
3. sinon le fournisseur activé qui vient en premier dans l'ordre alphabétique et qui a au moins un modèle activé.

Aucun fournisseur n'est préféré par son nom, et l'ordre de démarrage des fournisseurs ne compte pas. Si rien de tout cela n'existe, l'appel échoue avec *No default model binding: configure the Standard tier or a default provider* au lieu de deviner. Les versions précédentes envoyaient ces appels à Anthropic s'il était configuré, sinon au premier fournisseur enregistré — sur une installation multi-fournisseurs sans niveau Standard, ces appels peuvent donc désormais aller à un autre fournisseur qu'avant. Régler le niveau Standard (ou le fournisseur par défaut) le contrôle.

<h3 id="background-model">Le modèle d'arrière-plan</h3>

Le travail d'arrière-plan d'EYAS ne tourne jamais sur un fournisseur que la passerelle choisit au hasard. Il passe par un résolveur unique qui essaie des candidats fixes dans l'ordre et n'utilise qu'un modèle capable d'exécuter un appel **isolé** — sans outils, un seul tour, rien de la mémoire ni de la configuration propres de la CLI. Sont éligibles tous les fournisseurs d'API, Claude Code, et Grok CLI / Kimi Code CLI une fois qu'EYAS a vérifié leur isolation sur cet hôte. Une CLI incapable de s'isoler n'est jamais utilisée, ni comme candidate ni comme **Secours** d'un niveau.

| Travail d'arrière-plan | Candidats, dans l'ordre |
|------------------------|-------------------------|
| Titres des conversations | Niveau **Battement** uniquement — jamais le modèle propre de la conversation ni un autre fournisseur |
| Capture mémoire, consolidation nocturne, briefing de réflexion, briefing du heartbeat, suggestions d'Auto-apprentissage, propositions de Forge, rédaction de skills, enrichissement Data Port | Niveau **Battement** (principal, puis secours) → défaut de l'installation → fournisseurs d'API par ordre alphabétique → CLI capables de tourner isolées |
| Juge de sécurité, critique de complétude, plan de grille pour les objectifs d'arrière-plan complexes | **Battement** → **Rapide** → défaut de l'installation → autres fournisseurs éligibles |
| Proposition d'équipe et re-planificateur entre les phases | **Rapide** → **Standard** → défaut de l'installation → autres fournisseurs éligibles |
| Recherche (élargissement de requête, notation des sources, rédaction, vérification croisée) | **Standard** → défaut de l'installation → fournisseurs d'API → CLI capables de tourner isolées |
| Classifieur du routage automatique | Niveau **Triage** uniquement (principal, puis secours) — voir [Routage automatique](#auto-routing) |

Un second candidat n'est essayé qu'après une panne réseau, un dépassement de délai, une surcharge ou une limite de débit, jamais après que le premier a répondu (en pratique, seul le groupe sécurité en essaie un). Un **arrêt** du budget signifie aucun appel.

<h4 id="background-effort">Effort des appels d'arrière-plan</h4>

Chaque appel d'arrière-plan demande l'effort de raisonnement réglé sur le premier niveau de routage de sa finalité : le niveau **Battement** pour le travail mémoire, le travail d'apprentissage, les titres et les contrôles de sécurité ; **Rapide** pour la re-planification et les propositions d'équipe ; **Standard** pour la recherche ; **Triage** pour le classifieur du routage automatique. Le même effort de niveau s'applique quel que soit le modèle qui répond finalement — le modèle du niveau, le défaut de l'installation, un fournisseur d'API ou une CLI capable de tourner isolée — et il est ajusté à ce modèle : un niveau non pris en charge passe au plus proche qu'il accepte. Triage, Rapide et Battement sont par défaut sur *Faible* : par défaut, la plupart des appels d'arrière-plan demandent donc Faible ; la recherche suit Standard, qui est par défaut sur Automatique. Un niveau réglé sur Automatique n'envoie aucun paramètre d'effort. Quand le modèle n'a pas de contrôle d'effort, ou qu'EYAS ne peut pas savoir quel modèle répond (une CLI appelée sans modèle précis, fréquent sur les installations uniquement CLI), rien n'est envoyé et le défaut du modèle s'applique.

<h4 id="background-traced">Tracés et comptabilisés</h4>

Chaque appel d'arrière-plan est tracé comme un tour de conversation — fournisseur, modèle, tokens, coût, latence, sa finalité, l'effort demandé et effectif — et son coût compte dans les plafonds quotidien, hebdomadaire et mensuel du budget, comme les tours de conversation. Un appel d'arrière-plan qui n'a pas pu tourner faute de modèle éligible ne fait aucun appel modèle : il ne laisse aucune trace et ne coûte rien. Voir [Observabilité — Utilisation](/docs/fr/admin/observability/#usage-tab).

Chaque appel d'arrière-plan envoie ses instructions comme un vrai prompt système et exactement un message utilisateur, chez tous les fournisseurs — jamais comme une ligne utilisateur ou assistant.

<h4 id="background-no-model">Quand aucun modèle n'est éligible</h4>

Par exemple sur une installation uniquement Grok ou uniquement Kimi avant la vérification de leur isolation, EYAS ne fait aucun appel modèle et chaque fonction garde son résultat déterministe : l'extrait du premier message reste le titre ; le heartbeat envoie l'alerte *Heartbeat: items may need your attention* avec sa liste de raisons ; l'Auto-apprentissage affiche ses suggestions génériques ; Forge garde la proposition concaténée ; Skill Evolution écrit le modèle `SKILL.md` ; la capture mémoire enregistre un saut ; la consolidation laisse les groupes pour une nuit suivante ; le briefing garde sa partie déterministe ; le juge de sécurité escalade vers votre approbation ; le critique marque l'exécution *Non vérifiée* ; la proposition d'équipe est un seul agent ; la recherche assemble son rapport à partir des meilleures sources. Sur une installation où Claude Code est le seul modèle, chacun de ces appels lance un bref processus Claude Code isolé.

<h3 id="background-model-calls-card">Carte Appels de modèle en arrière-plan</h3>

L'onglet **Niveaux de routage** s'ouvre sur la carte **Appels de modèle en arrière-plan**. Elle montre où part en ce moment le travail d'arrière-plan d'EYAS, sans faire aucun appel modèle. Il y a une ligne par groupe :

| Groupe | Ce qu'il couvre |
|--------|-----------------|
| **Mémoire : capture, consolidation, réflexion, enrichissement des imports** | Capture, consolidation nocturne, briefing de réflexion, enrichissement des imports Data Port |
| **Apprentissage : battement, auto-apprentissage, Forge, rédaction de skills** | Le heartbeat, l'Auto-apprentissage, Forge, la rédaction de skills |
| **Titres des conversations** | Titres automatiques |
| **Sécurité : juge de sécurité, critique d'exhaustivité, grille d'objectifs** | Juge de sécurité, critique de complétude, grille d'objectifs |
| **Planification : proposition d'équipe, replanificateur** | Proposition d'équipe, re-planificateur entre les phases |
| **Recherche** | Exécutions de recherche |
| **Tri du routage automatique** | Le classifieur du routage automatique |

Chaque ligne affiche soit le fournisseur et le modèle que prendrait le prochain appel du groupe, sous la forme *Fournisseur · Modèle*, avec un badge qui en indique l'origine — **Niveau** (le niveau de routage du groupe, principal puis secours), **Par défaut** (le défaut de l'installation), **Fournisseur d'API** ou **CLI isolée** (une CLI capable d'exécuter des appels isolés ; elle n'affiche que le nom du fournisseur, car elle exécute son propre modèle par défaut) —, soit **Aucun modèle — repli déterministe**, avec la raison :

- *Aucun fournisseur ne peut exécuter un appel isolé* — rien d'éligible n'est activé, par exemple une installation uniquement Grok ou uniquement Kimi avant qu'EYAS ait vérifié leur isolation, ou un niveau qui nomme une telle CLI ;
- *Son niveau n'est pas configuré* — seulement pour les titres et le tri, qui n'utilisent que leur niveau ;
- *Limite de budget atteinte* — un arrêt du budget bloque tous les appels d'arrière-plan.

La carte montre le premier candidat. Quand un groupe n'a aucun fournisseur éligible, un bandeau rouge indique qu'une partie du travail d'arrière-plan n'a aucun modèle utilisable, qu'elle applique donc son repli intégré sans appeler de modèle, et vous invite à activer un fournisseur d'API ou une CLI dont EYAS a vérifié l'isolation. Un niveau manquant ou un arrêt du budget affiche sa raison sur la ligne, sans bandeau. La carte se rafraîchit à chaque ouverture de l'onglet Niveaux de routage et après chaque changement de niveau dans cet onglet.

**API (intégrateurs).** `GET /api/v1/routing/auxiliary` (lecture de Settings ; `401` sans connexion, `403` sans le droit) renvoie `{ groups: [ { group, purposes, target: { provider, model | null, route } | null, reason | null } ] }` — `group` vaut `memory`, `learning`, `title`, `safety`, `planning`, `research` ou `triage` ; `route` vaut `tier`, `default`, `api` ou `isolated-cli` ; `reason` vaut `no_eligible_provider`, `tier_not_configured` ou `budget_stop`. Il ne répond `503` que si le service de modèle d'arrière-plan est indisponible. Les appels d'arrière-plan sont étiquetés avec leur finalité dans les traces de l'[Observabilité](/docs/fr/admin/observability/).

## Champs et contrôles

<h2 id="auto-routing">Routage automatique</h2>

| Contrôle | Signification |
|----------|---------------|
| **Autoriser le routage automatique** Activé/Désactivé | Autorise le routage automatique pour les conversations réglées sur Auto. Il ne route pas les autres conversations |
| Indication | *Activé, une conversation réglée sur le routage automatique choisit son modèle à chaque message. Les conversations à modèle fixe ou suivant le modèle par défaut du collègue ne sont jamais réacheminées.* |

**Seules les conversations réglées sur Auto sont routées.** Une conversation garde le modèle sur lequel elle tourne : un modèle fixe, ou le modèle de son collègue, n'est jamais trié. Pour une conversation réglée sur Auto, le message est classé et routé vers le niveau **Rapide**, **Standard**, **Complexe** ou **Exécution de code**. Tant que l'interrupteur est désactivé, une conversation Auto utilise son modèle enregistré et le dit. Quand tous les niveaux pointent vers le même modèle (par exemple une installation à une seule CLI), aucune classification n'a lieu. Vous choisissez le routage automatique par conversation dans le sélecteur de modèle de sa barre supérieure ; l'entrée est grisée tant qu'**Autoriser le routage automatique** est désactivé. Voir [Conversations — Quel modèle répond](/docs/fr/daily/conversations/#which-model-answers).

**Le classifieur.** Les règles par mots-clés passent d'abord et ne coûtent rien : un message qu'elles savent classer (par exemple une traduction, une revue de code ou une demande de débogage) ne fait aucun appel modèle. Seul un message qu'elles ne savent pas classer est envoyé au modèle du niveau **Triage** — son Principal, ou son Secours quand le Principal n'est pas utilisable, et seulement si ce fournisseur peut exécuter des appels isolés. Il ne se rabat jamais sur le niveau Standard, le défaut de l'installation ni un autre fournisseur. L'appel est isolé (sans outils, sans mémoire ni configuration du fournisseur, sans session conservée), n'envoie que les 500 premiers caractères du message, passe par le même masquage de confidentialité et le même traçage que tout autre appel modèle, et compte dans les plafonds de dépenses. S'il n'existe pas de tel modèle, si l'arrêt net du budget est atteint ou si la réponse n'est pas une catégorie et une complexité valides, la classification par mots-clés décide et le tour n'est pas retardé. Sur une installation uniquement Claude Code, un message non classé dans une conversation Auto attend tout de même un bref appel Claude Code isolé avant le début de la réponse.

<h2 id="tiers">Niveaux de routage</h2>

Chaque niveau a un fournisseur et un modèle **Principal** et un **Secours** facultatif :

| Niveau | Usage typique |
|--------|---------------|
| **Triage** | Le classifieur du routage automatique pour les messages que les règles par mots-clés ne savent pas classer (principal et secours seulement) |
| **Rapide** | Réponses rapides et bon marché |
| **Standard** | Qualité par défaut — aussi le défaut de l'installation pour les appels qui ne nomment aucun modèle ([plus haut](#default-binding)) |
| **Complexe** | Tâches difficiles |
| **Exécution de code** | Travail riche en code |
| **Battement** | Premier choix pour le travail d'arrière-plan d'EYAS — titres (seul candidat), heartbeat, capture mémoire, juge de sécurité et plus ([plus haut](#background-model)) |
| **Embedding** | N'alimente que l'ancien index de recherche du coffre et épisodique. Le rappel de mémoire ne l'utilise jamais : le rappel calcule toujours ses embeddings en local (voir [Mémoire — La recherche vectorielle tourne toujours en local](/docs/fr/knowledge/memory/#vector-search-always-runs-locally)). Si le niveau nomme un fournisseur incapable de calculer des embeddings, cet index utilise aussi l'embedder local ; quand son embedder change, l'index est vidé une fois et reconstruit automatiquement |
| **Améliorateur de prompts** | Le Prompt Enhancer de la zone de saisie de la conversation et le coach de prompt des projets et des agents ([Prompts](/docs/fr/ai/prompts/)) |

| Champ | Signification |
|-------|---------------|
| **Sélectionnez un fournisseur…** | Fournisseur principal du niveau |
| **Sélectionnez un modèle…** | Modèle principal |
| **Secours** (**Sélectionnez un secours…** / **Aucun**) | Remplaçant si le principal échoue |
| **Effort** | L'effort de raisonnement par défaut du niveau (tous les niveaux sauf **Embedding**) — voir [plus bas](#tier-effort) |

Sur une installation Kimi Code CLI, les niveaux qu'EYAS avait lui-même réglés sur les lignes retirées *Kimi Code CLI (K3)*, *(K2.7 Code)* ou *(K2.6)* passent au démarrage sur **Kimi Code CLI** (la ligne par défaut), qui est ce qu'ils ont toujours exécuté ; une nouvelle installation uniquement Kimi démarre tous les niveaux dessus, sans secours. Voir [Fournisseurs — Modèles Kimi et réflexion](/docs/fr/ai/providers/#kimi-models-and-thinking).

<h3 id="tier-effort">Effort par défaut du niveau</h3>

Chaque niveau de routage sauf **Embedding** a un sélecteur **Effort** : l'effort de raisonnement par défaut des appels dirigés vers ce niveau. **Triage**, **Rapide** et **Battement** sont par défaut sur *Faible* ; tous les autres niveaux sur *Automatique* (le défaut du modèle). Le sélecteur ne liste que les niveaux acceptés par le modèle du niveau ; choisir un modèle qui ne propose pas le niveau enregistré le modifie avant l'enregistrement et le signale (*Effort ajusté de … à …*), et un niveau que le modèle n'accepte pas est refusé avec *Le modèle ne propose pas ce niveau d'effort. Rien n'a été enregistré.*

Le défaut du niveau s'applique à deux endroits :

- **Un message routé par le niveau**, quand rien de plus haut dans l'ordre ne fixe de niveau : niveau propre de la conversation > Profond (Maximum) > collègue > conversation qui délègue > niveau de routage > défaut du modèle.
- **Les appels d'arrière-plan d'EYAS** dont c'est le premier niveau — Battement pour la mémoire, l'apprentissage, les titres et les contrôles de sécurité ; Rapide pour la re-planification et les propositions d'équipe ; Standard pour la recherche ; Triage pour le classifieur ([plus haut](#background-effort)).

Changer l'effort d'un niveau change donc à la fois les messages routés par ce niveau et les appels d'arrière-plan qui l'utilisent. Les installations existantes ont reçu le défaut *Faible* une fois, au premier démarrage après la mise à jour ; un niveau que vous remettez ensuite sur Automatique reste sur Automatique. `PUT /api/v1/routing/tiers/:tier` valide son corps : un niveau inconnu renvoie `404`, et un effort que le modèle du niveau n'accepte pas renvoie `400` avec le code `EFFORT_UNSUPPORTED` et les niveaux acceptés. Voir [Fournisseurs — Effort de raisonnement](/docs/fr/ai/providers/#reasoning-effort).

<h2 id="budget">Budget / plafonds de dépenses</h2>

| Champ | Signification |
|-------|---------------|
| **Quotidien / Hebdomadaire / Mensuel** (**Plafonds de dépenses**) | Plafonds en dollars pour la période ; vide signifie *illimité* |
| **Avertir à** (**Seuils**) | Seuil d'avertissement, en fraction du plafond (affiché en pourcentage ; défaut 0,8 = 80 %) |
| **Rétrograder à** | Passer à des modèles moins chers (défaut 1,0 = 100 %) |
| **Arrêt définitif à** | Bloquer toute dépense supplémentaire, appels d'arrière-plan compris (défaut 1,2 = 120 %) |

<h2 id="model-assignments">Affectations de modèles (Paramètres)</h2>

Le remplacement authentifié de l'étape facultative des modèles d'IA de l'assistant (cette étape est bloquée une fois la configuration initiale terminée).

| Contrôle | Signification |
|----------|---------------|
| Nom de l'agent | Agent intégré / de départ |
| Sélecteur de modèle | **— aucun —** ou un modèle des fournisseurs activés, affiché comme *Fournisseur / modèle* |
| **Enregistrer les affectations** | PUT `/api/v1/model/agent-assignments` (`manage Model`) |

L'enregistrement stocke ensemble le fournisseur et le modèle, pour qu'un identifiant de modèle listé par deux fournisseurs ne soit jamais ambigu. L'API accepte `{assignments: {agentId: {providerId, modelId}}}` ou l'ancien `{agentId: modelId}` ; un identifiant de modèle listé par plusieurs fournisseurs est alors stocké sans fournisseur. Si un modèle n'est pas au catalogue, elle renvoie `400` avec `code: unknown_model` et les `agents`, et rien n'est écrit.

La carte se masque tant qu'il n'y a pas d'agents de départ ou de modèles.

## Voir aussi

- [Fournisseurs](/docs/fr/ai/providers/)
- [Observabilité](/docs/fr/admin/observability/)
- [Agents — budget de tokens](/docs/fr/agents/configure/)
- [Prompts](/docs/fr/ai/prompts/)
- [Proactif](/docs/fr/automation/proactive/)
