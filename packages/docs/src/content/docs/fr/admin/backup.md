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

## Voir aussi

- [Premiers pas](/docs/fr/getting-started/)
- [Mise à jour système](/docs/fr/admin/settings/)
- [Secrets](/docs/fr/admin/secrets/)
- [Import de données](/docs/fr/admin/data-port/)
