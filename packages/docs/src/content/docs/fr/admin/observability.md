---
title: Observabilité et opérations
description: Télémétrie de tokens, traces, coût, courses Mode Dieu et coût de contexte du prompt.
---

**À quoi ça sert.** L'observabilité (`/observability`) est la surface de télémétrie de cette instance : traces, coût, latence, anomalies, courses d'ensemble (Mode Dieu) et ce que le modèle a réellement reçu. **Ops** (`/ops`) est la remédiation. Mains, nœuds distants, extensions et préférences de notification ne sont **pas** sur cette page — ils ont leurs propres chapitres.

| Domaine | Chemin | Signification |
|---------|--------|---------------|
| Observabilité | `/observability` | Interface de métriques / traces — onglets **Usage**, **God Mode**, **Contexte** |
| Opérations | `/ops` | Agent ops Kubernetes — observer → diagnostiquer → proposer → approuver → appliquer. Défaut **proposer seulement**. URL de cluster, kubeconfig et dépôt GitOps sont de la config d’instance. |

Ailleurs (pas cette page) : [Mains](/docs/fr/admin/hands/) (`/hands`), [Nœuds distants](/docs/fr/admin/nodes/) (`/nodes`) — y compris invoke SSH gardé, [Ingress](/docs/fr/admin/ingress/) (`/ingress`), [Extensions](/docs/fr/admin/extensions/) (`/extensions`), [Notifications](/docs/fr/admin/notifications/) (`/notifications-settings`).

### Onglet Usage

**Usage** est la télémétrie de tokens : **Total Traces**, **Total Cost**, **Avg Latency**, **Anomalies**, coût quotidien, répartition des modèles, et le tableau de traces (horodatage, modèle, fournisseur, tokens, coût, latence, outils, qualité).

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
- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
- [Mains](/docs/fr/admin/hands/)
- [Nœuds distants](/docs/fr/admin/nodes/)
- [Extensions](/docs/fr/admin/extensions/)
- [Notifications](/docs/fr/admin/notifications/)
