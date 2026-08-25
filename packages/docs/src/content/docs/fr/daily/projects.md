---
title: Projets
description: Types de projets, projets, étapes — chaque champ de formulaire.
---

**Route :** `/projects` (aussi sous Paramètres → Projets).  
Sous-titre : *Gérer les types de projets, les projets et les flux d’étapes.*

Les projets regroupent les **conversations** en **étapes** avec des agents et prompts par défaut facultatifs.

## Onglets / sections

| Section | Rôle |
|---------|------|
| **Projets** | Instances concrètes de projets |
| **Types de projets** | Modèles pour les nouveaux projets |
| **Étapes** | Étapes de flux de travail globales (partagées) |

---

## Projets {#projects}

Intro : *Les projets organisent les conversations en étapes avec des flux personnalisés.*

| Champ / commande | Obligatoire | Signification |
|------------------|-------------|---------------|
| **Nouveau projet** | — | Ouvrir le formulaire de création |
| **Modifier le projet** | — | Modifier le projet sélectionné |
| **Nom** | Oui | Nom affiché du projet (p. ex. `EYAS v1.0`) |
| **Type** | Oui | Modèle de type de projet (`Sélectionner un type…`) |
| **Description** | Non | Courte description |
| **Couleur** | Non | Pastille de couleur d’interface |
| **Agent par défaut** | Oui | Agent assigné aux nouvelles conversations de ce projet |
| **Prompt** | Non | Prompt système supplémentaire pour les conversations de ce projet |
| **Coach de prompt** | — | Coach IA pour le brief opérationnel du projet (domaine, conventions, critères de succès) — [Prompts](/docs/fr/ai/prompts/#prompt-coach) |
| **Sources de code par défaut** | Non | Sélection multiple de [sources de recherche](/docs/fr/daily/search/) (p. ex. Odoo `18c` + modules). Épinglées automatiquement sur les **nouvelles conversations** de ce projet et lorsqu’on définit le champ **Projet** d’une conversation sur ce projet |
| Badge **Agent** / **Aucun agent** | — | Si un agent par défaut est défini |
| Badge **N sources** | — | Combien de sources de code par défaut sont sélectionnées |

Vide : créez un projet pour organiser les conversations.

### Sources de code par défaut (multi-version)

1. Enregistrez les dépôts sous **Sources de recherche** (une source par version / arborescence Odoo, avec **Libellé** + **Famille : odoo**).
2. **Réindexer** jusqu’à ce que le statut soit **prêt**.
3. Sur le formulaire du projet, cochez les sources que ce projet doit utiliser par défaut.
4. Ouvrez une conversation dans le projet → l’onglet **Sources** du rail de droite affiche les mêmes épingles (vous pouvez encore les changer par fil).

Voir [Recherche — épinglage multi-version](/docs/fr/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

---

## Types de projets

Intro : *Modèles avec prompts et paramètres pour les nouveaux projets.*

| Champ / commande | Signification |
|------------------|---------------|
| **Nouveau / Modifier un type de projet** | CRUD du type |
| **Nom** | Nom du type (p. ex. Développement) |
| **Priorité par défaut** | Basse / Normale / Haute / Urgente pour les nouvelles conversations |
| **Icône** | Sélecteur d’icône ; **Effacer l’icône** la retire |
| **Prompt** | Prompt système appliqué aux projets de ce type |
| **Coach de prompt** | Coach IA pour les défauts réutilisables de type de projet — [Prompts](/docs/fr/ai/prompts/#prompt-coach) |
| **Couleur** | Couleur du type |

Les types d’amorçage incluent souvent **general** et **eyas** (liés aux agents principaux à la configuration).

---

## Étapes

Intro : *Étapes de flux de travail globales utilisées par tous les projets. Glissez pour réordonner.*

| Champ / commande | Signification |
|------------------|---------------|
| **Ajouter une étape** / **Nouvelle étape** | Créer une étape |
| **Nom** | Libellé d’étape (titre de colonne kanban) |
| **Fermé** | Étape finale — travail considéré comme terminé |
| **Replié** | Colonne repliée par défaut sur le Tableau |
| **Bot** (Écoute bot) | L’IA surveille cette étape |
| **Auto-assignation** | Agent qui reçoit les cartes entrant dans cette étape et peut s’exécuter de façon autonome (`Aucun` = désactivé) |

Infobulles : Fermé = final ; Replié = replié ; Écoute bot = l’IA surveille ; Auto-assignation = transfert + exécution autonome.

---

## Lien avec le Tableau et le chat

1. Créez un **type** → créez un **projet** avec un agent par défaut **et des sources de code par défaut facultatives**  
2. Définissez les **étapes** (colonnes globales)  
3. Les conversations sur le **Tableau** se déplacent d’étape en étape  
4. Les champs de conversation **Projet** / **Étape** reflètent cette structure  
5. L’onglet **Sources** de la conversation hérite de l’épingle de sources de code du projet (surchargeable)

## Voir aussi

- [Tableau](/docs/fr/daily/board/)
- [Conversations](/docs/fr/daily/conversations/)
- [Sources de recherche](/docs/fr/daily/search/)
