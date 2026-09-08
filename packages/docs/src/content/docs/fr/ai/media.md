---
title: Médias
description: Connectez Magnific, Higgsfield ou fal. Les agents génèrent avec cinq outils partagés. Comparez les backends et choisissez-en un — ou plusieurs.
---

**À quoi ça sert.** Médias, c’est la façon dont EYAS génère, agrandit et attend images, vidéo, audio, retouches et 3D. Vous choisissez les backends ; l’agent utilise **un seul jeu d’outils**. Aucun des trois vendeurs n’est le défaut. Zéro connecté = vide, fail-closed — jamais de pixels fictifs.

**Route :** `/media`. Barre : **Médias** (après Fournisseurs). Titre : **Médias**.

## Quand l’utiliser

- Vous voulez que l’agent génère ou agrandisse une image, fasse une vidéo, ou attende un job long.
- Vous avez un compte Magnific, Higgsfield ou fal et **ne** voulez **pas** cinquante outils vendeur sur le modèle.
- Les crédits coûtent de l’argent : plafonds journaliers/mensuels ou défaut par type.
- Les fichiers terminés doivent aller dans [Documents](/docs/fr/knowledge/documents/) et sur le tour de chat qui les a produits.

## Déroulement typique

1. Ouvrez **Médias** (`/media`).
2. Lisez **Quel backend ?** sur la page, puis **Connecter** un (ou plusieurs). Magnific et Higgsfield : OAuth dans le navigateur ; fal : clé API.
3. Le statut doit indiquer **Connecté**. Réglez le **Routage** et, au besoin, le **Budget**.
4. Demandez dans une conversation. L’agent doit appeler `media_catalog`, puis `media_generate`, puis `media_wait`.
5. Quand le job est terminé, EYAS copie le fichier dans Documents et l’attache à ce tour. Les URL CDN expirent — fiez-vous au document stocké.

## Quel backend ? {#compare}

Les tableaux marketing parlent de « public cible » et de « web vs API ». Dans EYAS, les questions utiles sont : **où il est le plus fort, comment on s’identifie, comment vont les crédits, et qu’advient-il du fichier.**

| Critère | Magnific | Higgsfield | fal |
|---------|----------|------------|-----|
| **Point fort** | Stills photoréalistes, upscale **Creative** guidé par prompt, upscale fidèle **Precision** | Vidéo cinématique, consistance de personnage (Soul) | Catalogue énorme, vérification du prix avant l’exécution |
| **Types dans EYAS** | Agrandissement, image, édition (aussi vidéo / audio / 3D) | Vidéo, image (aussi audio) | Image, vidéo, audio, 3D, agrandissement |
| **Connexion** | OAuth (compte Magnific) | OAuth (compte Higgsfield) | Clé API Bearer (`fal-api-key`) |
| **Crédits** | Le même solde que le site Magnific. L’**Unlimited web ne s’applique pas** à MCP/API | MCP **débite toujours** des crédits, même si le plan web est illimité | MCP lui-même est gratuit ; vous payez l’exécution du modèle |
| **Résultat** | URL CDN — EYAS copie les octets | Les URL expirent en environ **sept jours** — l’ingest est obligatoire | URL CDN — copiée quand même |
| **Le brancher d’abord si…** | Vous agrandissez, retouchez ou voulez des stills | Vous voulez des clips ou un personnage figé | Vous voulez beaucoup de modèles ou le prix d’abord |

**Recommandation**

1. **Branchez un backend pour le travail que vous avez vraiment.** Stills et agrandissement → Magnific. Vidéo / personnage → Higgsfield. Large catalogue ou « ça coûte combien ? » → fal.
2. **Ajoutez un second quand le type change**, pas « au cas où ». **Par défaut / secours** couvre une panne ; **Exécuter aussi sur** envoie *le même* prompt ailleurs et **double les crédits**. Laissez vide sauf comparaison demandée.
3. **Ne pas activer les outils MCP bruts** sauf pour déboguer. Cela déverse la liste vendeur sur l’agent et saute l’ingest.

Images et prompts **quittent cette machine** vers le vendeur connecté. Traitez-le comme n’importe quel SaaS.

## Cinq outils

| Outil | Rôle | Risque |
|-------|------|--------|
| `media_generate` | Démarrer un job (`image`, `video`, `audio`, `upscale`, `edit`, `3d`) | jaune |
| `media_wait` | Attendre la fin (180s par défaut, max 600s) | jaune |
| `media_catalog` | Modèles d’un type — avant d’inventer des ids | vert |
| `media_balance` | Crédits restants | vert |
| `media_history` | Jobs locaux récents | vert |

Zéro fournisseur, ou un pin vers un non connecté : erreur structurée vers `/media`.

## Réglages sur `/media`

**Routage.** Une ligne par type. **Par défaut** si l’agent ne nomme pas de fournisseur. **Secours** si le défaut n’est pas connecté. **Exécuter aussi sur** uniquement pour un fan-out.

Défauts suggérés (seulement si ce fournisseur est connecté et que la ligne n’est pas épinglée) : agrandissement / image / édition → Magnific ; vidéo → Higgsfield ; audio / 3D → fal.

**Budget.** Plafonds quotidiens et mensuels optionnels **par fournisseur**. Un plafond qui serait dépassé échoue **avant** l’appel vendeur. Les montants inconnus ne bloquent pas.

**Exposer les outils MCP bruts.** Désactivé par défaut. Laissez-le ainsi.

## Crédits et ingest

Les jobs terminés avec URL sont téléchargés (jusqu’à 200 Mo, **sans recompression JPEG**) dans Documents, liés à la conversation comme IA, et fusionnés aux pièces jointes du tour. Préférez `documentIds` aux URL vendeur.

Pour agrandir, envoyez le **fichier original** (`documentId` ou URL). Pas un JPEG de capture du canvas.

## Dépannage

| Symptôme | À essayer |
|----------|-----------|
| Reste **Non connecté** après OAuth | Terminez la connexion dans le navigateur, revenez à `/media`. **Tester**. |
| L’agent dit qu’il n’y a pas de fournisseur pour ce type | Connectez un backend qui liste le type, ou fixez le défaut. |
| Job fini mais pas d’image dans le chat | Voir **Tâches récentes** et [Documents](/docs/fr/knowledge/documents/). L’URL a pu expirer. |
| Les crédits fondent trop vite | **Exécuter aussi sur** est coché, ou deux fournisseurs sont épinglés. Vérifiez le Budget. |
| La redirection arrive sur Serveurs MCP | Ouvrez `/media` et **testez** la carte. Connectez depuis Médias, pas seulement depuis le catalogue MCP. |

## Voir aussi

- [Serveurs MCP](/docs/fr/ai/mcp/) — les lignes gérées par Médias indiquent *Géré par Paramètres → Médias*
- [Outils](/docs/fr/automation/tools/)
- [Documents](/docs/fr/knowledge/documents/)
- [Connexions](/docs/fr/admin/connections/)
- [Fournisseurs](/docs/fr/ai/providers/) — modèles de langue, pas des backends d’image
