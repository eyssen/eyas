---
title: Wiki du projet
description: Wiki par projet — pages ticket et décision d’un projet, pas l’arbre global Connaissances.
---

**À quoi ça sert.** Le wiki du projet est un arbre de pages **par projet** : tickets clos, décisions de team session, playbooks et faits de livraison qui ne doivent pas fuiter dans le wiki global Connaissances ni dans la Mémoire. Chaque wiki est clé par id projet. L’UI est petite : recherche, arbre, vue/édition markdown.

## Quand l’utiliser

- La page concerne **un projet** (un ticket clos, une décision, des notes d’environnement).
- Vous ne voulez pas ce texte dans l’arbre global **Connaissances** ni dans une note vault `user` que chaque prompt voit.
- Un arbre cherchable avec tags, fil d’Ariane et marque **Auto-generated**.
- Choix : wiki global → Connaissances ; identité durable → Mémoire ; fichiers → Documents ; ce projet seulement → ici.

## Déroulement typique

1. Ouvrez le wiki depuis la carte du projet (route `/projects/:projectId/wiki` — **pas** d’item global dans la barre ; ce n’est pas **Connaissances**).
2. Utilisez **Search this wiki…** ou l’arbre gauche. Les pages auto-générées ont un préfixe robot et un badge **Généré automatiquement**.
3. **Edit**, changez le markdown, **Save** (ou **Cancel**). Enregistrer prend la page : les auto-updates suivants ne l’écrasent pas. Vide : *Aucune page pour le moment.* / *Sélectionnez une page pour l'afficher.*
4. Vous devez voir le fil d’Ariane, un résumé et des tags optionnels, et le markdown enregistré. Connaissances global et Mémoire restent inchangés.

Fermer une carte du board écrit `ticket-<id>`. Findings/décisions d’une team session écrivent `decision-<id>` dans le wiki du projet (pas dans le vault). Le projet catch-all de seed ne reçoit pas de pages.

## Fonctions

L’UI actuelle est un stub : le corps est du markdown en bloc à chasse fixe (vue) ou un textarea (édition). Le HTML serveur existe (`?render=html`) mais n’est pas la vue par défaut.

## Voir aussi

- [Base de connaissances](/docs/fr/knowledge/knowledge-base/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [Projets](/docs/fr/daily/projects/)
