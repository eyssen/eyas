---
title: Sauvegarde et restauration
description: Archive de restauration complète en local, puis envoi optionnel (S3/B2, FTP, Dropbox, SSH).
---

**À quoi ça sert.** La sauvegarde construit un **paquet de restauration complet** pour une machine vide : `data/` (DB, `master.key`, agents, vault…), `config/`, `.env`, `version.json` — pas `backups/`, tmp, logs runtime. Restaure sur la **même version produit**. D’abord local ; la destination **primaire** envoie ensuite.

**Route :** `/backup`. Barre : **Sauvegarde**.

## Quand l'utiliser

- Un tarball pour une install vide de la **même** version.
- Offsite : S3 compatible (AWS, Backblaze B2, R2, MinIO), FTP/FTPS, Dropbox, SSH/SFTP.
- L’auto-update exige une Sauvegarde qui marche.

## Déroulement typique

1. **Sauvegarde**.
2. Optionnel **Ajouter une destination**, type, réglages, secrets (clé *ou* nom d’env), **Utiliser pour les envois**.
3. **Créer une sauvegarde**. Ligne : nom, version, taille, **Envoyé** / **Local seulement**.
4. Restaurer : installe la version du tableau, arrête le serveur, `tar -xzf`, `chmod 600 data/master.key .env`, `eyas start`.

**Les connexions CLI sont dans l’archive.** Les connexions de Grok CLI et Kimi Code CLI pour EYAS vivent dans `data/cli-homes/grok-cli/.grok/auth.json` et `data/cli-homes/kimi-cli/.kimi/credentials/kimi-code.json` : une sauvegarde du répertoire de données les contient. Traite l’archive comme un identifiant, au même titre que `master.key`. Voir [Fournisseurs — Connecter Grok et Kimi pour EYAS](/docs/fr/ai/providers/#sign-in-grok-and-kimi-for-eyas).

## Ce que l’archive laisse de côté

| Absent de l’archive | Pourquoi / quoi faire |
|---------------------|-----------------------|
| `backups/`, tmp, pid et logs runtime | Inutiles pour reconstruire |
| Stockages de sessions CLI sous `data/cli-homes/*/sessions` | Transcriptions CLI jetables qu’EYAS ne reprend jamais (EYAS les supprime aussi après chaque tour) |
| Espaces de travail de conversation hors du répertoire de données | Sur une install depuis les sources lancée depuis un clone git, ou avec `EYAS_WORKSPACES_DIR`, les espaces de travail vivent hors de `data/` (voir [Configuration — Espaces de travail des conversations](/docs/fr/deploy/configuration/#conversation-workspaces)). Les fichiers produits par les agents restent conservés : ils sont copiés dans Documents comme pièces jointes de la conversation, qui sont sauvegardées. |
| Un répertoire de données déplacé avec `EYAS_DATA_DIR` | L’archive couvre `<home EYAS>/data`. Si `EYAS_DATA_DIR` pointe ailleurs, inclus ce dossier — il contient la base et le coffre de mémoire — dans tes propres sauvegardes. |

## Voir aussi

- [Premiers pas](/docs/fr/getting-started/)
- [Mise à jour système](/docs/fr/admin/settings/)
- [Secrets](/docs/fr/admin/secrets/)
- [Import de données](/docs/fr/admin/data-port/)
