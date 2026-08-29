---
title: Wiki client
description: Wiki par client — notes de livraison d’un client, pas l’arbre global Connaissances.
---

**À quoi ça sert.** Le wiki client est un arbre de pages **par client** : playbooks, notes d’environnement et faits de livraison qui ne doivent pas fuiter dans le wiki global Connaissances ni dans la Mémoire. Chaque wiki est clé par id client. L’UI est petite : recherche, arbre, vue/édition markdown.

## Quand l’utiliser

- La page concerne **un client** (URL de staging, qui signe, leurs conventions).
- Vous ne voulez pas ce texte dans l’arbre global **Connaissances** ni dans une note vault `user` que chaque prompt voit.
- Un arbre cherchable avec tags, fil d’Ariane et marque **Auto-generated**.
- Choix : wiki global → Connaissances ; identité durable → Mémoire ; fichiers → Documents ; ce client seulement → ici.

## Déroulement typique

1. Ouvrez le wiki de ce client (API `/api/v1/client-wiki/:clientId/…` — **pas** d’item global dans la barre ; ce n’est pas **Connaissances**).
2. Utilisez **Search this wiki…** ou l’arbre gauche. Les pages auto-générées ont un préfixe robot.
3. **Edit**, changez le markdown, **Save** (ou **Cancel**). Vide : *No pages yet.* / *Select a page to view.*
4. Vous devez voir le fil d’Ariane, un résumé et des tags optionnels, et le markdown enregistré. Connaissances global et Mémoire restent inchangés.

## Fonctions

L’UI actuelle est un stub : le corps est du markdown en bloc à chasse fixe (vue) ou un textarea (édition). Le HTML serveur existe (`?render=html`) mais n’est pas la vue par défaut.

## Voir aussi

- [Base de connaissances](/docs/fr/knowledge/knowledge-base/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [Projets](/docs/fr/daily/projects/)
