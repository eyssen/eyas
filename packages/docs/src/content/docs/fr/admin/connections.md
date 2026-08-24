---
title: Connexions
description: Inventaire des systèmes externes — contrôles de santé, secrets du coffre, propositions d'agents.
---

**Chemin :** `/connections`.  
Sous-titre : *Systèmes externes qu'EYAS peut utiliser — inventaire, santé et propositions d'agents.*

Les connexions forment un **inventaire nommé** de systèmes externes (Odoo, GitHub, MCP, …). Les identifiants vont dans le [coffre des secrets](/docs/fr/admin/secrets/) ; les agents peuvent **proposer** une connexion pour approbation humaine au lieu de disperser la configuration entre MCP, compétences et secrets ponctuels.

---

## Onglets

| Onglet | Rôle |
|--------|------|
| **Connexions** | Inventaire actif (connecté / erreur / désactivé / inconnu) |
| **Catalogue** | Types de systèmes connus — choisissez-en un pour créer une instance |
| **En attente** | Connexions proposées par un agent, en attente d'**Approuver** / **Rejeter** |

---

## Liste des connexions

| Contrôle / champ | Signification |
|------------------|---------------|
| **N connexions** | Nombre de lignes de l'inventaire |
| **Ajouter une connexion** | Ouvrir le formulaire de création (ou partir du catalogue → **Utiliser**) |
| **Nom** | Libellé humain de cette instance |
| **Système** | Type du catalogue (Odoo, GitHub, …) |
| **Statut** | En attente / Désactivé / Connecté / Erreur / Inconnu |
| **Adaptateur** | Comment EYAS dialogue : `native`, `http` ou `mcp` |
| **Dernier contrôle** | Horodatage du dernier test de santé |
| **Erreur** | Dernier message de test / d'erreur |
| **Source** | **Utilisateur** / **Agent** / **Système** — qui l'a créée |
| **Tester** | Exécuter l'adaptateur de santé (par ex. sonde d'authentification) |
| **Modifier** | Mettre à jour le nom, la configuration, les secrets |
| **Supprimer** | Retirer la connexion (le schéma des secrets du coffre reste documenté dans Secrets) |

Vide : *Aucune connexion pour l'instant. Ajoutez-en une depuis le catalogue ou approuvez une proposition d'agent.*

---

## Formulaire de création / modification

| Champ | Signification |
|-------|---------------|
| **Nom** | Nom affiché de cette instance |
| **Type de système** | Entrée du catalogue (fixe après création dans la plupart des flux) |
| **Configuration** | Champs non secrets (URL, base, organisation, …) selon le type |
| **Secrets** | Champs sensibles — stockés dans le coffre sous `conn-{id}-{field}` ; *jamais réaffichés après l'enregistrement* |
| **Disponible pour tous les agents** | Portée par défaut lorsqu'elle est affichée |
| **Enregistrer / Annuler** | Conserver ou abandonner |

Raccourcis liés : **Paramètres MCP**, **Secrets** (le cas échéant).

---

## Types du catalogue

| Type | Adaptateur | Usage typique |
|------|------------|---------------|
| **Odoo** | native | ERP / Helpdesk JSON-RPC + outils de tickets |
| **GitHub** | http | Dépôts, issues, PR, publications |
| **GitLab** | http | Projets, issues, MR |
| **Linear** | http | API issues / projets |
| **Notion** | http | Pages et bases de données |
| **Jira** | http | Issues Atlassian Cloud |
| **Slack (API)** | http | Outils de bot d'espace de travail (le canal de discussion est distinct, sous Communication) |
| **Serveur MCP** | mcp | Lier une ligne d'inventaire à un serveur MCP déjà configuré sous [MCP](/docs/fr/ai/mcp/) |
| **HTTP personnalisé** | http | REST générique avec jeton bearer / clé API |

Intro du catalogue : *Types de systèmes connus. Choisissez-en un pour créer une instance de connexion.*

---

## Propositions en attente

Les agents peuvent appeler des outils pour **proposer** une connexion. Vous examinez le motif et la configuration dans l'onglet **En attente** :

| Contrôle | Signification |
|----------|---------------|
| **Motif** | Pourquoi l'agent souhaite cette connexion |
| **Approuver** | Créer / activer la connexion |
| **Rejeter** | Écarter la proposition |

Aucune attente : *Aucune proposition en attente.*

---

## Outils d'agent

Lorsque le module des connexions est chargé, les agents peuvent utiliser :

| Outil | Rôle |
|-------|------|
| `connections_list` | Lister l'inventaire |
| `connections_catalog` | Lister les types du catalogue |
| `connections_test` | Contrôle de santé d'une connexion |
| `connections_propose` | Proposer une nouvelle connexion à approuver |

---

## Voir aussi

- [Secrets](/docs/fr/admin/secrets/)
- [Serveurs MCP](/docs/fr/ai/mcp/)
- [Outils](/docs/fr/automation/tools/)
- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
