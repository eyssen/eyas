---
title: Conversations
description: Parlez aux agents — envoyez du travail, joignez des designs, pilotez l’orchestration dans un fil.
---

**À quoi ça sert.** Une conversation est l’endroit où vous parlez à un agent. Les messages vont dans le volet principal ; projet, étape, sources, fichiers et exécution vivent dans la colonne de droite. Le même fil est une carte du Tableau : chat et pipeline restent un seul enregistrement.

## Quand l’utiliser

- Un agent doit faire un travail, et vous voulez voir la réponse, les appels d’outils et la progression au même endroit.
- Vous devez épingler quel arbre de code indexé (version d’Odoo, addons) ce fil peut chercher, et quels **dossiers de travail** les outils fichier peuvent toucher.
- Vous voulez choisir avec quel modèle la conversation répond — un modèle fixe, le routage automatique ou le modèle par défaut du collègue (le sélecteur de modèle de la barre supérieure).
- Une compétence correspond et attend — vous l’acceptez, vous l’ignorez pour ce fil, ou vous la désactivez globalement.
- Vous voulez que le modèle écrive un plan et attende avant tout outil (**Plan d’abord**).
- Vous voulez que plusieurs modèles fassent la course sur la même tâche (**Mode Dieu**), ou que les collègues fassent appel à des spécialistes (`run_specialist`) sans carte d’équipe.
- Vous voulez qu’un canevas de design voyage à chaque tour, ou que le Prompt Enhancer façonne le brouillon avant l’envoi.

## Déroulement typique

1. Ouvrez un **collègue** dans la liste **Collègues** de la barre latérale (son fil d’accueil), cliquez **Nouvelle conversation** (section **Principal**), ou ouvrez une carte depuis le **Tableau** / les **Conversations récentes** de l’Accueil. Route `/conversations/:id`.
2. Réglez **Projet :**, **Étape :** et l’agent avant le premier message (l’agent se verrouille ensuite). Le sélecteur d’agent liste vos collègues **Principal** et **Équipe**. Épinglez **Sources** si plusieurs arbres de code sont indexés. Vérifiez **Dossiers de travail** — un nouveau fil hérite de la liste du projet (ou de celle du type de projet quand le projet n’en a pas).
3. Tapez dans le compositeur. Utilisez le **Prompt Enhancer** si le brouillon a besoin d’être façonné ; l’icône carte est **Plan d’abord** (écrire un plan et attendre avant les outils). Joignez des fichiers ou, depuis la barre supérieure, des **Designs**.
4. Si une carte de proposition de compétence apparaît, choisissez **L'utiliser**, **Pas cette fois** ou **Désactiver**. Envoyez. La réponse arrive en flux avec des lignes d’outils en direct, la légende *Fournisseur · modèle* dessous, et la fine barre de contexte qui montre le remplissage de la fenêtre du modèle. **Arrêter** annule l’exécution.

## Fonctions

Disposition : la **barre supérieure** et la **barre de champs** au-dessus des **messages + compositeur** (volet principal) ; à droite, le bandeau **Exécution** (arbre d’exécution, progression de l’agent, sous-conversations) au-dessus du **rail de contexte** (chatter : historique, sources, dossiers, étapes suivantes, fichiers).

## Statut de la conversation

| Statut | Signification |
|--------|---------------|
| **Inactif** | Aucune exécution d’agent active |
| **En cours…** | L’agent s’exécute |
| **En attente** | En attente d’une entrée de votre part ou externe |
| **En attente d'approbation** | Bloqué par une approbation humaine (sécurité / autonomie) |
| **En attente du plan** | Tour « Plan d’abord » : la carte du plan attend **Approuver** / **Ignorer le plan** / **Refuser** |
| **Archivé** | Fil fermé / archivé |

---

## Barre supérieure

De gauche à droite : la flèche de retour, le titre (cliquez pour le renommer — voir [Titre automatique](#automatic-title)), le badge de statut, le nom du collègue, une icône d’aide, la priorité, l’icône du terminal OpenCode, l’icône **Designs**, la portée de voix et le sélecteur de modèle. La fine barre le long du bord supérieur est la barre de contexte ([Composition du contexte](#context-composition)).

| Commande | Signification |
|----------|---------------|
| **Basse / Normale / Haute / Urgente** | Priorité métier de la conversation (également affichée sur le Tableau) |
| Icône terminal (*Terminal OpenCode*) | Ouvre un terminal OpenCode pour cette conversation au-dessus du rail de droite. Affichée seulement pour le propriétaire et les administrateurs (le droit de gestion d’OpenCode) — voir [OpenCode — Qui peut ouvrir un terminal](/docs/fr/automation/opencode/#who-can-open-a-terminal) |
| **Designs** (icône de formes) | Canevas qui voyagent à chaque tour — voir [Designs joints](#attached-designs) |
| **Voix: …** | La portée de voix active et son remplacement — voir [Portée de voix](#voice-scope) |
| **Modèle** (à droite) | Cliquez pour choisir comment cette conversation choisit son modèle. Il a un champ de recherche (*Rechercher un modèle…*) et trois sortes de choix : **Modèle fixe** — chaque modèle activé d’un fournisseur activé, groupé sous *Modèle fixe · &lt;fournisseur&gt;* (par exemple *Modèle fixe · Claude Code CLI*) ; **Routage automatique** — EYAS choisit un modèle pour chaque message ; **Par défaut du collègue (&lt;modèle&gt;)** — seulement sur une conversation avec un collègue et sur les sous-conversations. |
| *Modèle par défaut — fixé au premier message* | Une nouvelle conversation sans collègue : le modèle par défaut actuel y est fixé avec le premier message et reste quand les défauts changent plus tard |
| Info-bulle | Quel modèle répond au prochain message et pourquoi, par exemple *Répond avec Claude Code CLI / sonnet — le modèle fixé pour cette conversation*. Autres raisons : le modèle propre du collègue ; le modèle de la conversation qui a délégué celle-ci ; le routage automatique choisit le modèle pour chaque message (affiché : le niveau Standard) ; le modèle par défaut |
| Icône d’avertissement | Un repli s’applique (le modèle du collègue ou le modèle propre de la conversation n’est pas disponible, ou le routage automatique est désactivé ou n’a pas de niveau), ou aucun modèle ne peut répondre. Survolez-la pour la raison |
| **Routage automatique** grisé | Le routage automatique n’est pas autorisé : *activez « Autoriser le routage automatique » dans Fournisseurs.* |
| Sélecteur estompé | Le Mode Dieu est activé : *Le Mode Dieu utilise la liste des Paramètres* |

Les noms des fournisseurs sont les mêmes partout dans l’application — dans le sélecteur, dans la légende de la réponse, dans les messages d’erreur et sur la page Fournisseurs.

### Quel modèle répond {#which-model-answers}
Une conversation garde le modèle sur lequel elle tourne ; les messages ne sont pas re-routés un par un. Vous choisissez comment dans le sélecteur de modèle (ci-dessus).

- **Modèle fixe.** Une conversation fixée à un modèle répond toujours avec lui. Une nouvelle conversation sans collègue qui ne nomme aucun modèle reçoit le défaut de l’installation — le niveau de routage Standard, sinon le fournisseur par défaut, sinon le premier fournisseur actif qui a un modèle, CLI comprises — à son **premier message**, et le garde ensuite. Changer plus tard le fournisseur par défaut ou les niveaux de routage ne déplace pas les conversations existantes. Les conversations créées auparavant gardent le fournisseur et le modèle déjà enregistrés sur elles ; une ancienne conversation sans modèle enregistré reçoit le défaut actuel à son message suivant.
- **Par défaut du collègue.** Une conversation avec un collègue, et une sous-conversation, suit le modèle propre du collègue ; sinon le modèle de la conversation qui l’a déléguée ; sinon le modèle par défaut, fixé à son premier message. Un spécialiste lancé avec `run_specialist` / `delegate_to_agent`, une carte confiée avec `assign_task` et une sous-conversation créée avec `create_sub_conversation` tournent sur le modèle **sur lequel le tour qui délègue a réellement tourné** — pas une copie des réglages enregistrés du parent. Le fil d’accueil d’un collègue ouvert par une passation suit le modèle du collègue, pas celui de la conversation qui a passé la main. Si le modèle du collègue n’est pas disponible (son fournisseur est désactivé ou le modèle est désactivé), la conversation se rabat sur son modèle enregistré ou par défaut et la réponse enregistre la note `agent-binding-unavailable` ; EYAS ne choisit jamais un autre fournisseur par son nom.
- **Le routage automatique** est un choix par conversation. Seule une conversation réglée sur Auto est triée : son message est classé et routé vers le niveau Quick, Standard, Complex ou Code. L’interrupteur **Autoriser le routage automatique** de la page Fournisseurs ne fait que l’*autoriser* ; tant qu’il est éteint, l’entrée du sélecteur est grisée, et une conversation Auto existante utilise son modèle enregistré et le signale. Les conversations existantes ne passent pas automatiquement en Auto. Voir [Routage et budget](/docs/fr/ai/routing-budget/#auto-routing).
- **Un modèle que vous avez choisi n’est jamais remplacé en silence.** Si un modèle choisi dans le sélecteur devient ensuite indisponible (lui ou son fournisseur est désactivé, ou une CLI cesse de le proposer), EYAS ne répond pas avec un autre modèle : le message est refusé et n’est pas stocké, avec *Le modèle &lt;fournisseur&gt; / &lt;modèle&gt; n’est pas disponible : lui ou son fournisseur est désactivé. Choisissez un autre modèle dans le sélecteur de modèle en haut de la conversation, ou activez-le dans Fournisseurs.* Le sélecteur affiche le modèle en rouge avec la même raison, et choisir un autre modèle règle le problème. Les exécutions de cartes en arrière-plan sur une telle conversation échouent de la même façon.
- **Les modèles qu’EYAS a fixés lui-même se rabattent avec une note.** Le défaut fixé au premier message, les conversations d’avant le sélecteur, et le modèle délégant d’une sous-conversation : quand l’un d’eux est indisponible, la conversation répond avec le modèle par défaut et le signale (icône d’avertissement et info-bulle). Elle revient automatiquement à son propre modèle dès qu’il est de retour. Le message n’est refusé (code `model_binding_unavailable`) que s’il n’y a pas non plus de défaut. Sans aucun modèle configuré, l’exécution échoue avec *Aucun modèle n'est configuré…* (code `no_model_configured`) et n’est pas retentée.

**Qui a répondu.** Chaque réponse de l’assistant affiche une petite légende *Fournisseur · modèle* (par exemple *Grok CLI · grok-4*). Son info-bulle indique *Répondu par …* et ajoute pourquoi ce modèle a été utilisé et tout repli. Si un basculement a répondu avec un autre modèle, la légende nomme le modèle qui a réellement répondu. Une réponse encore en cours de diffusion affiche le modèle dès le début du tour ; les réponses en Mode Dieu affichent le modèle gagnant.

**Le contexte est conservé lors d’un changement.** Changer de fournisseur ou de modèle garde le contexte de la conversation. EYAS envoie toute la conversation depuis son propre stockage à chaque tour ; aucun fournisseur — Claude Code, Grok CLI et Kimi Code CLI compris — ne garde ni ne reprend de session à lui. Voir [Fournisseurs — Continuité des conversations](/docs/fr/ai/providers/#conversation-continuity).

**API (intégrateurs).** `POST /api/v1/conversations` n’enregistre `providerId` + `modelId` que si les deux désignent un modèle activé d’un fournisseur actif (sinon rien n’est enregistré et le défaut est fixé au premier message), et accepte un `modelBinding` facultatif (`pinned` | `auto` | `inherit` ; `inherit` exige un collègue, sinon `400 binding_inherit_needs_agent`) et un `effort` de départ facultatif. `POST /api/v1/projects/:id/conversations` (une carte sur le tableau d’un projet) applique la même règle. `PATCH /api/v1/conversations/:id` accepte `modelBinding` et `providerId` + `modelId`, toujours envoyés ensemble et validés (`400 model_binding_unavailable` pour un modèle inconnu ou désactivé) ; un PATCH qui envoie une paire la marque comme votre choix (un indicateur que le client ne peut pas fixer directement). `GET` renvoie `effectiveBinding` (fournisseur, modèle, raison et prise en charge des images) et `autoRoutingEnabled`, et le flux en direct annonce la liaison au début d’un tour. Une surcharge fournisseur + modèle pour un seul tour sur `POST …/messages` doit envoyer les deux. Les objets conversation n’incluent plus `sdkSessionId`, et un `PATCH` qui en envoie un est ignoré.

### Composition du contexte {#context-composition}
La fine barre le long du haut de la conversation est cliquable — elle ouvre le panneau **Composition du contexte** pour le tour en cours : chaque section entrée dans le prompt de ce tour, dans l’ordre où elle a été assemblée, avec sa taille, si elle a été tronquée, et son contenu brut. C’est par tour, pas un cumul sur toute la conversation.

La zone **turn** contient ce qui est joint à votre message plutôt qu’au prompt système : **turn-time** (la date et l’heure courantes) et **memory-recall** (le bloc de mémoire rappelée, ses identifiants et son budget). La section runtime ne porte plus la date et l’heure, et les anciennes sections *memory-index* et *related-work* ont disparu. Voir [Mémoire — Comment le rappel atteint le modèle](/docs/fr/knowledge/memory/#how-recall-reaches-the-model).

La taille des sections suit le modèle qui répond au tour — fixe ou choisi par le routage automatique — donc la troncature d’une section dépend de la fenêtre de contexte de ce modèle. Un modèle à grande fenêtre reçoit plus de place pour le contexte de projet et les fichiers d’agent ; un petit modèle local reçoit un prompt qui laisse encore de la place à la conversation. Voir [Prompts — dimensionné pour le modèle](/docs/fr/ai/prompts/#prompt-size). Dans une boucle d’agent, le panneau reflète le dernier appel au modèle du tour.

**Le remplissage de la fenêtre.** La barre montre à quel point la fenêtre de contexte du modèle est réellement remplie :

- **Mesuré.** Quand le fournisseur indique la taille du prompt du dernier appel au modèle, la barre utilise ce nombre et son info-bulle dit *mesuré* (Anthropic et compatibles Anthropic, la famille OpenAI y compris OpenRouter, Kimi API et LM Studio, Gemini, et Claude Code).
- **Estimé.** Sinon elle affiche une estimation, marquée d’un `~` et de *estimé* : le prompt système plus l’historique de la conversation envoyé avec le tour. Ollama, Grok CLI et Kimi Code CLI affichent toujours l’estimation (Ollama laisse de côté la part qu’il réutilise depuis son cache ; les CLI Grok et Kimi rapportent un total sur leurs étapes internes).
- **La fenêtre** est celle du modèle choisi, sur tous les fournisseurs : la fenêtre indiquée pour le modèle dans Fournisseurs l’emporte, donc un modèle CLI listé avec une fenêtre de 1M utilise 1M. Quand le runtime indique la fenêtre du modèle qui a répondu (Claude Code le fait), c’est elle qui l’emporte. Les fenêtres fixes des CLI (Claude Code 200k, Grok 500k, Kimi 256k) ne servent que de repli pour un modèle dont la liste n’a pas la fenêtre. Les entrées Fable, Opus, Sonnet et Haiku de Claude Code indiquent 200k — la fenêtre que le runtime donne à ces noms —, y compris avant que le runtime ait rapporté ses modèles ; seule une entrée que le runtime propose comme sa variante 1M (par exemple *Opus (1M context)*) est listée à 1M. Après un changement de modèle dans la conversation, la barre utilise tout de suite la fenêtre du nouveau modèle.
- Les couleurs (moins de 50 % / moins de 75 % / 75 % et plus) suivent les couleurs succès, avertissement et destructive du thème. Le même nombre alimente la bande *% contexte* de la carte du tableau. Les tours plus anciens affichent leur estimation jusqu’au tour suivant.

**Confidentialité par section.** Chaque section de prompt enregistrée porte un badge de confidentialité :

| Badge | Signification |
|-------|---------------|
| *N masqué(s) · &lt;types&gt;* | Des valeurs ont été remplacées par des espaces réservés comme `[EMAIL]` avant que le modèle ne les voie (par exemple *2 masqué(s) · Adresse e-mail, IBAN*) |
| *non analysé (généré par EYAS)* | L’identité, les règles, l’horloge runtime, les dossiers de travail, les listes d’outils / compétences / agents et la directive d’orchestration sont envoyés tels quels |
| *rien de masqué* | La section a été analysée et rien n’avait besoin d’être masqué |
| *destination locale — non masqué* | Le modèle tourne sur cette machine (loopback ou un hôte listé sous Confidentialité → Hôtes locaux) : rien n’est masqué, volontairement |
| Pas de badge | Rien n’a été enregistré pour la section : les sections envoyées dans votre message (le bloc de mémoire par tour), les sections introuvables dans le prompt (elles sont quand même analysées, avec le reste du texte système), et les tours pour lesquels le masquage n’était pas encore enregistré |

Quand quelque chose a été masqué, une bascule **Tel qu’assemblé / Tel qu’envoyé au modèle** apparaît ; *Tel qu’envoyé au modèle* montre la section avec les espaces réservés exactement comme le modèle l’a reçue. Une ligne nomme la version de la politique de confidentialité utilisée (*Politique de confidentialité regex@2/policy@N*), et une ligne *Résultats masqués des outils de mémoire : memory_search (2), …* liste les résultats d’outils mémoire dont des valeurs ont été masquées — y compris ceux que Claude Code, Grok et Kimi ont récupérés via le pont d’outils EYAS. Voir [Sécurité et confidentialité — Où s’applique le masquage](/docs/fr/admin/security-privacy/#where-masking-applies).

**Mémoire transmise.** Un encadré montre quelle mémoire a atteint le modèle, de la même façon quel que soit ce qui a répondu au tour (fournisseurs API, Claude Code, Grok, Kimi ou un modèle local), une ligne par fait :

- *Dimensionné pour &lt;modèle&gt; · fenêtre de &lt;N&gt; tokens* — le modèle pour lequel le prompt et le budget mémoire ont été dimensionnés ; *fenêtre inconnue, base de 100k tokens utilisée* quand EYAS ne connaît pas la fenêtre de ce modèle.
- *&lt;hits&gt; éléments rappelés (&lt;expanded&gt; en entier) · &lt;tokens&gt; / &lt;budget&gt; tokens* — le bloc de mémoire rappelée joint à ce message (notes permanentes plus éléments récupérés pour lui), combien ont eu leur texte complet joint, et la taille estimée du bloc par rapport à son plafond pour cette fenêtre. Sinon *Aucune mémoire rappelée pour ce message*, ou *Rappel retenu : &lt;raison&gt;* — la réponse est destinée à quelqu’un d’autre que vous (un pair A2A ou une réponse de canal à voix externe) ; la fenêtre de contexte du modèle ne laisse aucune place ; il n’y a rien à rappeler depuis ici ; le rappel a échoué et le tour n’a reçu que l’heure.
- *Consultations de la mémoire : &lt;calls&gt; sur &lt;limit&gt; appels ce tour-ci · &lt;items&gt; éléments lus* — les appels `memory_search` / `memory_expand` / `search_memory` du modèle lui-même dans ce tour, par rapport au plafond de 3 par tour (le même sur tous les fournisseurs), comptés jusqu’au dernier appel qui a trouvé quelque chose. Les tours pour lesquels les appels n’étaient pas encore comptés n’affichent que *éléments lus*. *Consultations de la mémoire indisponibles : les outils de mémoire n'atteignent pas ce modèle* quand le modèle ne peut pas appeler d’outils ou que le pont d’outils CLI a échoué à son auto-test.
- *Prompt système : …* (Grok et Kimi seulement) — *transmis comme prompt système (vérifié)*, *envoyé comme prompt système (non vérifié)*, ou *transmis dans le message*.

L’encadré n’apparaît pas pour les tours enregistrés avant son introduction, ni quand aucun prompt n’a été assemblé. Comme le reste du détail par tour, il est conservé 7 jours par défaut, puis purgé. La carte **Transmission de la mémoire par fournisseur** de [Observabilité → Contexte](/docs/fr/admin/observability/) compare cette transmission d’un fournisseur à l’autre.

### Titre automatique {#automatic-title}
Une nouvelle conversation commence avec les premiers mots de votre message comme titre ; un court appel au modèle peut ensuite le remplacer par un meilleur. Cet appel ne tourne que sur le niveau de routage **Heartbeat**, en appel isolé, et n’est jamais facturé au modèle propre de la conversation ni à un autre fournisseur. Quand le niveau Heartbeat n’a pas de modèle éligible (par exemple sur une installation Grok seul ou Kimi seul avant que leur isolation soit vérifiée), l’extrait du premier message reste le titre. Cliquez sur le titre pour le renommer vous-même.

### Portée de voix {#voice-scope}
| Commande | Signification |
|----------|---------------|
| **Voix: INTERNE / EXTERNE / AUTO** | Quel profil de voix est actif ([Profils de voix](/docs/fr/agents/voice/)) ; *(par défaut)* après AUTO signifie que le défaut de l’agent s’applique, sans remplacement |
| Sélecteur (*Outrepasser la portée vocale*) | **Auto**, **Forcer : Interne** ou **Forcer : Externe** |

---

## Champs de la conversation (contexte)

La barre de champs sous la barre supérieure contient, de gauche à droite : projet, dossiers de travail, agent, étape, effort, orchestration et échéance. Les responsables et les étiquettes apparaissent quand la conversation en a.

| Champ | Signification |
|-------|---------------|
| **Projet :** | Projet propriétaire, groupé par type de projet (*Aucun* si non défini). Changer de projet **réapplique les sources de code par défaut de ce projet** dans l’onglet Sources (sauf si vous définissez les sources explicitement dans la même mise à jour) et remplace la liste des dossiers de travail. Avant le premier message, cela choisit aussi l’agent par défaut du projet. |
| **Dossiers de travail** | Quelles racines nommées ce fil peut lire et écrire ; le sélecteur épingle celle qui est **principale** (cwd). Un fil sans dossiers propres travaille dans son propre **espace de travail EYAS** (voir [Dossiers](#working-folders)) ; **Aucun dossier** n’apparaît que si l’emplacement des espaces de travail n’est pas accessible en écriture. La liste se modifie dans l’onglet **Dossiers** du rail. |
| Agent | Collègue assigné — **verrouillé après le premier message** (*L'agent ne peut plus être modifié après le premier message*). Le chat ne propose que la liste **Tools** de ce collègue plus `memory_search` et `memory_expand` (sans collègue, la liste de l’agent par défaut du projet) ; une liste vide, ou aucun agent, signifie tous les outils. La liste s’applique sur tous les fournisseurs, et un modèle ne peut pas exécuter un outil qui ne lui a pas été proposé. Voir [Agents — Outils](/docs/fr/agents/configure/#tools--constraints). |
| **Étape :** | Étape dans le pipeline du projet |
| Effort | Profondeur de raisonnement. Le sélecteur ne liste que les niveaux que propose le modèle de la conversation (parmi Aucun, Minimal, Faible, Moyen, Élevé, Très élevé, Maximum ; un modèle à bascule affiche Désactivé / Activé). **Automatique** n’enregistre rien et nomme ce dont il hérite — *Automatique · Maximum (Profond)*, *Automatique · Élevé (collègue)*, *Automatique · Très élevé (conversation qui délègue)*, ou *Automatique · défaut du modèle (Moyen)*. Plus élevé = plus profond, plus lent, plus coûteux. Un niveau que le modèle ne prend pas en charge n’est pas enregistré, et un message indique les niveaux qu’il prend en charge. Quand le modèle change, le niveau enregistré reste ; un niveau que le nouveau modèle n’a pas s’affiche *Très élevé → Élevé (… ne propose pas Très élevé)* et chaque tour est ajusté. Voir [Fournisseurs — Effort de raisonnement](/docs/fr/ai/providers/#reasoning-effort). |
| **Orchestration : …** | **Solo** = ni spécialistes, ni passations, ni propositions d’équipe, quel que soit le fournisseur (sur les modèles CLI, pont EYAS compris) : `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` et `propose_team` ne sont pas proposés ; les outils mémoire et `assign_task` restent. **Auto** = le modèle fait appel à des spécialistes si besoin. **Profond** = distribution agressive via `run_specialist` ; Profond règle l’effort par défaut sur Maximum, et les spécialistes sans effort propre en héritent. Chaque modèle reçoit la même consigne Profond : découper le travail non trivial, lancer un spécialiste par tranche indépendante en parallèle avec un brief précis et autonome, passer la main au collègue qui possède un travail, ne proposer une équipe que si un spécialiste nécessaire n’existe pas encore, vérifier les résultats importants et garder la synthèse finale. Le dernier élément, **Mode Dieu**, fait courir la même tâche à la liste des Paramètres (voir [Mode Dieu](#mode-dieu)). |
| Échéance | Date limite de la conversation (aussi un champ métier suivi) |

### Indicateurs de complexité

Quand la conversation ne tourne pas en mode simple, un badge sous la barre de champs affiche son mode, avec la classe de complexité à côté quand elle est connue.

| Badge | Signification |
|-------|---------------|
| **Géré** | Chemin structuré / supervisé |
| **Autonome** | Chemin à plus haute autonomie |
| **Assistant** | Flux guidé par assistant |

---

## Flux de messages

| Commande / libellé | Signification |
|--------------------|---------------|
| *Commencez une conversation…* | État vide |
| **Réflexion / Réflexion…** | Le modèle raisonne (peut afficher un nombre de caractères) |
| *Rédaction de la réponse…* | La réponse arrive en flux |
| *Outils en cours…* | Un ou plusieurs outils sont en cours |
| **Arrêter** | Annuler l’exécution en cours |
| *L'agent travaille en arrière-plan…* | Vous avez quitté la page puis êtes revenu alors que l’agent travaillait encore — les messages apparaissent quand ils sont prêts |
| Pièce jointe | Image ou fichier intégré au fil (*Ouvrir le fichier*) |

### Trace des outils {#tool-trace}
Chaque appel d’outil est une ligne en direct dans le flux : nom de l’outil, un court aperçu des arguments, un résultat court, la durée, et une icône avec son statut. Cliquez sur la ligne pour la déplier.

Les lignes ont le même aspect sur tous les fournisseurs — fournisseurs API, Claude Code, Grok CLI et Kimi Code CLI. Elles utilisent les noms d’outils communs d’EYAS (`read_file`, `run_command`, `edit_file`, …, ou le nom propre d’un outil EYAS comme `memory_search`), montrent l’entrée de l’appel et sa sortie (une sortie très longue est coupée à 64 Kio et marquée), sa durée, et un diff pour les éditions de fichier. Quand le nom propre d’un outil chez le fournisseur diffère de celui d’EYAS (par exemple *Edit* de Claude Code pour `edit_file`), le survol du nom de l’outil l’affiche (*Nom de l'outil chez le fournisseur : …*). Le texte d’erreur d’un appel en échec n’est affiché qu’une fois.

| Statut | Signification |
|--------|---------------|
| **En cours** | L’appel est en vol |
| **Réussi** | L’outil a tourné et a rendu compte |
| **Échec** | L’outil a tourné et a renvoyé une erreur |
| **Refusé** | Refusé — par le portail de sécurité, la politique mémoire (recherche trop large comprise), ou parce que le modèle a nommé un outil qui ne lui était pas proposé, ou un outil propre d’une CLI que la liste **Outils** de l’agent retient |
| **Approbation requise** | En attente d’une décision humaine (voir [Approbations dans le chat](#approvals-in-the-chat)) |
| **Ignoré** | Ne s’est jamais exécuté — budget d’appels d’outils, limite par tour, ou répétition lors d’une reprise |
| **Issue inconnue** | La ligne était encore ouverte à la fin du tour |

Une ligne n’est marquée terminée que quand l’outil a réellement rendu compte ; un appel refusé, en attente ou ignoré n’est jamais affiché en vert. Voir [Fournisseurs — Le même chat sur tous les fournisseurs](/docs/fr/ai/providers/#same-chat-on-every-provider).

**Un appel refusé termine une réponse de Grok.** Quand EYAS refuse l’un des appels d’outil de Grok — par exemple une lecture de mémoire hors d’EYAS —, Grok termine cette réponse : le chat affiche la ligne **Refusé** et rien après. Le modèle de Grok ne voit pas la raison d’EYAS ; redemandez donc sans cette étape. Claude Code, lui, continue et reçoit la raison (*Memory outside EYAS … use memory_search / memory_expand from EYAS*). Observé avec Grok CLI 1.0.41 ; voir [Fournisseurs — Grok CLI et Kimi Code CLI](/docs/fr/ai/providers/#grok-cli-and-kimi-code-cli).

**Une recherche refusée comme trop large.** Quand une recherche propre d’une CLI (Grep, Glob, une commande shell récursive) part d’un dossier qui contient aussi un emplacement protégé, elle est refusée, et la ligne **Refusé** le dit dans votre langue : *Recherche trop large : le dossier contient aussi la mémoire d'un autre outil, que seul EYAS peut lire. Le modèle a été invité à chercher dans un dossier plus restreint.* — ou les données propres d’EYAS, les connexions CLI conservées par EYAS, ou l’espace de travail d’une autre conversation. Claude Code reçoit la raison et peut réessayer sur un dossier plus restreint ; Grok termine sa réponse, redemandez donc en nommant un dossier plus restreint. Voir [Sécurité et confidentialité — Mémoire hors d’EYAS](/docs/fr/admin/security-privacy/#memory-outside-eyas).

**Les outils EYAS sur Grok.** La ligne d’un outil EYAS appelé par Grok affiche les arguments que l’outil a réellement reçus, pas l’enveloppe interne `use_tool` de Grok (`tool_name`, `tool_input`, `variant`).

| Libellé | Signification |
|---------|---------------|
| **Diff** | Les éditions de fichier (`edit_file` / `write_file`) affichent un diff unifié dans le fil — pas seulement la description du modèle |
| **Entrée / Sortie / Erreur** | Les données brutes, quand il n’y a pas de diff de fichier ou que vous en avez besoin |

Rien sur cette ligne n’accorde de permission. Les outils jaunes et rouges attendent toujours une [approbation](/docs/fr/agents/autonomy/). `git status` / `git diff` en lecture seule (y compris quand le modèle les a envoyés comme `run_command`) ne demandent pas de clic — voir [Outils](/docs/fr/automation/tools/).

### Issue du tour {#turn-outcome}
Sous chaque réponse de l’assistant, à côté de qui a répondu et de la puce d’effort, un badge apparaît quand le tour ne s’est pas simplement terminé :

| Badge | Signification |
|-------|---------------|
| **Limite de tours atteinte** | Le tour a épuisé son budget de tours (voir [Progression de l’agent](#agent-progress)) |
| **Limite de sortie atteinte** | La réponse a atteint la limite de tokens de sortie du modèle |
| **Refusé par le modèle** | Le modèle a refusé |
| **Budget d'outils épuisé** | Le budget d’appels d’outils du tour est épuisé |
| **Arrêté** | Vous avez appuyé sur Arrêter |
| **Échec** | Le tour a échoué ; l’info-bulle nomme ce qui s’est mal passé (par exemple la limite de requêtes) |
| **En attente d'approbation** | Un appel d’outil attend une décision humaine |

La réponse écrite jusque-là est toujours conservée ; l’info-bulle du badge le dit (*Le tour s'est terminé plus tôt ; la réponse obtenue jusque-là est conservée.*). La réponse affiche aussi les tokens sous la forme *N entrée · N sortie*, où *entrée* est le prompt entier, parts en cache comprises, et le coût : *$x* quand le fournisseur l’a rapporté, *~$x* quand EYAS l’a estimé à partir des nombres de tokens (l’info-bulle dit lequel), ou *Utilisation non communiquée* quand le fournisseur n’a rien rapporté — jamais $0. Un coût non rapporté n’est pas ajouté au total de la conversation. *Approbations demandées : N* mène à la file d’approbation.

Chaque message de l’assistant enregistre comment son tour s’est passé : l’issue et la raison d’arrêt ; les tokens (entrée non mise en cache, sortie, lectures et écritures de cache, raisonnement) ; le coût et sa source (rapporté par le fournisseur, estimé par EYAS, ou non rapporté) ; le nombre d’étapes, d’appels d’outils et d’approbations ; le fournisseur et le modèle ; les avis éventuels ; et, pour un tour en échec, le type et le code d’erreur. Les réponses déléguées, de spécialiste, de pipeline et de canal enregistrent la même chose. C’est renvoyé comme `turnMeta` sur chaque message de `GET /api/v1/conversations/:id` et sur la trame `done` du flux ; les messages plus anciens n’en ont pas.

### Erreurs et avis {#errors-and-notices}
Un tour en échec affiche un seul message dans votre langue par type d’échec : le fournisseur a refusé la connexion ou la clé API, limite de requêtes atteinte, fournisseur surchargé, pas de réponse à temps, erreur réseau, requête annulée, requête rejetée, l’exécution du modèle s’est terminée sans achever la réponse, la CLI a été arrêtée parce que son isolation n’a pas pu être confirmée, ou autre. Des messages plus précis couvrent ces cas :

- isolation CLI refusée, avec la liste de chaque vérification en échec ([Fournisseurs — Vérification d’isolation](/docs/fr/ai/providers/#isolation-check-before-every-turn)) ;
- la CLI n’est pas connectée pour EYAS ;
- un sandbox de fichiers du noyau est exigé (`security.cliSandbox: required`) mais indisponible ([Fournisseurs — Sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox)) ;
- le modèle ou le fournisseur de la conversation est désactivé ou indisponible ;
- aucun modèle n’est configuré ;
- le niveau d’effort n’est pas pris en charge par le modèle.

Le texte brut du fournisseur n’est jamais le message ; il se trouve sous un **Afficher les détails** repliable. Les échecs qui ont un remède dans les réglages du fournisseur (connexion, isolation, sandbox, liaison de modèle, aucun modèle configuré, authentification) affichent un bouton **Ouvrir les réglages du fournisseur**. Si le tour avait écrit une partie de réponse avant d’échouer, cette partie reste dans la conversation, y compris après un rechargement, et l’erreur dit *La partie de la réponse écrite avant l'échec a été enregistrée.* L’erreur elle-même n’est jamais enregistrée comme texte de message, sinon elle serait rejouée au modèle comme historique. Un tour arrêté garde aussi ce qu’il a écrit, et les tokens et le coût des tours en échec ou arrêtés sont enregistrés. Si le serveur refuse un message, le chat affiche *Le serveur n'a pas accepté le message (HTTP n).* ; une connexion coupée affiche *La connexion au serveur a été interrompue avant l'arrivée de la réponse. Rechargez la conversation pour voir ce qui a été enregistré.*

Les avis apparaissent en lignes discrètes sous le tour et y restent après un rechargement :

- *L'environnement du modèle a compacté son contexte de travail pendant ce tour pour faire de la place.* — EYAS conserve toujours toute la conversation ;
- *Images non transmises au modèle (N) : …* — le modèle ne peut pas voir d’images (voir [Fournisseurs — Images](/docs/fr/ai/providers/#images-and-models-that-cannot-see-them)) ;
- *&lt;fournisseur&gt; exécute ses propres outils sans sandbox de fichiers du noyau sur ce serveur.* — affiché quand une CLI exécute ses propres outils sans le sandbox (`security.cliSandbox: auto`) ; EYAS vérifie toujours chaque appel d’outil qu’il voit ;
- *Le dossier &lt;chemin&gt; a été écarté de ce tour : EYAS ne laisse plus un modèle y travailler…* — un Dossier enregistré plus tôt est désormais refusé, donc ce tour a tourné sans lui (voir [Dossiers](#working-folders)).

### Approbations dans le chat {#approvals-in-the-chat}
Quand un appel d’outil a besoin d’une décision humaine, une carte apparaît sous la conversation : *Approbation requise : &lt;outil&gt;*, un **Motif** repliable, **Approuver** et **Refuser** (quand l’appel a été placé dans la file d’approbation), et **Ouvrir les approbations**, qui mène à la page [Autonomie](/docs/fr/agents/autonomy/). Les boutons utilisent la même permission que la file d’approbation ; un utilisateur qui ne l’a pas voit *Vous n'êtes pas autorisé à décider des approbations. Un propriétaire ou un administrateur peut en décider dans la file d'approbation.* Une demande déjà tranchée ailleurs le signale. Après approbation, demandez à l’assistant de réessayer : cet appel exact (même outil, mêmes arguments) est désormais autorisé une fois. Les cartes disparaissent à l’envoi du message suivant.

Dans un chat que vous suivez, un appel que le portail de sécurité autorise s’exécute ; la carte n’apparaît que quand le portail escalade, et le chat n’est pas mis en pause. C’est pareil sur tous les fournisseurs — y compris pour les outils EYAS que Grok et Kimi atteignent via le pont d’outils, qui n’attendent plus une approbation du seul fait qu’un outil est marqué comme en demandant une. Les niveaux d’autonomie s’appliquent aux exécutions en arrière-plan, pas aux chats suivis (voir [Autonomie](/docs/fr/agents/autonomy/)).

### Progression de l’agent {#agent-progress}
Le panneau de progression se trouve dans le bandeau **Exécution** à droite, qui s’ouvre tout seul pendant qu’un agent tourne. Il affiche le nom du collègue, ou *Assistant* pour l’assistant simple.

| Libellé | Signification |
|---------|---------------|
| **Étape N / Max** | Affiché quand le fournisseur rapporte ses étapes (Claude Code) ; la barre d’étapes n’apparaît qu’alors |
| **Appels d'outils : N** | Affiché sinon (Grok CLI, Kimi Code CLI et fournisseurs API qui ne rapportent pas d’étapes) |
| **En cours** | Exécution en cours |
| **N jetons facturés** | Entrée plus sortie de toute l’exécution, additionnées sur chaque appel au modèle telles que le fournisseur les rapporte — pas la taille de la conversation. Un agent CLI renvoie tout ce qu’il a lu à chacun de ses tours internes, ce total peut donc dépasser de loin ce que vous avez écrit |
| **Annuler** | Abandonner l’exécution |

**Budget de tours.** Un tour de chat peut faire jusqu’à **25** allers-retours avec le modèle par défaut. Quand le collègue de la conversation (ou l’agent par défaut de son projet) a ses propres **Tours max.**, c’est ce nombre qui est utilisé. Le budget est le même sur tous les fournisseurs ; pour Claude Code, Grok et Kimi, c’est aussi le plafond de tours interne de la CLI pour ce tour de chat. Les exécutions déléguées, de spécialiste et de pipeline (10 par défaut) et les réponses de canal (20 par défaut) gardent leur propre budget.

---

## Compositeur (saisie)

| Commande | Signification |
|----------|---------------|
| *Saisissez un message… (Shift+Enter pour un saut de ligne)* | Saisie principale — Entrée envoie |
| **Joindre un fichier** | Ajouter une pièce jointe au prochain message |
| **Prompt Enhancer** | *Prompt Enhancer — vous aide à affiner votre prompt* : ouvre le dialogue itératif d’affinage du prompt avant l’envoi |
| **Plan d’abord** (icône carte) | *Plan d'abord — écrit un plan et attend l'approbation avant d'exécuter des outils* : cet envoi écrit un plan et attend — aucun outil ne tourne tant que vous n’avez pas répondu à la carte du plan |
| Erreur | Un tour en échec affiche un seul message traduit, avec **Afficher les détails** et, quand c’est utile, **Ouvrir les réglages du fournisseur** — voir [Erreurs et avis](#errors-and-notices). Par exemple *Grok CLI a été arrêté : EYAS n'a pas pu confirmer qu'il s'exécute isolé (…). Le tour n'a pas été confié à un autre modèle.* |
| Puce image | Avec une image jointe et un modèle qui ne peut pas voir d’images : *&lt;modèle&gt; ne peut pas voir d’images : il saura seulement qu’une image est jointe.* Pas affichée en Mode Dieu |
| **Message non envoyé — confidentialité** | Le message contenait une valeur que la politique de confidentialité bloque et partirait vers un modèle distant — voir [Messages refusés](#refused-messages-privacy) |

### Messages refusés (confidentialité) {#refused-messages-privacy}
Un **nouveau** message que vous envoyez dans le chat ou en Mode Dieu est refusé quand il contient une valeur dont l’action de confidentialité est **block** — par défaut un IBAN, un numéro de compte bancaire, un numéro fiscal, un numéro de carte d’identité, un numéro de carte bancaire ou un SSN américain, plus tout motif personnalisé réglé sur block — **et** qu’il partirait vers un modèle distant. Seul votre nouveau message peut être refusé : l’historique, la mémoire, les résultats d’outils et le texte extrait des pièces jointes ne sont jamais refusés ; ils sont masqués en sortie. Les adresses e-mail et numéros de téléphone (classe mask) et les types de classe warn ne sont jamais refusés.

- **Où il part.** La destination est le modèle sur lequel le message va tourner (un remplacement pour un seul tour, le modèle fixe de la conversation, ou le modèle de son collègue). Local signifie que le point de terminaison du modèle est loopback (`localhost`, `127.x`, `::1`) ou listé dans les hôtes locaux de la politique de confidentialité ; les fournisseurs CLI (Claude Code, Grok CLI, Kimi Code CLI) et les points de terminaison inconnus comptent comme distants. Une conversation réglée sur Auto compte toujours comme distante, parce que son modèle est choisi après la vérification — sauf si le routage automatique est désactivé globalement, auquel cas c’est son modèle enregistré qui est jugé. En Mode Dieu, chaque participant de la liste est jugé : si l’un d’eux est distant, ou si la liste est vide, le message est refusé.
- **Rien n’est stocké.** Le message disparaît de la transcription, la conversation n’est pas renommée, aucune mémoire n’est enregistrée, aucun modèle n’est appelé et aucune course Mode Dieu ne démarre. Une carte au-dessus du compositeur, **Message non envoyé — confidentialité**, liste les types refusés par leur nom (jamais les valeurs) et propose **Envoyer avec ces données masquées** (renvoie le message avec seulement les valeurs bloquées remplacées par des espaces réservés comme `[IBAN]` ; le texte masqué est ce qui est stocké, affiché et envoyé), **Modifier le message** (remet le texte et ses pièces jointes dans le compositeur) et **Abandonner**.
- Relancer un tour arrêté (après une proposition de compétence ou l’approbation d’un plan) n’est pas revérifié. Avec la politique de confidentialité désactivée, ou le module de confidentialité éteint, rien n’est refusé.

Chaque refus est audité sous `privacy.inbound_refused` et chaque renvoi masqué sous `privacy.inbound_masked`, avec les types, la conversation et l’utilisateur — jamais une valeur. **API :** `POST /api/v1/conversations/:id/messages` accepte un `privacy: "mask"` facultatif (toute autre valeur → `400`). Un refus est un HTTP `422 {error: 'privacy_blocked', code: 'privacy_blocked', message, types, maskedContent}`, envoyé avant tout démarrage de flux. Voir [Sécurité et confidentialité](/docs/fr/admin/security-privacy/#refused-messages).

### Dialogue du Prompt Enhancer {#prompt-enhancer-dialog}
Un coach itératif qui **façonne le prompt pour la famille de modèles de la conversation** (Claude, OpenAI, Gemini, Grok, Kimi, …) avant l’envoi. Description : *Un coach de prompt itératif — optimisé pour la famille de modèles de la conversation. Choisissez un type de tâche, affinez, puis appliquez.*

| Commande | Signification |
|----------|---------------|
| Zone objectif / brouillon | Décrivez ce que vous voulez affiner (*Saisissez un brouillon de prompt ou un objectif — je vous aiderai à l'affiner.*) |
| **Optimisé pour …** | Famille de modèles cible — par défaut le modèle sur lequel la conversation tourne réellement |
| Puces de type de tâche | **Général · Code · Recherche · Analyse · Rédaction · Agentique · Fichiers / vision** — orientent la structure et la liste de contrôle |
| **Joindre un fichier** | Fichiers de contexte pour l’enhancer uniquement (ou à emporter) |
| **Envoyer** | Continuer l’affinage avec l’enhancer |
| **Qualité N/10** | Score heuristique de qualité ; **Lacunes : …** liste les éléments manquants ; **Liste de contrôle couverte** lorsque c’est complet |
| **Proposer deux alternatives (concis + approfondi)** | Demander des variantes **Concis** / **Approfondi** / **Recommandé** |
| **Prompt final suggéré** | Texte candidat à insérer |
| **emporter N fichiers** | Si les pièces jointes vont aussi dans le chat principal |
| **Appliquer** | Insérer le prompt final (ou la dernière réponse) dans le compositeur principal |

Pour des prompts système **durables** de projet / agent (pas des brouillons de chat ponctuels), utilisez le [Coach de prompt](/docs/fr/ai/prompts/#prompt-coach) sur Projets et dans la configuration d’agent.

---

## Rail de contexte (chatter) {#context-rail-chatter}
La colonne de droite contient en haut le bandeau **Exécution**, en dessous — tant qu’il est ouvert — le terminal OpenCode, puis les onglets :

**Historique · Sources · Dossiers · Suivant · Fichiers** (plus **Dieu** tant que le Mode Dieu est actif ou après une course)

### Historique (messages / filtres)

| Commande | Signification |
|----------|---------------|
| **Historique** | Notes chronologiques et mises à jour du tableau |
| **Tout / Notes / Modifications** | Filtrer les notes ou les changements de champs |
| *Ajouter une note…* + **Ajouter une note** | Note humaine sur l’enregistrement (ce n’est pas un tour de chat vers le modèle) |
| Badges **Note** / **Mise à jour** | Type d’entrée |
| **Aujourd'hui / Hier** | Groupement temporel |

### Sources (code / épinglage Odoo)

Sélection multiple des **sources de recherche indexées** que cette conversation peut utiliser (par exemple Odoo 18c + modules personnalisés). Cela évite de mélanger plusieurs versions d’Odoo dans un même fil.

| Commande | Signification |
|----------|---------------|
| Liste à cases | Toutes les sources de recherche enregistrées (libellé, version, statut, chemin) |
| **Tout sélectionner** / **Effacer (auto)** | Épingler chaque source / effacer l’épingle |
| **Auto** | Pas d’épingle sur la conversation — le défaut du projet ou les règles multi-version `needsPin` s’appliquent |
| **N épinglées** | Nombre de sources sélectionnées |
| **Gérer les sources de recherche →** | Ouvrir `/search-sources` |

**Héritage :** les nouvelles conversations d’un projet, et l’attribution d’un projet à une conversation existante, copient les **sources de code par défaut** du projet. Vous pouvez toujours les remplacer ici.

Configuration complète : [Recherche — épinglage multi-version](/docs/fr/daily/search/#multi-version-pin-which-tree-may-the-agent-use) · [Projets](/docs/fr/daily/projects/).

### Dossiers (répertoires de travail) {#working-folders}
Racines nommées que cette conversation peut lire et écrire. Le premier chemin est le répertoire de travail **principal** (cwd). Les outils fichier (`read_file`, `edit_file`, `grep`, …) sont enfermés dans ces chemins — pas de repli vers le répertoire du processus EYAS. Claude Code, Grok CLI, Kimi Code CLI et OpenCode démarrent dans le premier dossier qui passe encore la validation, sinon dans l’espace de travail EYAS propre de la conversation — jamais dans le répertoire propre du serveur EYAS.

| Commande | Signification |
|----------|---------------|
| **Dossiers de travail** (barre de champs) | Épingler quelle racine nommée est principale |
| Onglet **Dossiers** | **Ajouter un dossier** (nom + chemin absolu), **Monter** / **Descendre**, **Retirer** ; la première entrée est **Principal** |
| *Ce projet n’a pas encore de dossiers par défaut.* | Définissez les défauts sur le [projet](/docs/fr/daily/projects/#working-directories) (ou son type) |

Les nouvelles conversations copient la liste du projet ; une liste de projet vide copie celle du **type**. Changer de projet remplace cette liste. Les chemins appartiennent à l’instance, pas aux défauts du produit.

**Dossiers qui ne peuvent pas être enregistrés.** L’enregistrement refuse un dossier et dit pourquoi, en nommant le dossier, dans votre langue :

- la racine du système de fichiers, votre dossier personnel, ou tout dossier au-dessus (par exemple `/Users` ou `/home`) — de là, un modèle pourrait atteindre la mémoire de chaque outil et vos identifiants ; choisissez plutôt un dossier de projet dans votre dossier personnel ;
- un dossier dans le stockage propre d’un autre outil d’IA (`~/.claude`, `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.cursor`, `~/.codeium`, `~/.kimi`, `~/.agents`, `~/.config/agents`, `~/.copilot`, les dossiers de configuration/données/état d’OpenCode, ou un dossier `memory` sous `.claude`/`.grok`/… dans un dépôt), ou les dossiers de connexion CLI qu’EYAS garde pour Grok et Kimi (`data/cli-homes`) ;
- un dossier dans un coffre de notes ou un stockage de mémoire : tout coffre Obsidian, les réglages de l’application Obsidian, un dossier nommé `ai-memory`, ou un chemin listé sous `security.foreignMemoryPaths` ;
- un dossier dans le dossier de données propre d’EYAS (coffre de mémoire, base, clés) — sauf un espace de travail de conversation unique, les projets Studio et les téléchargements du navigateur ; le dossier des espaces de travail lui-même est refusé, car il contient l’espace de travail de chaque conversation ;
- l’espace de travail de la conversation d’un autre utilisateur — l’espace de travail d’une conversation, un dossier qui s’y trouve ou un lien qui y mène n’est un dossier que pour cette conversation et pour vos autres conversations (vos conversations d’équipe et de spécialistes comprises) ; le dossier temporaire d’une exécution sous `_runs` est refusé aussi ;
- les emplacements sensibles : `.ssh`, les fichiers `.env`, `master.key`, le dossier de la base de données ;
- un chemin qui n’est pas absolu, un dossier qui n’existe pas ou n’est pas lisible, et un fichier au lieu d’un dossier ;
- un dossier qui **contient** un emplacement protégé — le message nomme ce qui a été trouvé à l’intérieur : le home propre d’EYAS, son dossier de données, sa base ou son dossier des espaces de travail des conversations (par exemple le checkout des sources d’EYAS qui contient `data/`, ou le home d’EYAS lui-même même quand `EYAS_DATA_DIR` a déplacé les données ailleurs) ; le stockage d’un autre outil d’IA ou un dossier de connexion CLI d’EYAS (par exemple `~/.config` contenant le dossier d’OpenCode, ou un dépôt avec `.claude/memory`) ; un coffre de notes (un dossier contenant `.obsidian`, ou un coffre de la liste de coffres d’Obsidian — par exemple `~/Documents` contenant *Obsidian Vault*), un dossier `ai-memory` ou une entrée de `security.foreignMemoryPaths`.

**Pourquoi un dossier qui ne fait que contenir l’un d’eux est refusé.** Une CLI comme Claude Code lit et cherche dans son dossier de travail sans rien demander, et la vérification de publication a confirmé sur le vrai binaire que ces lectures n’atteignent jamais l’étape d’approbation. Un dossier qui contient un emplacement protégé n’est donc pas sûr à confier à un modèle. Choisissez plutôt un dossier plus restreint, comme le dossier du projet dans `~/Documents` ou un clone séparé du dépôt. Les coffres et dossiers de mémoire connus seulement par leur forme sont trouvés par un parcours borné — 8 niveaux de profondeur, 2 000 dossiers au plus, en sautant `.git` et les dossiers semblables ainsi que `node_modules` ; une lecture dans un emplacement plus profond reste refusée chemin par chemin, et les `grep` et `glob` propres d’EYAS ne regardent jamais dans un sous-dossier protégé. Si les dossiers d’une nouvelle conversation sont refusés, la conversation n’est pas créée.

**Les dossiers enregistrés plus tôt et désormais refusés** ne sont pas réécrits, mais chaque exécution les écarte : les outils de fichiers propres d’EYAS, le portail de sécurité, et le dossier de travail de Claude Code, Grok, Kimi et OpenCode. Le prompt système ne les nomme plus. Dans le chat, le tour affiche l’avis *Le dossier &lt;chemin&gt; a été écarté de ce tour : EYAS ne laisse plus un modèle y travailler, car c'est un emplacement protégé, il se trouve dans l'un d'eux ou en contient un (les données propres à EYAS, le stockage d'un autre outil d'IA, un coffre de notes ou votre dossier personnel). Modifiez les Dossiers de cette conversation ou de son projet.* Un dossier simplement absent n’est pas concerné. Pour les exécutions de cartes en arrière-plan, d’équipe et de spécialiste, l’écartement n’apparaît que dans le log du serveur. Si tous les dossiers enregistrés sont refusés, les outils de fichiers propres d’EYAS n’ont aucun dossier, et une CLI travaille dans l’espace de travail EYAS propre à la conversation. Kimi Code CLI suit les mêmes règles de dossiers ; son comportement ici n’a pas encore été vérifié sur un hôte. Chaque enregistrement vérifie toute la liste : retirez donc un dossier désormais refusé avant d’enregistrer d’autres modifications de la liste. L’API répond à un dossier refusé par `400 {error, code, path, found}`, où `code` vaut `home`, `providerHome`, `vault`, `eyasData`, `sensitive`, `otherWorkspace`, `containsEyasData`, `containsProviderHome`, `containsVault`, `notAbsolute`, `notFound` ou `notDirectory`, et `found` — envoyé avec les trois codes `contains…` — est l’emplacement protégé trouvé dans le dossier.

**Chaque conversation a un dossier de travail.** Une conversation qui ne reçoit de dossiers ni de vous, ni du projet, ni de son type obtient son propre **espace de travail EYAS** à sa création — dans n’importe quel projet, y compris quand la requête envoie une liste de dossiers vide. Les conversations plus anciennes sans dossiers, et celles dont tous les dossiers ont été retirés, reçoivent leur espace de travail au message suivant. Il apparaît dans l’onglet **Dossiers** comme n’importe quel dossier. Les fichiers que le modèle y écrit sont copiés dans les pièces jointes de la conversation ([Documents](/docs/fr/knowledge/documents/)), avec les travaux médias et les rendus Studio — y compris lors d’un tour qui a tourné sans le pipeline d’outils d’EYAS. **Aucun dossier** n’apparaît que si l’emplacement des espaces de travail n’est pas accessible en écriture. Les dossiers que vous avez définis vous-même ne sont jamais remplacés.

Les espaces de travail ne sont jamais placés dans un checkout git : un modèle CLI (Claude Code, Grok, Kimi) lancé dans un dépôt git traite ce dépôt comme son projet et charge ses fichiers d’instructions, son état git, ses règles de permission et sa mémoire par projet. Où ils vivent, et comment les déplacer avec `EYAS_WORKSPACES_DIR` : [Configuration — Espaces de travail des conversations](/docs/fr/deploy/configuration/#conversation-workspaces).

### Champs métier (suivis)

| Champ | Signification |
|-------|---------------|
| **Étape** | Étape du pipeline |
| **Projet** | Lien de projet |
| **Priorité** | Priorité |
| **Statut** | Statut |
| **Échéance** | Date limite |

Les changements apparaissent comme des entrées **Mise à jour** dans l’onglet **Historique**.

### Activités

L’onglet **Suivant** (*Prochaines étapes pour cet enregistrement*) liste les activités de la conversation.

| Commande | Signification |
|----------|---------------|
| **Planifier** | Ouvrir le formulaire de planification |
| **Type** | Type d’activité (tâche, suivi, revue, …) |
| **Résumé** | Texte de résumé facultatif |
| **Date limite** | Quand c’est dû |
| **Planifier l'activité** | Confirmer |
| **Marquer comme terminée** | Terminer une activité |
| **En retard / Aujourd'hui / Planifiées** | Groupement |
| **N terminées** | Nombre d’activités faites |

### Suivant / Fichiers / Exécution

| Zone | Signification |
|------|---------------|
| **Suivant** | Activités et prochaines étapes pour cet enregistrement (ci-dessus) |
| **Fichiers** | Pièces jointes de la conversation, y compris les fichiers que le modèle a écrits dans son espace de travail |
| **Exécution** | Le bandeau repliable au-dessus des onglets : l’arbre d’exécution, la progression de l’agent et l’arbre des sous-conversations. Il s’ouvre tout seul pendant qu’un agent tourne et reste séparé de l’Historique, pour que l’activité de l’agent ne se mélange jamais aux notes métier |

---

## Fonctions d’équipe

### Arbre des sous-conversations

| Commande | Signification |
|----------|---------------|
| **Équipe / Sous-conversations** | Fils enfants créés pour le travail multi-agent (dans le bandeau Exécution) |
| **Développer** (*Ouvrir le tableau de bord d'équipe*) | Ouvrir la superposition du tableau de bord |
| **tour N** | Progression d’un sous-fil |

### Tableau de bord d’équipe

| Commande | Signification |
|----------|---------------|
| **Tableau de bord d'équipe** / **Réduire** | Titre / fermeture de la superposition |
| **Phase :** | Phase d’orchestration actuelle |
| **N tour / N tokens** | Usage |
| Catégories **Constat / Décision / Blocage / Question / Fait** | Types d’entrées de la mémoire d’équipe partagée |
| **Voir le chat** | Aller dans le sous-chat d’un membre |
| **Mémoire d'équipe** | Constats, décisions et blocages agrégés |

### Carte de proposition d’équipe

La distribution ordinaire de spécialistes (`run_specialist`) **n’affiche pas** cette carte. Elle apparaît pour `/team`, une demande explicite d’équipe, des spécialistes manquants, ou un travail épique. La proposition est écrite par le modèle d’arrière-plan en un appel isolé ; sans modèle d’arrière-plan éligible, la carte propose un seul agent (voir [Équipes et délégation](/docs/fr/agents/teams/)).

| Commande | Signification |
|----------|---------------|
| **Proposition d'équipe** | Plan d’exécution multi-agent |
| **~N tokens · coût** | Estimation |
| **Phases** | Phases parallèles ou séquentielles |
| **Spécialistes manquants** | Modèles pas encore créés |
| **Créer maintenant** | Créer les agents manquants |
| **Approuver / Modifier / Ignorer / Ignorer (risqué)** | Accepter le plan, le modifier (si disponible), ou l’ignorer |

### Passation {#handoff}
Quand un collègue prend le relais (`handoff_to_colleague`), la ligne d’outil a **Ouvrir &lt;nom&gt;** vers son fil d’accueil, et le collègue **démarre immédiatement** là-bas : le brief de passation devient l’objectif de l’exécution et sa requête de rappel mémoire, et l’exécution est supervisée, autonome et soumise à l’échelle d’[autonomie](/docs/fr/agents/autonomy/), comme l’exécution d’une carte du tableau. Une passation vers un collègue occupé dans son fil d’accueil (un tour de chat ou une exécution précédente encore en cours, ou une exécution en attente d’approbation) est refusée avec un message *occupé* — réessayez plus tard ou utilisez `assign_task`. Les passations vers soi-même ou vers un spécialiste sont refusées, et une passation répétée ne démarre jamais une seconde exécution.

<h3 id="run-tree--workflow">Arbre d’exécution / flux de travail</h3>
Affiche dans le bandeau Exécution la structure d’exécution du tour en cours (libellé **Flux de travail**), pour tous les fournisseurs — fournisseurs API (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, modèles locaux, …) comme Claude Code, Grok CLI et Kimi Code CLI.

- Le nœud de la conversation montre l’outil en cours en direct, le compteur de tours (pour une CLI, ses propres étapes internes), les tokens utilisés jusqu’ici, et un statut : **En attente**, **En cours**, **Terminé**, **Échec**, **Annulé** ou **En pause**. Une exécution qui attend une approbation humaine s’affiche **En pause**.
- Chaque nouveau message démarre un arbre neuf : l’arbre du tour précédent est remplacé, pas complété.
- À la fin d’une exécution, l’en-tête affiche son coût en dollars US : le coût propre du fournisseur quand il est rapporté (Claude Code, aussi pour une exécution en échec), sinon calculé à partir de l’usage de tokens avec les prix configurés (les surcharges `model.pricing` s’appliquent). Quand un fournisseur n’a pas rapporté son usage, le coût affiche *—* et l’info-bulle dit *Coût inconnu — le fournisseur n'a pas communiqué son utilisation* — jamais un $0 inventé.
- **Plans de Grok et Kimi.** Quand le modèle tient une liste de tâches, chaque entrée apparaît sous la conversation comme une **Étape du plan** avec une icône de liste de contrôle et son statut (en attente, en cours, terminé).
- Les spécialistes apparaissent de la même façon sur tous les fournisseurs ; les exécutions Claude Code n’affichent pas de nœuds propres. Dans les exécutions d’équipe, chaque membre affiche son outil en cours en direct, quel que soit son fournisseur.
- Les anciens arbres enregistrés se rejouent toujours.

---

## Mode Dieu

Le Mode Dieu fait courir la **même tâche** en parallèle sur plusieurs modèles, puis compare les résultats. Ce n’est pas un quatrième style d’orchestration : Solo / Auto / Profond décrivent toujours comment chaque travailleur décompose le travail. Le Mode Dieu décide seulement que plusieurs modèles concourent (pas une équipe de spécialistes). On peut les combiner : Mode Dieu + Profond signifie que chaque modèle concurrent peut aussi distribuer le travail de son côté.

Il n’y a **pas de fusion automatique**. Un espace de travail gagne ; les idées uniques des autres sont listées pour que vous les appliquiez.

| Sujet | Signification |
|-------|---------------|
| **Liste** | **Paramètres → Mode Dieu** (carte sous Affectations de modèles). Choisissez 2 à 5 paires fournisseur/modèle actives. Un nombre pair exige un président départageur. |
| **Menu** | Dernier élément de la commande d’orchestration de la conversation (après un séparateur) : Solo, Auto, Profond, puis **Mode Dieu**. Choisir Mode Dieu l’active et **laisse** Solo/Auto/Profond tels quels (les travailleurs héritent de ce style). Choisir Solo/Auto/Profond désactive le Mode Dieu. Sans liste valide, l’élément indique *Ajoutez au moins 2 modèles dans Paramètres → Mode Dieu*. |
| **Coût** | Le premier envoi après activation demande confirmation (*Lancer une exécution Mode Dieu ?* — liste, estimation, plafond). Les envois suivants dans la même conversation n’affichent que la bannière. Si l’estimation dépasse le plafond, l’envoi est bloqué jusqu’à ce que vous releviez le plafond ou désactiviez le Mode Dieu. |
| **Dossiers** | Les travailleurs s’exécutent dans des copies isolées des dossiers de travail de la conversation (worktree git si possible). Sans dossiers, l’exécution démarre quand même, sans isolation de fichiers. |
| **Vainqueur + idées** | Seuls les fichiers modifiés du vainqueur arrivent dans les dossiers de la conversation. Les idées uniques des autres figurent dans l’onglet **Dieu** — à appliquer vous-même ; rien n’est fusionné automatiquement. |

### Liste dans les Paramètres

Dans [Paramètres](/docs/fr/admin/settings/), sous Affectations de modèles, la carte **Mode Dieu** est la liste globale utilisée par chaque conversation en Mode Dieu.

| Champ | Signification |
|-------|---------------|
| **Ajouter un modèle** | 2 à 5 paires fournisseur/modèle actives. Les doublons ne sont pas permis. |
| **Président départageur** | L’un de ces modèles. **Obligatoire si le nombre est pair** ; toujours recommandé (un travailleur en échec peut laisser un reste pair). Le président est un concurrent, pas un juge à part. |
| **Plafond de coût (USD)** | Facultatif. Si l’estimation préalable le dépasse, l’exécution ne démarre pas. Si la dépense le franchit en cours de course, les travailleurs inachevés sont annulés et le vainqueur est choisi parmi ceux qui ont fini. |
| **Conserver les dossiers des travailleurs (heures)** | Les arbres isolés sont supprimés après ce nombre d’heures (72 par défaut). |

Enregistrer la liste ne modifie pas les exécutions déjà lancées : chaque envoi prend un instantané de la liste.

Le sélecteur de modèle de la conversation est estompé et ignoré pour un envoi en Mode Dieu — c’est la liste des Paramètres qui court, et chaque travailleur tourne toujours sur son modèle de la liste. Un effort réglé sur la conversation est copié sur chaque concurrent et Profond leur est transmis comme mode ; le niveau de chaque concurrent est ensuite ajusté à son propre modèle. Les votes de la revue croisée utilisent aussi l’effort de la conversation.

### Activer le Mode Dieu

1. Ouvrez le menu d’orchestration de la conversation et choisissez **Mode Dieu**.
2. Envoyez un message. Le premier envoi affiche une confirmation de coût (combien de modèles concourent, USD estimé, plafond). Cliquez **Envoyer** pour démarrer.
3. Tant qu’il est actif, une bannière **Mode Dieu · N · ~$x** reste sur la conversation. Le rail de droite gagne un onglet **Dieu**.
4. **Arrêter** annule toute la course, pas seulement un travailleur.

### Isolation et vainqueur

Chaque travailleur reçoit son propre dossier (worktree git si le répertoire de travail est un dépôt ; sinon une copie). Pendant le travail, les travailleurs ne voient pas les fichiers des autres.

Quand un vainqueur est choisi, **seuls les fichiers modifiés du vainqueur** sont copiés dans les dossiers de la conversation. Ceux des autres travailleurs restent dans leurs arbres isolés jusqu’au nettoyage de rétention. Sans dossiers de travail, il n’y a rien à promouvoir ; le vainqueur est tout de même choisi d’après les réponses écrites.

### L’onglet Dieu

L’onglet **Dieu** du rail apparaît tant que le Mode Dieu est actif, **ou** dès que la conversation a eu au moins une exécution en Mode Dieu (il reste si vous le désactivez ensuite).

#### En-tête

La phase actuelle, plus les tokens, USD et durée totaux.

| Phase | Signification |
|-------|---------------|
| **Préparation** | Instantané de la liste, dossiers isolés |
| **Course** | Les travailleurs exécutent le même message utilisateur en parallèle |
| **Revue** | Ceux qui ont fini notent le travail des autres et votent |
| **Décision** | Vainqueur enregistré |
| **Promotion** | Les fichiers du vainqueur sont copiés dans les dossiers de la conversation |
| **Terminé / Échec / Annulé** | État final |

Un travailleur en échec affiche aussi l’erreur du fournisseur (par exemple une API surchargée).

#### Étapes

Un journal horodaté de ce qui s’est réellement passé :

| Étape | Signification |
|-------|---------------|
| Course lancée | Course créée à partir de la liste actuelle |
| Workers en parallèle | Chaque modèle actif commence la même tâche |
| *Modèle* a terminé / a échoué | La tentative propre de ce travailleur est close |
| Revue croisée | Ceux qui ont fini lisent les résumés des autres et votent |
| Vainqueur : *modèle* | Décision enregistrée |
| Promotion de l'espace du vainqueur | Les fichiers du vainqueur sont copiés dans les dossiers de la conversation |
| Course terminée / échouée / annulée | État final |

Les exécutions antérieures à ce journal affichent une frise reconstruite à partir des heures de fin.

#### Comment le vainqueur a été choisi

Ce bloc indique la règle appliquée, le décompte des voix et **qui a voté pour qui**.

| Règle | Quand |
|-------|-------|
| **Majorité** | Un modèle a reçu plus de votes valides que tout autre. Un modèle **ne peut pas voter pour lui-même** ; ces votes sont écartés. |
| **Égalité — le président a choisi** | Deux modèles ou plus sont à égalité, et le président est parmi eux. |
| **Égalité — le plus rapide** | Deux modèles ou plus sont à égalité, et le président manque ou n’est pas parmi eux. Parmi les ex æquo, celui qui a fini le premier gagne. |
| **Un seul a terminé** | Tous les autres travailleurs ont échoué ou ont été annulés ; le seul survivant gagne, sans vote de revue croisée. |

Si un appel de revue échoue, ce travailleur n’a simplement pas de vote. La décision continue avec les votes exprimés.

#### Revue croisée

Après la course, ceux qui ont fini font **une** revue croisée structurée (pas de débat en direct). Chaque relecteur vote en un appel isolé sur son propre modèle de la liste, sans outils. Les réponses et modifications de fichiers des autres lui sont transmises comme données clairement marquées, jamais comme instructions : le texte de la sortie d’un pair ne peut pas dicter son vote à un relecteur. Pour chaque relecteur, l’onglet affiche sans clic supplémentaire :

- pour qui il a voté
- notes 1–5 : **qualité**, **exhaustivité**, **risque**
- son commentaire écrit sur le travail des autres
- les idées uniques qu’il estime manquées par les autres
- les risques signalés

Déplier la carte d’un modèle montre **son propre** travail (produit avant la revue) et toute erreur du travailleur.

#### Idées uniques

Une liste dédupliquée des idées des **non-vainqueurs** qui n’apparaissent pas déjà dans la liste du vainqueur. Si vous les voulez dans l’espace de travail promu, appliquez-les vous-même — rien n’est fusionné automatiquement.

### Conversations enfants

Chaque travailleur est une conversation enfant intitulée par exemple `God <modèle>`. Elles peuvent apparaître dans la liste des conversations comme sous-conversations. Elles tournent avec le Mode Dieu **désactivé**, pour ne pas pouvoir lancer une autre course.

La comparaison globale (taux de victoire par modèle, multiple de coût moyen par rapport à un seul modèle) est sous [Observabilité](/docs/fr/admin/observability/). Un clic sur une exécution y ouvre l’onglet Dieu de cette conversation.

---

## Propositions de compétence

Une compétence qui correspond est une **proposition sur laquelle le tour attend** — rien de cette compétence ne s’exécute tant que vous n’avez pas répondu. La carte montre le nom de la compétence, le motif qui a correspondu et un score.

| Commande | Signification |
|----------|---------------|
| **Une compétence correspond — l'utiliser ?** | Titre |
| **L'utiliser** | Accepter pour cette conversation ; le tour reprend avec la compétence |
| **Pas cette fois** | Refuser pour cette conversation seulement |
| **Désactiver** | Refuser ici **et** désactiver la compétence globalement (owner/admin seulement). Elle ne correspondra plus tant que quelqu’un ne l’aura pas réactivée sous [Compétences](/docs/fr/automation/skills/) |

Votre réponse est mémorisée pour cette conversation. Un utilisateur qui peut discuter mais pas gérer les compétences voit toujours **L'utiliser** et **Pas cette fois**.

---

## Plan d’abord {#plan-mode}
L’icône carte du compositeur est **Plan d’abord** (*Plan d'abord — écrit un plan et attend l'approbation avant d'exécuter des outils*). Cet envoi **n’exécute pas** d’outils, et le statut du fil devient **En attente du plan**. Le plan est écrit par le modèle propre de la conversation en un appel isolé — sans outils, en un seul tour, jamais sur un autre fournisseur. Si cet appel échoue, le tour s’exécute sans plan.

La carte **Plan pour ce tour** montre l’objectif, les étapes numérotées (avec leurs critères de réussite) et, quand le plan en donne une, une ligne *Retour arrière : …* qui dit comment il serait annulé.

| Commande | Signification |
|----------|---------------|
| **Approuver** | Exécuter ce plan |
| **Ignorer le plan** | Exécuter le tour sans le plan |
| **Refuser** | Arrêter — rien n’a tourné |

Tant que la carte attend, rien n’a tourné. Les outils jaunes et rouges de l’exécution qui suit passent toujours par l’[Autonomie](/docs/fr/agents/autonomy/) comme d’habitude.

---

## Designs joints {#attached-designs}
L’icône de formes dans la barre supérieure de la conversation est **Designs**. Les canevas joints voyagent avec chaque tour de ce fil (l’agent peut en récupérer des parties avec `design_read`). Les designs d’un projet sont copiés sur une nouvelle conversation quand vous la créez dans ce projet ; ensuite la conversation possède les liens.

| Commande | Signification |
|----------|---------------|
| **Designs joints** | Liste déroulante de tous les canevas, avec une coche sur ceux liés ici |
| Compteur | Combien sont joints |
| **Ouvrir Design** | Aller à `/design` |
| *Aucun design pour l’instant.* | Liste vide — créez d’abord un canevas |

---

## Voir aussi

- [Sources de recherche et épinglage multi-version](/docs/fr/daily/search/)
- [Projets — répertoires de travail et wiki](/docs/fr/daily/projects/)
- [Vue d’ensemble des agents](/docs/fr/agents/overview/)
- [Équipes et délégation](/docs/fr/agents/teams/)
- [Fournisseurs](/docs/fr/ai/providers/)
- [Tableau](/docs/fr/daily/board/)
- [Profils de voix](/docs/fr/agents/voice/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [Canevas de design](/docs/fr/knowledge/design/)
- [Compétences](/docs/fr/automation/skills/)
- [OpenCode](/docs/fr/automation/opencode/)
- [Observabilité — onglet God Mode](/docs/fr/admin/observability/)
