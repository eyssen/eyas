---
title: Accueil
description: Grille de widgets personnelle, glisser-déposer — pouls, attention, agents en cours, planification et plus.
---

**Route :** `/` (nav : **Accueil**).

Accueil a remplacé l'ancien tableau de bord fixe par une grille de tuiles que vous pouvez
réorganiser, redimensionner, compléter et réduire. Tout le monde démarre avec la même
**disposition d'usine** ; rien n'est personnalisé tant que vous ne changez rien.

## Les neuf tuiles d'usine

| Tuile | Affiche |
|-------|---------|
| **Pouls** | Vous attend, en cours, en attente, coût aujourd'hui, tâches échouées — chaque chiffre renvoie à sa liste |
| **Nécessite votre attention** | Approbations, reprises bloquées, agents en attente, éléments en retard et à échéance aujourd'hui, alertes proactives — approuver, rejeter, réessayer ou ouvrir directement depuis la tuile |
| **Agents en cours** | Activité des agents en direct — mettre en pause, reprendre ou arrêter |
| **Planification** | Tâches planifiées à venir, dont une dont **la dernière exécution a échoué** |
| **Conversations récentes** | Vos conversations les plus récentes |
| **Tableau** | Un tableau que vous choisissez (réglage de la tuile) — ouvrir une carte directement depuis la tuile |
| **Résumé** | Votre résumé matinal, une fois les réflexions de mémoire activées |
| **Coût** | Dépenses de la période en cours par rapport à vos budgets configurés |
| **Système** | Anomalies, échecs des dernières 24h, tâches en retard et en file morte, tâches non exécutables |

Si le module d'une tuile a un problème — une requête échouée, une dépendance désactivée — seule
cette tuile affiche **Indisponible**. Le reste de la page continue de fonctionner.

## Configuration recommandée

Un bandeau fixe au-dessus de la grille, pas une tuile : il vous guide à travers l'essentiel
(fournisseurs, projets, prompts, agents, un canal de communication, sources de recherche,
mémoire, sauvegardes, accès distant, autonomie) et disparaît une fois qu'il n'y a plus rien à
faire. Vous pouvez masquer une recommandation ou toutes ; il ne fait jamais partie de la grille,
vous ne pouvez donc pas le supprimer accidentellement en personnalisant votre disposition.

## Modifier la grille

Cliquez sur **Modifier la page d'accueil** dans l'en-tête. En mode édition :

- **Déplacer une tuile** — faites-la glisser par la poignée de son en-tête.
- **Redimensionner une tuile** — faites glisser la poignée de son coin.
- **Supprimer une tuile** — cliquez sur le **×** de son en-tête.
- **Ajouter une tuile** — un panneau s'ouvre à droite listant tous les widgets connus du système,
  y compris ceux de modules désactivés (affichés estompés, pour que vous voyiez ce qui pourrait
  s'y trouver). Cliquez sur une entrée disponible pour l'ajouter ; elle atterrit en bas de votre
  disposition, prête à être glissée à sa place.

Cliquez sur **Terminé** pour quitter le mode édition. Les modifications s'enregistrent
automatiquement peu après que vous arrêtez de glisser — il n'y a pas de bouton d'enregistrement
séparé.

**Restaurer la disposition par défaut** (visible uniquement en mode édition) abandonne votre
personnalisation pour le point de rupture actuellement affiché et revient aux neuf tuiles
d'usine. Cela n'affecte que la disposition que vous consultez en ce moment — vos dispositions pour
mobile et tablette (si vous les avez organisées séparément) restent intactes.

## Les nouveaux widgets sont proposés, jamais insérés

Une fois votre disposition personnalisée, une future version qui ajoute une nouvelle tuile
d'usine ne l'insérera **pas** silencieusement dans votre grille. Un bandeau apparaît plutôt
au-dessus de la grille : *"Nouveaux widgets disponibles"* — **Ajouter** ou **Non merci**.
**Ajouter** ajoute les nouvelles tuiles sous celles que vous avez déjà ; **Non merci** rejette
définitivement la proposition. Une disposition que vous avez délibérément organisée ne se
réarrange jamais dans votre dos.

Si vous n'avez jamais personnalisé votre disposition, cela ne vous concerne pas — vous êtes
toujours sur la disposition d'usine actuelle, nouvelles tuiles comprises, automatiquement.

## Configurer la tuile Tableau

La tuile Tableau a besoin d'un projet avant de pouvoir afficher quoi que ce soit. Configurez-la
directement depuis la tuile ; vous pouvez placer la tuile Tableau plusieurs fois, chacune avec un
projet différent.

## Voir aussi

- [Conversations](/docs/fr/daily/conversations/)
- [Tableau](/docs/fr/daily/board/)
- [Autonomie](/docs/fr/agents/autonomy/)
- [Assistant de configuration](/docs/fr/setup-wizard/)
