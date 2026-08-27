---
title: Sauvegarde et restauration
description: Créer des archives et restaurer sur une installation vierge.
---

**Chemin :** `/backup`.

Créez des sauvegardes des données (SQLite, coffre, métadonnées des clés, le tout empaqueté). Restaurez sur une installation vide de la **même version du produit** — voir le README « Backup & empty-system restore ».

| Concept | Signification |
|---------|---------------|
| Sauvegarde locale | Archive sous `data/backups/` |
| Destination distante | Téléversement facultatif compatible S3 (coller les clés ou les noms de variables d'environnement) |
| Version figée | Installez la même version avant de restaurer |

## Voir aussi

- [Premiers pas](/docs/fr/getting-started/)
- [Mise à jour système](/docs/fr/admin/settings/)
