---
title: Observabilité et opérations
description: Métriques, opérations, Hands, nœuds, Ingress, extensions.
---

| Domaine | Chemin | Signification |
|---------|--------|---------------|
| Observabilité | `/observability` | Interface de métriques / traces |
| Opérations | `/ops` | Surfaces d'agent d'exploitation / de remédiation |
| Hands | `/hands` | Paramètres du hub Hands distant / computer-use |
| Nœuds | `/nodes` | Nœuds distants — y compris **SSH invoke** avec garde-fou contre les commandes destructrices |
| [Ingress](/docs/fr/admin/ingress/) | `/ingress` | Tunnel / accès distant |
| Extensions | `/extensions` | Catalogue d'extensions |
| Notifications | `/notifications-settings` | Canaux de notification |

### Nœuds — SSH invoke

Lorsqu'un nœud est capable de SSH, EYAS peut exécuter des commandes distantes via un exécuteur protégé. Les motifs de commandes destructrices sont bloqués sauf forçage explicite. Les types de nœuds non SSH peuvent ne pas encore prendre en charge invoke.

### Onglet God Mode

`/observability` a deux onglets : **Usage** (traces / stats existantes) et **God Mode**. L’onglet God Mode liste les exécutions d’ensemble (conversation, gagnant, nombre de modèles, coût, durée, départage), le taux de victoire par modèle et le multiple de coût moyen par rapport à un seul modèle. Un clic ouvre l’onglet God de la conversation (journal des étapes, qui a voté pour qui, revue croisée).

Liste, règles de décision et onglet God : [Conversations — Mode Dieu](/docs/fr/daily/conversations/#mode-dieu).

## Voir aussi

- [Mission Control](/docs/fr/agents/runs/)
- [Instances multiples](/docs/fr/deploy/multi-instance/)
- [Sécurité](/docs/fr/admin/security-privacy/)
