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

`/observability` a trois onglets : **Usage** (traces / stats existantes), **God Mode** et **Contexte**. L’onglet God Mode liste les exécutions d’ensemble (conversation, gagnant, nombre de modèles, coût, durée, départage), le taux de victoire par modèle et le multiple de coût moyen par rapport à un seul modèle. Un clic ouvre l’onglet God de la conversation (journal des étapes, qui a voté pour qui, revue croisée).

Liste, règles de décision et onglet God : [Conversations — Mode Dieu](/docs/fr/daily/conversations/#mode-dieu).

### Onglet Contexte

L’onglet **Contexte** répond à une question à laquelle rien, jusqu’ici, ne pouvait répondre : ce que le modèle a *réellement* reçu, et non ce qui était censé être envoyé. Il affiche le coût moyen et maximal en tokens de chaque section du prompt (et sur combien d’échantillons il repose), la fréquence de troncature (à quelle fréquence, et quelle section, est coupée pour tenir dans le budget), et l’estimé vs réel : l’écart entre l’estimation de tokens et ce que le fournisseur a réellement rapporté — une erreur que rien ne permettait de mesurer jusqu’à présent.

Les enregistrements détaillés par section ont une conservation courte (7 jours par défaut) ; seul le résumé quotidien est conservé durablement. Si vous cherchez un ancien détail et ne le trouvez pas, c’est voulu, pas une perte de données.

## Voir aussi

- [Mission Control](/docs/fr/agents/runs/)
- [Instances multiples](/docs/fr/deploy/multi-instance/)
- [Sécurité](/docs/fr/admin/security-privacy/)
