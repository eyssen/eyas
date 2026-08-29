---
title: Utilisateurs et permissions
description: Humains, identités d’agent, rôles, archiver et restaurer.
---

**À quoi ça sert.** Annuaire des humains qui se connectent et des identités **agent** sans login. CASL sur chaque API protégée. Modèle/outils sont sous [Configurer](/docs/fr/agents/configure/). **Nouvel agent** crée l’identité et saute à l’éditeur.

**Route :** `/users`. Barre : **Utilisateurs**.

## Quand l'utiliser

- Un second humain (opérateur/lecteur).
- Nouvelle identité d’agent sans passer d’abord par Agents.
- Quelqu’un part — **Archiver** (doux). Le root owner et les users agent ne s’archivent pas d’ici.
- **Actifs** vs **Archivés**.

## Déroulement typique

1. **Utilisateurs**.
2. **Actifs / Archivés**.
3. **Nouvel agent** → `/agents/<id>`.
4. Humains via setup/provisioning ; rôles CASL.
5. Archiver (confirmer). Restaurer depuis **Archivés**.

Archiver = `DELETE /users/:id` ; restaurer `POST /users/:id/restore`.

## Voir aussi

- [Setup — propriétaire racine](/docs/fr/setup-wizard/)
- [Clés API](/docs/fr/admin/secrets/)
- [Agents](/docs/fr/agents/overview/)
- [Sécurité](/docs/fr/admin/security-privacy/)
