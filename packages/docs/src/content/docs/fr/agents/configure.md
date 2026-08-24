---
title: Créer et configurer
description: Onglet Configuration du détail d'un agent — chaque champ expliqué.
---

**Chemin :** `/agents/:id` → onglet **Configuration**.

Affiche aussi le résumé **Budget de tokens** et **Exécution…** lorsqu'une exécution est active.

## Classification

| Champ | Signification |
|-------|---------------|
| **Niveau** | Principal / Équipe / Spécialiste (voir [vue d'ensemble](/docs/fr/agents/overview/)) |
| **Type d'agent** | Assistant, Ingénieur, Développeur, … |

## Bloc persona

| Champ | Signification |
|-------|---------------|
| **Nom** | Nom affiché |
| **Rôle** | Ligne de rôle courte |
| **Description** | Description plus longue |
| **Persona** | Résumé de persona |
| **Objectif** | Ce qui guide les décisions (*Ce qui guide les décisions de cet agent*) |
| **Histoire** | Contexte qui façonne l'approche (*…point de vue*) |
| **Avatar** | Emoji (ou image) affiché dans l'interface |
| **Prompt système** | Instructions au niveau de l'agent (combinées aux prompts en couches) |
| **Coach de prompt** | Coach IA pour le prompt système (protocole d'exploitation uniquement — pas la voix, pas le domaine du projet) — [Prompts](/docs/fr/ai/prompts/#prompt-coach) |

## Modèle et effort

| Champ | Signification |
|-------|---------------|
| **Modèle** | Identifiant de modèle concret, ou **Automatique (le routage décide)** |
| **Revenir à l'automatique** | Effacer le forçage → routage |
| **Effort** | Automatique / Faible / Moyen / Élevé / Maximal |
| Indication d'effort | Plus élevé = raisonnement plus profond, plus lent, plus coûteux |
| **Tours max.** | Plafond dur de tours de boucle d'agent par exécution |

## Outils et contraintes

| Champ | Signification |
|-------|---------------|
| **Outils (séparés par des virgules)** | Noms d'outils que cet agent peut appeler |
| **Capacités (séparées par des virgules)** | Étiquettes de capacité (p. ex. `research, coding`) |
| **Contraintes (une par ligne)** | Règles strictes (p. ex. pas d'opérations destructrices) |

### Agents de programmation (surface indépendante du modèle)

Pour le travail d'implémentation / correction / revue, accordez les outils fichier de premier plan afin que **n'importe quel** modèle
(pas seulement Claude Code) puisse modifier sans shell :

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| Outil | Usage |
|-------|-------|
| `read_file` / `edit_file` / `write_file` | Lecture et modification ciblée sous l'espace de travail / worktree |
| `grep` / `glob` | Trouver des symboles et des fichiers |
| `git_status` / `git_diff` | Aides à la revue (lecture seule) |
| `run_command` | Tests / lint (niveau rouge — approbation / autonomie) |

Les **agents existants** créés avant la 0.8.6 **n'adoptent pas** automatiquement les nouveaux outils — ajoutez-les
ici (ou réensemencez depuis un modèle mis à jour). Catalogue complet :
[Outils](/docs/fr/automation/tools/).

## Budget

| Champ | Signification |
|-------|---------------|
| **Budget mensuel de tokens** | Plafond du mois ; **`0` = illimité** |
| Affichage de la consommation | Utilisé vs budget sur la liste / le détail |

## Actions

| Commande | Signification |
|----------|---------------|
| **Enregistrer les modifications** | Persister la configuration |

## Onglet Souvenirs (liste en lecture seule)

| Élément | Signification |
|---------|---------------|
| **Épisodique / De travail** | Libellés de niveau de mémoire |
| **N souvenirs** | Nombre |
| **pertinence** | Score d'importance |
| **consulté N×** | Nombre d'accès |
| Indication vide | Se remplit à mesure que l'agent travaille |

## Onglet Canaux (résumé)

Liez des instances de canal pour que les messages entrants atteignent cet agent. Liste complète des champs : [Vue d'ensemble des canaux](/docs/fr/communication/channels/) et interface des canaux d'agent :

| Commande | Signification |
|----------|---------------|
| **Associer une instance de canal** | Choisir une instance Telegram/… existante |
| **Associer à cet agent** | Attacher |
| **Dissocier** | Détacher |
| Statut **Connecté / Erreur / Identifiants définis / Non configuré** | Santé de l'instance |
| Mode **Autonome** | Le canal peut piloter un traitement autonome |

## Voir aussi

- [Identité et espace de travail](/docs/fr/agents/identity-workspace/)
- [Profils vocaux](/docs/fr/agents/voice/)
- [Fournisseurs](/docs/fr/ai/providers/)
