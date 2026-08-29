---
title: Tunnel d’ingress
description: Atteindre cette EYAS hors du LAN via un tunnel Cloudflare — sans ports entrants.
---

**À quoi ça sert.** Ingress démarre un **tunnel Cloudflare** (`cloudflared`) pour que le téléphone, un second bureau ou un fournisseur de webhooks atteignent cette instance sans ouvrir de ports. C’est un accès distant *à cette boîte*, pas un [nœud distant](/docs/fr/admin/nodes/) ni une [Main](/docs/fr/admin/hands/).

**Route :** `/ingress`. Barre : **Ingress**.

## Quand l'utiliser

- `https://eyas.example.com` sans port-forward.
- Les webhooks Telegram/WhatsApp/Teams ont besoin d’un HTTPS public.
- Tu voyages et tu veux l’UI, Cloudflare devant.

## Déroulement typique

1. Installe [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) sur le `PATH`.
2. Crée un tunnel dans Zero Trust.
3. Copie seulement le jeton `eyJ…` après `--token`.
4. Pointe vers `http://127.0.0.1:3100` (**3100**, pas 3000).
5. **Jeton du tunnel** + **Hostname**, **Enregistrer les réglages**, **Démarrer**.

**Démarrer** réutilise le jeton enregistré si le champ est vide.

## Voir aussi

- [Paramètres](/docs/fr/admin/settings/)
- [Secrets](/docs/fr/admin/secrets/)
- [Observabilité](/docs/fr/admin/observability/)
- [Sécurité](/docs/fr/admin/security-privacy/)
- [Canaux](/docs/fr/communication/channels/)
- [Nœuds](/docs/fr/admin/nodes/)
