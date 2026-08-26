---
title: Conversations
description: Espace de discussion — chaque champ, rail et commande pour parler avec les agents.
---

**Entrée :** barre latérale **Nouvelle conversation** (création via `POST /conversations`) ou ouverture d’un fil existant depuis le Tableau / Récentes.

Disposition : **messages + compositeur** (principal) et **rail de contexte** (fil : notes, champs, activités, fichiers, exécution).

---

## Statut de la conversation

| Statut | Signification |
|--------|---------------|
| **Inactif** | Aucune exécution d’agent active |
| **Au travail…** | L’agent s’exécute |
| **En attente** | En attente d’une entrée utilisateur ou externe |
| **En attente d’approbation** | Bloqué en attente d’une approbation humaine (sécurité / autonomie) |
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
| **Orchestration** | **Solo** = pas de sous-agents ; **Auto** = le modèle décide du déploiement ; **Deep** = déploiement multi-agent agressif avec effort max. Dernier élément **Mode Dieu** — même tâche courue par la liste des Paramètres (voir [Mode Dieu](#mode-dieu)). |

---

## Flux de messages

| Commande / libellé | Signification |
|--------------------|---------------|
| **Démarrer une conversation…** | État vide |
| **Réflexion / Réflexion…** | Le modèle raisonne (peut afficher des comptes de caractères) |
| **Composition de la réponse…** | Réponse en cours de diffusion |
| **Arrêter** | Annuler l’exécution en cours |
| **Travail en arrière-plan…** | Vous êtes parti puis revenu ; l’agent travaille encore — les messages apparaissent quand ils sont prêts |
| **Pièce jointe** | Image / fichier intégré au fil |
| Appel d’outil **Entrée / Sortie / Erreur** | Détails d’invocation d’outil développables |

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

**Historique · Sources · Suite · Fichiers**

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

## Voir aussi

- [Sources de recherche et épinglage multi-version](/docs/fr/daily/search/)
- [Projets — sources de code par défaut](/docs/fr/daily/projects/)
- [Vue d’ensemble des agents](/docs/fr/agents/overview/)
- [Tableau](/docs/fr/daily/board/)
- [Profils de voix](/docs/fr/agents/voice/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [Observabilité — onglet God Mode](/docs/fr/admin/observability/)
