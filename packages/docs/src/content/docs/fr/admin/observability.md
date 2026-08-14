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

## Voir aussi

- [Mission Control](/docs/fr/agents/runs/)
- [Instances multiples](/docs/fr/deploy/multi-instance/)
- [Sécurité](/docs/fr/admin/security-privacy/)
