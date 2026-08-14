---
title: Utilisateurs et autorisations
description: Utilisateurs humains, rôles, autorisations CASL.
---

**Chemin :** `/users`.

| Concept | Signification |
|---------|---------------|
| **Propriétaire racine** | Premier administrateur issu de l'installation (`is_root_owner`) |
| Rôle | par ex. propriétaire / opérateur / observateur (selon la définition) |
| Statut | actif / désactivé |
| Utilisateurs agent | Identités sans connexion liées aux agents (`is_agent`) |

Créez des utilisateurs pour les installations multi-utilisateurs ; les autorisations sont appliquées via CASL sur les routes API.

## Voir aussi

- [Assistant — propriétaire racine](/docs/fr/setup-wizard/)
- [Clés API](/docs/fr/admin/secrets/)
