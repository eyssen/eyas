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
| **Orchestration** | **Solo** = pas de sous-agents ; **Auto** = le modèle décide du déploiement ; **Deep** = déploiement multi-agent agressif avec effort max |

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

## Voir aussi

- [Sources de recherche et épinglage multi-version](/docs/fr/daily/search/)
- [Projets — sources de code par défaut](/docs/fr/daily/projects/)
- [Vue d’ensemble des agents](/docs/fr/agents/overview/)
- [Tableau](/docs/fr/daily/board/)
- [Profils de voix](/docs/fr/agents/voice/)
- [Mémoire](/docs/fr/knowledge/memory/)
