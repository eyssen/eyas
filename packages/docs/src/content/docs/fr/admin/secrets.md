---
title: Secrets et clés API
description: Coffre chiffré pour les clés fournisseur/canal, plus clés machine pour l’API EYAS.
---

**À quoi ça sert.** Deux sortes. **Secrets** (`/secrets`) est le magasin chiffré : clés fournisseur, jetons de canal, destinations de sauvegarde. Les valeurs n’apparaissent jamais dans les logs. **Clés API** (`/api-keys`) appellent *EYAS*, pas Anthropic. Le mot de passe maître du setup chiffre les payloads.

## Quand l'utiliser

- La carte dit **Pas de clé API**.
- Un jeton de canal ne doit pas vivre dans le YAML ni l’historique du shell.
- CI a besoin d’un accès programmatique — copie la clé une fois, révoque plus tard.
- Portée **Système / Utilisateur / Agent**.

## Déroulement typique

1. **Secrets** — onglet de portée, **Ajouter un secret**.
2. **Clés API** — **Créer une clé API**, expiration optionnelle.
3. Copie la bannière tout de suite.
4. **Révoquer** les inutilisées.

Les clés de [Fournisseurs](/docs/fr/ai/providers/) et [Canaux](/docs/fr/communication/channels/) atterrissent ici. Celles de sauvegarde peuvent être une valeur *ou* un nom d’env (`BACKUP_S3_ACCESS_KEY`). Graine TOTP 2FA ici aussi (ex. `github-totp`, portée **System**) ou Trousseau macOS (`-s <nom>` / `eyas-totp-<nom>`). `browser_totp` ne renvoie que le code à 6 chiffres ; le passer à `browser_fill`. La graine n’entre pas dans le cache d’actions. [Browser Use](/docs/fr/automation/browser-use/).

## Voir aussi

- [Setup — mot de passe maître](/docs/fr/setup-wizard/)
- [Fournisseurs](/docs/fr/ai/providers/)
- [Sauvegarde](/docs/fr/admin/backup/)
- [Canaux](/docs/fr/communication/channels/)
- [Browser Use](/docs/fr/automation/browser-use/) (`browser_totp`)
