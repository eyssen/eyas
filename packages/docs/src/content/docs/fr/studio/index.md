---
title: Studio
description: Moteurs locaux qui transforment du HTML écrit en vidéo. Ce n’est pas Media.
---

**À quoi ça sert.** Studio fait tourner des **moteurs de production locaux** : l’agent écrit du HTML, cette machine rend un fichier. Premier moteur : Hyperframes. [Media](/docs/fr/ai/media/) est l’autre voie : prompt→pixels. Ne pas mélanger.

**Route :** `/studio`. Barre : **Contenu → Studio**.

## Quand

- Motion graphic, titre ou explainer en HTML, MP4 déterministe.
- Pas une vidéo générative depuis un prompt — c’est Media.

## Déroulement

1. Ouvrir **Studio** (`/studio`).
2. Carte Hyperframes : Node.js 22+, FFmpeg, CLI.
3. Dans le chat : `hyperframes_status` → create → write → lint → render.
4. Le MP4 arrive dans Documents et sur ce tour.

Voir [Hyperframes](/docs/fr/studio/hyperframes/) et [Video Use](/docs/fr/studio/videouse/).

## Voir aussi

- [Hyperframes](/docs/fr/studio/hyperframes/)
- [Video Use](/docs/fr/studio/videouse/)
- [Media](/docs/fr/ai/media/)
- [Extensions](/docs/fr/admin/extensions/#recordly) — Recordly (enregistreur AGPL) est un compagnon tiers, pas un moteur Studio
