---
title: Secrets et clés API
description: Magasin de secrets chiffrés et clés API machine.
---

## Secrets

**Chemin :** `/secrets`.

| Concept | Signification |
|---------|---------------|
| Mot de passe maître | Défini à l'installation — chiffre les charges utiles des secrets |
| Portée | frontières système / utilisateur / agent |
| Entrée de secret | Nom + valeur ; la valeur n'apparaît jamais dans les journaux |
| Utilisé par | Fournisseurs, canaux, intégrations |

## Clés API (machine)

**Chemin :** `/api-keys`.

Émettez des clés pour l'accès programmatique aux API EYAS (pas les clés des fournisseurs). Révoquez-les lorsqu'elles ne sont plus utilisées.

## Voir aussi

- [Assistant — mot de passe maître](/docs/fr/setup-wizard/)
- [Fournisseurs](/docs/fr/ai/providers/)
