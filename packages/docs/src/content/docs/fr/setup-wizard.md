---
title: Assistant de configuration
description: Assistant du premier démarrage — chaque étape, champ et commande expliqués.
---

L’assistant s’exécute **une seule fois** tant que la configuration est incomplète. Le navigateur est redirigé vers `/setup` jusqu’à ce que les étapes obligatoires soient terminées. Les étapes facultatives peuvent être ignorées et reprises plus tard dans Paramètres.

Chrome présent à chaque étape :

| Commande | Signification |
|----------|---------------|
| **Langue** | Langue de l’interface produit (`en` / `hu` / `de` / `es` / `fr` / `tlh`). Stockée dans le magasin de langue du client. |
| **Apparence** | Modèle de thème (p. ex. Halo, Nebula) + bascule clair/sombre. |
| **Étape N sur M** | Progression parmi les étapes en attente. |
| **Continuer / Terminer la configuration** | Valider l’étape en cours et passer à la suivante. |

---

## Ordre des étapes (typique)

| Ordre | ID d’étape | Obligatoire | Module |
|------:|------------|-------------|--------|
| — | Apparence / langue (chrome UI) | — | frontend |
| 1 | **Mot de passe maître** | Oui | secrets |
| 2 | **Propriétaire racine** | Oui | auth |
| 3 | **Agents principaux** | Oui | auth |
| 4 | **Agents d’équipe** | Non | auth |
| 5 | **Fournisseur d’IA** | En général | model |
| 6 | **Modèles d’IA** | En général | model |

L’enregistrement exact est modulaire — les modules enregistrent des étapes au démarrage. Les étapes obligatoires doivent être terminées avant que l’application principale ne se déverrouille.

---

## Mot de passe maître

**Objectif :** chiffrer au repos tous les secrets stockés (clés API, jetons).

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| **Mot de passe maître** | Oui | Phrase secrète pour le matériau de clé de chiffrement des secrets. Choisissez quelque chose de robuste ; sans elle, la récupération implique de ressaisir les clés des fournisseurs. |
| **Confirmer le mot de passe** | Oui | Doit correspondre au mot de passe maître. |

Après cette étape, les secrets saisis via l’interface passent par le magasin Secrets chiffré.

---

## Propriétaire racine

**Objectif :** créer l’administrateur humain principal (`role: owner`, `is_root_owner`).

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| **Nom d’utilisateur** | Oui | Identifiant de connexion (exemple de placeholder : `admin`). Doit être unique. |
| **Mot de passe** | Oui | Mot de passe du compte (haché ; jamais stocké en clair). |
| **Nom affiché** | Non | Nom convivial dans l’interface (par défaut le nom d’utilisateur s’il est vide). |

L’assistant conserve les identifiants du propriétaire **en mémoire** pour le reste de la session afin que les étapes facultatives nécessitant un propriétaire authentifié puissent s’exécuter sans nouvelle connexion. Si vous rechargez au milieu de l’assistant alors qu’il ne reste que des étapes facultatives, vous pouvez être envoyé vers **Connexion** puis de nouveau vers `/setup`.

---

## Agents principaux

**Objectif :** créer les deux coéquipiers toujours actifs.

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| **Assistant personnel** | Oui | Nom affiché de votre agent au quotidien (p. ex. Jarvis). Niveau : principal, type : assistant. Lié au type de projet **general**. |
| **Ingénieur système** | Oui | Nom affiché de l’agent qui maintient EYAS lui-même (p. ex. R2D2). Niveau : principal, type : engineer. Lié au type de projet **eyas**. |

Ce qui est créé pour chacun :

- ligne `agent_definitions` (modèle, outils, chemin d’espace de travail, …)
- arborescence d’espace de travail sous `data/agents/<id>/` (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- enregistrement **utilisateur agent** lié (`is_agent = 1`) pour les permissions / l’adressage

Vous pouvez les renommer et les reconfigurer plus tard sous **Agents**.

---

## Agents d’équipe (facultatif)

**Objectif :** activer des modèles de spécialistes auxquels les agents principaux peuvent déléguer.

| Commande | Description |
|----------|-------------|
| **Recommandés** | Ensemble de modèles mis en avant pour une installation typique. |
| **Spécialistes** | Catalogue complet des modèles d’agents facultatifs. |
| **Tout sélectionner / Tout désélectionner** | Bascule en masse. |
| **N sélectionné(s)** | Nombre de modèles choisis. |
| **Ignorer / Continuer** | Terminer sans spécialistes, ou appliquer la sélection. |

La sélection est stockée sous forme d’identifiants de modèles et amorcée en agents réels (même schéma d’espace de travail que les principaux). Modifiez plus tard sous Paramètres / Agents.

---

## Fournisseur d’IA

**Objectif :** garantir qu’au moins un backend de modèle est disponible.

### CLI de l’hôte (si détectées)

| Commande | Description |
|----------|-------------|
| Badge (Claude / Grok / Kimi) | CLI locale trouvée et utilisable — **aucune clé API**. |
| **CLI principale** | Quelle CLI détectée est celle par défaut pour les agents et le routage. |
| **Utiliser un autre fournisseur** | Passer à la configuration d’API cloud/locale. |
| **Retour aux CLI détectées** | Revenir à la vue centrée sur les CLI. |

### Fournisseurs manuels / API

| Commande | Description |
|----------|-------------|
| Liste des fournisseurs | Backends connus (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **Actif / Inactif** | Si le fournisseur est activé pour le routage. |
| **Configurer / Changer la clé** | Ouvrir la saisie de clé API. |
| Champ **Clé API** | Secret ; enregistré dans Secrets chiffré. |
| **Enregistrer** | Persister la clé et marquer le fournisseur comme utilisable. |
| **Revérifier** | Sonder à nouveau les points de terminaison locaux (p. ex. URL Ollama). |
| **Continuer / Terminer la configuration** | Avancer même si aucun n’est actif (vous pourrez terminer plus tard dans Paramètres → Fournisseurs) — voir l’avertissement à l’écran. |

---

## Modèles d’IA

**Objectif :** attribuer un modèle concret à chaque agent une fois qu’un fournisseur est prêt.

| Commande | Description |
|----------|-------------|
| Colonne **Agent** | Nom de l’agent issu des étapes précédentes. |
| Colonne **Modèle** | Liste déroulante des modèles du fournisseur principal/actif (meilleure correspondance présélectionnée). |
| **Appliquer** | Enregistrer les attributions. |
| **Aller aux fournisseurs** | Sauter vers l’interface Fournisseurs complète si rien n’est configuré. |
| **Terminer la configuration** | Fermer l’assistant et entrer dans l’application principale. |

Si aucun fournisseur n’est détecté : suivez l’indication pour configurer les Fournisseurs après l’assistant.

---

## Après l’assistant

| Destination | Pourquoi |
|-------------|----------|
| [Accueil](/docs/fr/daily/home/) | Recommandations de configuration pour le travail facultatif restant |
| [Fournisseurs](/docs/fr/ai/providers/) | Ajouter d’autres backends, clés, modèles |
| [Agents](/docs/fr/agents/overview/) | Relire les principaux et les spécialistes |
| [Utilisateurs](/docs/fr/admin/users/) | Ajouter des utilisateurs humains (si multi-utilisateur) |

## Notes de sécurité

- Le mot de passe maître protège les **secrets**, pas le chiffrement au repos du fichier SQLite à lui seul — protégez le disque hôte et les sauvegardes.
- Le mot de passe du propriétaire racine est indépendant du mot de passe maître.
- Les « utilisateurs » agents ne sont pas des connexions interactives pour les humains ; ils existent pour l’identité et le câblage ACL.
