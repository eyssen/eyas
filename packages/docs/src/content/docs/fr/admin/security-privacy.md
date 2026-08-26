---
title: Sécurité et confidentialité
description: Portail de sécurité, audit, confidentialité, événements de sécurité.
---

| Domaine | Chemin / signification |
|---------|------------------------|
| **Portail de sécurité** | Politique d'exécution avant les outils dangereux |
| **Événements de sécurité** | flux d'événements `/security` |
| **Audit** | journal d'actions immuable `/audit` |
| **Confidentialité** | contrôles de rétention / rédaction `/privacy` |

### Protection SSRF du navigateur

Les outils de navigateur bloquent les requêtes vers les hôtes **privés / de métadonnées** (métadonnées cloud, boucle locale, RFC1918, etc.) afin de réduire le risque de falsification de requêtes côté serveur. Préférez `browser_snapshot` pour des arbres d'accessibilité compacts lorsque les agents n'ont besoin que de la structure.

### SSH des nœuds distants

L'**SSH invoke** des nœuds distants (via Nœuds) exécute des commandes protégées ; les motifs de commandes **destructrices** exigent un indicateur de forçage explicite. Les types de nœuds non SSH peuvent renvoyer non implémenté pour invoke.

Combinez avec [Autonomie](/docs/fr/agents/autonomy/) (approbations) et [Secrets](/docs/fr/admin/secrets/).

## Voir aussi

- [Autonomie](/docs/fr/agents/autonomy/)
- [Utilisateurs](/docs/fr/admin/users/)
- [Outils](/docs/fr/automation/tools/)
- [Observabilité et nœuds](/docs/fr/admin/observability/)
