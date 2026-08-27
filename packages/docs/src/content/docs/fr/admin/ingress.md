---
title: Tunnel Ingress
description: Exposer EYAS à distance via un tunnel Cloudflare.
---

**Chemin :** `/ingress`.

Ingress démarre un **Cloudflare Tunnel** (`cloudflared`) afin que vous puissiez atteindre cette instance EYAS hors du réseau local, sans ouvrir de ports entrants.

| Contrôle | Signification |
|----------|---------------|
| **Statut** | Connecté ou déconnecté ; URL publique lorsque le tunnel est actif |
| **Démarrer / Arrêter** | Lancer ou terminer `cloudflared` |
| **Jeton du tunnel** | Jeton du tunnel Cloudflare Zero Trust — **Enregistrer les paramètres** le stocke dans le coffre |
| **Nom d'hôte** | Nom public que vous avez associé au tunnel dans Cloudflare (par ex. `eyas.example.com`) |
| **Enregistrer les paramètres** | Conserve le nom d'hôte et le jeton. Le démarrage réutilise le jeton enregistré si le champ est vide |

## Prérequis

1. Installez [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) et conservez-le dans le `PATH`.
2. Créez un tunnel : [Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create** → Cloudflared.
3. Ouvrez le tunnel → **Configure / Install connector** et copiez uniquement le jeton `eyJ…` après `--token` (pas le nom du tunnel ni l'UUID).
4. Pointez le tunnel vers cette instance (en général `http://127.0.0.1:3100`).

Le jeton est un secret — préférez le coffre des secrets ou une variable d'environnement plutôt que de le coller dans l'historique du shell.

## Voir aussi

- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
- [Secrets](/docs/fr/admin/secrets/)
- [Observabilité et opérations](/docs/fr/admin/observability/)
- [Sécurité](/docs/fr/admin/security-privacy/)
