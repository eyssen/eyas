---
title: Conversations
description: Parlez aux agents — envoyez du travail, joignez des designs, pilotez l’orchestration dans un fil.
---

**À quoi ça sert.** Une conversation est l’endroit où vous parlez à un agent. Les messages vont dans le volet principal ; projet, étape, sources, fichiers et runtime vivent dans le rail droit. Le même fil est une carte du Tableau : chat et pipeline sont un seul enregistrement.

## Quand l’utiliser

- Un agent doit faire un travail, et vous voulez la réponse, les appels d’outils et la progression au même endroit.
- Épingler quel arbre de code indexé ce fil peut chercher, et quels **dossiers de travail** les outils fichier peuvent toucher.
- Une compétence a matché — vous l’acceptez, vous la sautez pour ce fil, ou vous la désactivez globalement.
- Le modèle doit d’abord écrire un plan, avant tout outil (**Plan d’abord**).
- Plusieurs modèles doivent courir la même tâche (**God Mode**) ou une équipe de spécialistes doit se répartir.
- Un canevas de design doit voyager à chaque tour, ou le **Prompt Enhancer** doit former le brouillon avant l’envoi.

## Déroulement typique

1. Cliquez **Nouvelle conversation** dans la barre latérale (**Principal**), ou ouvrez une carte du **Tableau** / **Conversations récentes** de l’Accueil. Route `/conversations/:id`.
2. Réglez **Project**, **Stage** et **Agent** avant le premier message (l’agent se verrouille ensuite). Épinglez **Sources** si plusieurs arbres sont indexés. Vérifiez **Dossiers de travail** — un nouveau fil hérite de la liste du projet (ou du type si le projet est vide).
3. Tapez dans le compositeur. Utilisez **Prompt Enhancer** si le brouillon a besoin de forme ; l’icône carte est **Plan d’abord**. Joignez des fichiers ou **Designs** dans la barre supérieure.
4. Si une carte de compétence apparaît, choisissez **L'utiliser**, **Pas cette fois** ou **Désactiver**. Envoyez. La réponse streame avec des lignes d’outils en direct. **Arrêter** annule l’exécution.

## Fonctions

**Entrée :** barre latérale **Nouvelle conversation** ou ouverture d’un fil depuis le Tableau / Récentes.

Disposition : **messages + compositeur** (principal) et **rail de contexte** (fil : notes, champs, activités, fichiers, exécution).

---

## Statut de la conversation

| Statut | Signification |
|--------|---------------|
| **Inactif** | Aucune exécution d’agent active |
| **Au travail…** | L’agent s’exécute |
| **En attente** | En attente d’une entrée utilisateur ou externe |
| **En attente d’approbation** | Bloqué en attente d’une approbation humaine (sécurité / autonomie) |
| **En attente de plan** | Tour « plan d’abord » : la carte de plan attend **Approuver** / **Ignorer le plan** / **Rejeter** |
| **Archivé** | Fil fermé / archivé |

---

## En-tête / bandeau de modèle

| Commande | Signification |
|----------|---------------|
| **Fournisseur…** | Surcharge facultative du fournisseur d’IA pour ce fil |
| **Modèle…** | Surcharge facultative du modèle (sinon défaut de l’agent / routage automatique) |
| **Routage automatique** | Laisser le routeur de modèles choisir le fournisseur / modèle |

### Composition du contexte

La fine barre au-dessus de l’en-tête est cliquable — elle ouvre le panneau **Composition du contexte** pour le tour en cours : chaque section entrée dans le prompt de ce tour, dans l’ordre où elle a été assemblée, avec sa taille, si elle a été tronquée, et son contenu brut. C’est par tour, pas un cumul sur toute la conversation.

Le pourcentage sur cette barre a changé de sens : il indique désormais la taille du contexte réellement composé pour ce tour, par rapport à la fenêtre de contexte du modèle. Il additionnait auparavant les tokens d’entrée et de sortie de façon cumulative sur toute la conversation, ce qui surestimait le remplissage de la fenêtre et restait bloqué à 100 % sur une longue conversation. Si vous vous en souvenez, le chiffre plus petit affiché aujourd’hui est la correction, pas un bug.

---

## Barre supérieure — priorité

| Valeur | Signification |
|--------|---------------|
| **Basse / Normale / Haute / Urgente** | Priorité métier de la conversation (également affichée sur le Tableau) |

---

## Champs de conversation (contexte)

| Champ | Signification |
|-------|---------------|
| **Projet** | Projet propriétaire (`Aucun` si non défini). Changer de projet **réapplique les sources de code par défaut de ce projet** dans l’onglet Sources (sauf si vous définissez les sources explicitement dans la même mise à jour). |
| **Étape** | Étape dans le pipeline du projet |
| **Agent** | Agent assigné — **verrouillé après le premier message** |
| **Effort** | Profondeur de raisonnement : Désactivé / Bas / Moyen / Haut / Max. Plus élevé = plus profond, plus lent, plus coûteux. |
| **Dossiers de travail** | Quelles racines nommées ce fil peut lire et écrire. Vide = **Aucun dossier** (les outils fichier refusent). La liste se modifie dans l’onglet **Dossiers**. |
| **Orchestration** | **Solo** = pas de sous-agents ; **Auto** = le modèle décide du déploiement ; **Deep** = déploiement multi-agent agressif avec effort max. Dernier élément **Mode Dieu** — même tâche courue par la liste des Paramètres (voir [Mode Dieu](#mode-dieu)). |

---

## Flux de messages

| Commande / libellé | Signification |
|--------------------|---------------|
| **Démarrer une conversation…** | État vide |
| **Réflexion / Réflexion…** | Le modèle raisonne (peut afficher des comptes de caractères) |
| **Composition de la réponse…** | Réponse en cours de diffusion |
| **Outils en cours…** | Un ou plusieurs outils sont en vol |
| **Arrêter** | Annuler l’exécution en cours |
| **Travail en arrière-plan…** | Vous êtes parti puis revenu ; l’agent travaille encore — les messages apparaissent quand ils sont prêts |
| **Pièce jointe** | Image / fichier intégré au fil |
| Ligne d’outil | Id, aperçu d’arguments, résultat court, durée. Déplier : **Diff** pour les éditions de fichier, sinon **Entrée / Sortie / Erreur** |

`git status` / `git diff` en lecture seule (y compris via `run_command`) sans clic — [Outils](/docs/fr/automation/tools/).

### Progression de l’agent

| Libellé | Signification |
|---------|---------------|
| **Tour N / Max** | Tour de boucle d’agent actuel vs tours max |
| **En cours** | Exécution en cours |
| **N jetons** | Jetons utilisés jusqu’ici |
| **Annuler** | Abandonner l’exécution |

### Indicateurs de complexité

| Badge | Signification |
|-------|---------------|
| **Simple** | Chemin léger |
| **Géré** | Chemin structuré / supervisé |
| **Autonome** | Chemin à plus haute autonomie |
| **Assistant** | Flux assisté par assistant |

### Portée de voix

| Commande | Signification |
|----------|---------------|
| **Voix · INTERNE / EXTERNE / AUTO** | Quel profil de voix est actif ([Profils de voix](/docs/fr/agents/voice/)) |
| **Surcharger la portée de voix** | Forcer Interne, Forcer Externe, ou Auto |
| **(par défaut)** | Utilise le défaut de l’agent sans surcharge |

---

## Compositeur (saisie)

| Commande | Signification |
|----------|---------------|
| **Saisissez un message…** | Saisie principale (`Shift+Enter` = nouvelle ligne, Entrée = envoyer) |
| **Joindre un fichier** | Ajouter une pièce jointe au prochain message |
| **Améliorateur de prompt** | Ouvre un dialogue itératif d’affinage du prompt avant l’envoi |
| **Plan d’abord** (icône carte) | Cet envoi écrit un plan et attend — aucun outil ne tourne tant que vous n’avez pas répondu |
| Bandeau d’erreur | Dernière erreur d’envoi / de flux |

### Dialogue Améliorateur de prompt

Coach itératif qui **façonne le prompt pour la famille de modèles de la conversation** (Claude, OpenAI, Gemini, Grok, Kimi, …) avant l’envoi. Description : *Un coach de prompt itératif — optimisé pour la famille de modèles de la conversation. Choisissez un type de tâche, affinez, puis Appliquer.*

| Commande | Signification |
|----------|---------------|
| Zone objectif / brouillon | Décrivez ce que vous voulez affiner (*Saisissez un brouillon de prompt ou un objectif…*) |
| **Optimisé pour …** | Badge de famille de modèles cible (depuis Fournisseur/Modèle du fil) |
| Puces de type de tâche | **Général · Codage · Recherche · Analyse · Rédaction · Agentique · Fichiers / vision** — oriente la structure et la liste de contrôle |
| **Joindre un fichier** | Fichiers de contexte pour l’améliorateur uniquement (ou à reporter) |
| **Envoyer** | Continuer l’affinage avec l’agent améliorateur |
| **Qualité N/10** | Score heuristique de qualité ; **Lacunes : …** liste les éléments manquants ; **Liste de contrôle couverte** lorsque c’est complet |
| **Proposer deux alternatives (concis + approfondi)** | Demander des variantes **Concis** / **Approfondi** / **Recommandé** |
| **Prompt final suggéré** | Texte candidat à insérer |
| **reporter N fichiers** | Si les pièces jointes doivent entrer dans le chat principal |
| **Appliquer** | Insérer le prompt final (ou le dernier) dans le compositeur principal |

Pour des prompts système **durables** de projet / agent (pas des brouillons de chat ponctuels), utilisez le [Coach de prompt](/docs/fr/ai/prompts/#prompt-coach) sur Projets et Configuration d’agent.

---

## Rail de contexte (fil) {#context-rail-chatter}

Onglets (panneau de droite) :

**Historique · Sources · Dossiers · Suite · Fichiers** (plus **God** si le Mode Dieu est actif ou après une course)

### Historique (messages / filtres)

| Commande | Signification |
|----------|---------------|
| **Historique** | Notes chronologiques et mises à jour du tableau |
| **Tout / Notes / Modifications** | Filtrer notes vs changements de champs |
| **Ajouter une note…** + **Ajouter une note** | Note humaine sur l’enregistrement (ce n’est pas un tour de chat vers le modèle) |
| Badges **Note** / **Mise à jour** | Type d’entrée |
| **Aujourd’hui / Hier** | Groupement temporel |

### Sources (épinglage code / Odoo)

Sélection multiple des **sources de recherche indexées** que cette conversation peut utiliser (p. ex. Odoo 18c + modules personnalisés). Empêche de mélanger plusieurs versions d’Odoo dans un même fil.

| Commande | Signification |
|----------|---------------|
| Liste à cases | Toutes les sources de recherche enregistrées (libellé, version, statut, chemin) |
| **Tout sélectionner** / **Effacer (auto)** | Épingler chaque source / effacer l’épingle |
| **Auto** | Pas d’épingle de conversation — défaut du projet ou règles `needsPin` multi-version |
| **N épinglée(s)** | Nombre de sources sélectionnées |
| **Gérer les sources de recherche →** | Ouvrir `/search-sources` |

**Héritage :** les nouvelles conversations d’un projet, et l’attribution d’un projet à une conversation existante, copient les **sources de code par défaut** du projet. Vous pouvez toujours les surcharger ici.

Configuration complète : [Recherche — épinglage multi-version](/docs/fr/daily/search/#multi-version-pin-which-tree-may-the-agent-use) · [Projets](/docs/fr/daily/projects/).

<h3 id="working-folders">Dossiers (répertoires de travail)</h3>

Racines nommées que cette conversation peut lire et écrire. Le premier chemin est le répertoire de travail **primaire** (cwd). Les outils fichier sont enfermés ici — pas de repli vers le répertoire du processus EYAS. Liste vide : les outils fichier refusent.

Les nouvelles conversations copient la liste du projet. Une liste de projet vide copie celle du **type**. Changer de projet remplace cette liste.

### Champs métier (suivis)

| Champ | Signification |
|-------|---------------|
| **Étape** | Étape du pipeline |
| **Projet** | Lien de projet |
| **Priorité** | Priorité |
| **Statut** | Statut |
| **Date d’échéance** | Date limite |

Les changements apparaissent comme des entrées **Mise à jour** dans le rail.

### Activités

| Commande | Signification |
|----------|---------------|
| **Activités** | Liste d’activités (à faire, suivi, …) |
| **Planifier** | Ouvrir le formulaire de planification |
| **Type** | Type d’activité |
| **Résumé** | Texte de résumé facultatif |
| **Échéance** | Quand c’est dû |
| **Planifier une activité** | Confirmer la création |
| **Marquer comme terminé** | Terminer une activité |
| **En retard / Aujourd’hui / Planifié** | Groupement |
| **N terminée(s)** | Nombre d’activités faites |

### Suite / Fichiers / Exécution

| Zone | Signification |
|------|---------------|
| **Suite** | Activités / prochaines étapes pour cet enregistrement |
| **Fichiers** | Pièces jointes de la conversation |
| **Exécution** | Bandeau de métadonnées d’exécution (repliable ; distinct de l’Historique) |

---

## Fonctions d’équipe

### Arbre de sous-conversations

| Commande | Signification |
|----------|---------------|
| **Équipe / Sous-conversations** | Fils enfants engendrés pour le travail multi-agent |
| **Développer / Ouvrir le tableau d’équipe** | Ouvrir la superposition du tableau |
| **tour N** | Progression sur un sous-fil |

### Tableau d’équipe

| Commande | Signification |
|----------|---------------|
| **Titre / Replier** | Chrome de la superposition |
| **Phase** | Phase d’orchestration actuelle |
| **N tour / N jetons** | Usage |
| Catégories **Constat / Décision / Blocage / Question / Fait** | Types d’entrées de mémoire d’équipe partagée |
| **Voir le chat** | Aller dans le sous-chat d’un membre |
| **Mémoire d’équipe** | Constats / décisions / blocages agrégés |

### Carte de proposition d’équipe

| Commande | Signification |
|----------|---------------|
| **Proposition d’équipe** | Plan d’exécution multi-agent |
| **~N jetons · coût** | Estimation |
| **Phases** | Phases parallèles vs séquentielles |
| **Spécialistes manquants** | Modèles pas encore créés |
| **Créer maintenant** | Amorcer les agents manquants |
| **Approuver / Modifier / Ignorer / Ignorer (risqué)** | Accepter le plan, le modifier (si disponible), ou l’ignorer |

### Arbre d’exécution / flux de travail

Affiche la structure hiérarchique d’exécution d’agent pour une orchestration complexe (libellé **Flux de travail**).

---

## Mode Dieu

Le Mode Dieu fait courir la **même tâche** en parallèle sur plusieurs modèles, puis compare les résultats. Ce n’est pas un quatrième style d’orchestration : Solo / Auto / Deep décrivent toujours comment chaque travailleur décompose le travail. Le Mode Dieu décide seulement que plusieurs modèles concourent (pas une équipe de spécialistes). On peut les combiner : Mode Dieu + Deep signifie que chaque modèle concurrent peut aussi décomposer le travail de son côté.

Il n’y a **pas de fusion automatique**. Un espace de travail gagne ; les idées uniques des autres sont listées pour que vous les appliquiez.

| Sujet | Signification |
|-------|---------------|
| **Liste** | **Paramètres → Mode Dieu** (carte sous les affectations de modèles). Choisissez 2 à 5 paires fournisseur/modèle actives. Un nombre pair exige un président départageur. |
| **Menu** | Dernier élément du contrôle **Orchestration** (après un séparateur) : Solo, Auto, Deep, puis **Mode Dieu**. Choisir Mode Dieu l’active et **laisse** Solo/Auto/Deep inchangés (les travailleurs héritent de ce style). Choisir Solo/Auto/Deep désactive le Mode Dieu. |
| **Coût** | Le premier envoi après activation demande confirmation (liste, estimation, plafond). Les envois suivants n’affichent qu’une bannière. Si l’estimation dépasse le plafond, l’envoi est bloqué jusqu’à ce que vous releviez le plafond ou désactiviez le Mode Dieu. |
| **Dossiers** | Les travailleurs s’exécutent dans des copies isolées des dossiers de travail (worktree git si possible). Sans dossiers, l’exécution démarre quand même, sans isolation de fichiers. |
| **Gagnant + idées** | Seuls les fichiers modifiés du gagnant arrivent sur les dossiers de la conversation. Les idées uniques des autres figurent dans l’onglet **God** — à appliquer vous-même, rien n’est fusionné automatiquement. |

### Liste dans les Paramètres

Dans [Paramètres](/docs/fr/admin/settings/), sous les affectations de modèles, la carte **Mode Dieu** est la liste globale utilisée par chaque conversation Mode Dieu.

| Champ | Signification |
|-------|---------------|
| **Modèles** | 2 à 5 paires fournisseur/modèle actives. Pas de doublons. |
| **Président départageur** | L’un de ces modèles. **Obligatoire si le nombre est pair** ; recommandé toujours (un travailleur en échec peut laisser un reste pair). Le président est un concurrent, pas un juge à part. |
| **Plafond de coût (USD)** | Optionnel. Si l’estimation préalable le dépasse, l’exécution ne démarre pas. Si la dépense le franchit en cours de course, les travailleurs inachevés sont annulés et le système décide parmi ceux qui ont fini. |
| **Conserver les dossiers (heures)** | Les arbres isolés sont supprimés après ce nombre d’heures (72 par défaut). |

Enregistrer la liste ne réécrit pas les exécutions déjà lancées : chaque envoi prend un instantané.

La bande fournisseur/modèle de la conversation est ignorée pour un envoi Mode Dieu — c’est la liste des Paramètres qui court.

### Activer le Mode Dieu

1. Ouvrez le menu **Orchestration** de la conversation et choisissez **Mode Dieu**.
2. Envoyez un message. Le premier envoi demande une confirmation de coût (qui court, USD estimé, plafond). Confirmez pour démarrer.
3. Tant qu’il est actif, une bannière **Mode Dieu** reste affichée. Le rail de droite gagne un onglet **God**.
4. **Stop** annule toute la course, pas seulement un travailleur.

### Isolation et vainqueur

Chaque travailleur a son propre dossier (worktree git si le répertoire de travail est un dépôt ; sinon une copie). Pendant le travail, ils ne voient pas les fichiers des autres.

Quand un vainqueur est choisi, **seuls ses fichiers modifiés** sont copiés sur les dossiers de la conversation. Ceux des autres restent dans leurs arbres jusqu’à la rétention. Sans dossiers de travail, il n’y a rien à promouvoir ; le vainqueur est tout de même choisi d’après les réponses écrites.

### L’onglet God

L’onglet **God** du rail apparaît tant que le Mode Dieu est actif, **ou** dès que la conversation a eu au moins une exécution Mode Dieu (il reste si vous le désactivez ensuite).

#### En-tête

Phase actuelle, plus tokens, USD et durée totaux.

| Phase | Signification |
|-------|---------------|
| **Préparation** | Instantané de la liste, dossiers isolés |
| **Course** | Les travailleurs exécutent le même message en parallèle |
| **Revue** | Les survivants se notent et votent |
| **Décision** | Vainqueur enregistré |
| **Promotion** | Fichiers du vainqueur sur les dossiers de la conversation |
| **Terminé / Échoué / Annulé** | État terminal |

Un travailleur en échec affiche aussi l’erreur du fournisseur (par exemple une API saturée).

#### Étapes

Journal horodaté de ce qui s’est passé :

| Étape | Signification |
|-------|---------------|
| Course lancée | Course créée à partir de la liste actuelle |
| Workers en parallèle | Chaque modèle actif commence la même tâche |
| *Modèle* a terminé / a échoué | La tentative propre de ce travailleur est close |
| Revue croisée | Les survivants lisent les résumés et votent |
| Vainqueur : *modèle* | Décision enregistrée |
| Promotion de l’espace du vainqueur | Fichiers sur les dossiers de la conversation |
| Course terminée / échouée / annulée | État terminal |

Les exécutions antérieures à ce journal affichent une frise reconstruite à partir des heures de fin.

#### Comment le vainqueur a été choisi

Ce bloc indique la règle appliquée, le décompte des voix et **qui a voté pour qui**.

| Règle | Quand |
|-------|-------|
| **Majorité** | Un modèle a reçu plus de votes valides que tout autre. Un modèle **ne peut pas voter pour lui-même** ; ces votes sont écartés. |
| **Égalité — le président a choisi** | Deux modèles ou plus à égalité, et le président est parmi eux. |
| **Égalité — le plus rapide** | Égalité et le président manque ou n’est pas parmi les ex æquo. Parmi eux, celui qui a fini le premier gagne. |
| **Un seul a terminé** | Tous les autres ont échoué ou ont été annulés ; le survivant gagne, sans vote croisé. |

Si un appel de revue échoue, ce travailleur n’a simplement pas de vote. La décision continue avec ceux qui ont voté.

#### Ce qu’ils ont dit du travail des autres

Après la course, les survivants font **une** revue croisée structurée (pas de débat en direct). Pour chaque relecteur, sans clic supplémentaire :

- pour qui ils ont voté
- notes 1–5 : **qualité**, **complétude**, **risque**
- leur commentaire écrit sur le travail des autres
- idées uniques qu’ils estiment manquées par les autres
- risques signalés

Déplier la carte d’un modèle montre **son propre** travail (produit avant la revue) et toute erreur.

#### Idées uniques

Liste dédupliquée des idées des **non-vainqueurs** qui n’apparaissent pas déjà dans la liste du vainqueur. Si vous les voulez dans l’espace promu, vous les appliquez vous-même — rien n’est fusionné automatiquement.

### Sous-conversations

Chaque travailleur est une conversation enfant intitulée `God <modèle>`. Elles peuvent apparaître dans la liste comme sous-conversations. Le Mode Dieu y est **désactivé** pour qu’elles ne lancent pas une autre course.

La comparaison globale (taux de victoire par modèle, multiple de coût moyen par rapport à un seul modèle) est sous [Observabilité](/docs/fr/admin/observability/). Un clic ouvre l’onglet God de la conversation.

---

## Propositions de compétence

Une compétence qui matche est une **proposition sur laquelle le tour attend** — rien de cette compétence ne s’exécute tant que vous n’avez pas répondu. La carte montre le nom, le motif et le score.

| Commande | Signification |
|----------|---------------|
| **Une compétence correspond — l'utiliser ?** | Titre |
| **L'utiliser** | Accepter pour cette conversation ; le tour reprend avec la compétence |
| **Pas cette fois** | Refuser pour cette conversation seulement |
| **Désactiver** | Refuser **et** désactiver la compétence globalement (owner/admin seulement). Réactivation sous [Compétences](/docs/fr/automation/skills/) |

Votre réponse est mémorisée pour cette conversation. Qui peut parler mais pas gérer les compétences voit encore **L'utiliser** et **Pas cette fois**.

<h2 id="plan-mode">Plan d’abord</h2>

L’icône carte du compositeur est **Plan d’abord**. Cet envoi **n’exécute pas** d’outils. Le statut devient **En attente de plan**. Une carte **Plan pour ce tour** apparaît : **Approuver** · **Ignorer le plan** · **Rejeter** · **Annuler**. Tant que la carte attend, rien n’a tourné.

## Designs joints

L’icône de formes dans la barre supérieure est **Designs**. Les canevas joints voyagent avec chaque tour (l’agent récupère des parties via `design_read`). Les designs du projet sont copiés sur une nouvelle conversation créée dans ce projet ; ensuite le fil possède les liens.

| Commande | Signification |
|----------|---------------|
| **Designs joints** | Liste des canevas, coche sur ceux liés ici |
| Compteur | Combien sont joints |
| **Ouvrir Design** | Aller à `/design` |
| **Aucun design pour l’instant.** | Liste vide — créez d’abord un canevas |

## Voir aussi

- [Sources de recherche et épinglage multi-version](/docs/fr/daily/search/)
- [Projets — répertoires de travail et wiki](/docs/fr/daily/projects/)
- [Vue d’ensemble des agents](/docs/fr/agents/overview/)
- [Tableau](/docs/fr/daily/board/)
- [Profils de voix](/docs/fr/agents/voice/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [Canevas de design](/docs/fr/knowledge/design/)
- [Compétences](/docs/fr/automation/skills/)
- [Observabilité — onglet God Mode](/docs/fr/admin/observability/)
