---
title: Documents
description: Téléversez des fichiers, parcourez-les, et laissez les agents récupérer le contenu.
---

**À quoi ça sert.** Documents est la bibliothèque de fichiers : PDF, images, archives et autres blobs que vous (ou une conversation / page de connaissances) joignez. Stockés en local (sync S3 optionnelle), disponibles pour retrieval. Ce n’est ni le wiki Connaissances ni une note Mémoire — c’est le fichier lui-même.

## Quand l’utiliser

- Un PDF, une image ou une archive que l’agent doit pouvoir ouvrir plus tard.
- Voir tous les fichiers au même endroit, filtrés par type, en grille ou liste.
- Télécharger ou supprimer, ou voir où le fichier est utilisé.
- Configurer le stockage local vs sync distant S3.

## Déroulement typique

1. Ouvrez **Documents** dans la barre latérale (**Contenu**) — route `/documents`.
2. Les fichiers arrivent de **Attach file** en conversation, **Attachments** en connaissances, ou de la zone de téléversement.
3. Filtrez **All / Images / PDFs / Archives / Other**, cherchez par nom, passez grille/liste.
4. **Paramètres → Documents** (`/documents-settings`) pour stats ou identifiants S3.

## Fonctions

Vide : *No documents yet.* Grille/liste, **Search files…**, catégories MIME, badges de sync, **Download**, **Delete**. Paramètres : statistiques, stockage local, S3 (**Save credentials**).

Ne pas confondre avec [Sources de recherche](/docs/fr/daily/search/) ni [Mémoire](/docs/fr/knowledge/memory/).

## Voir aussi

- [Sources de recherche](/docs/fr/daily/search/)
- [Conversations — joindre un fichier](/docs/fr/daily/conversations/)
- [Base de connaissances](/docs/fr/knowledge/knowledge-base/)
- [Mémoire](/docs/fr/knowledge/memory/)
