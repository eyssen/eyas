---
title: Extensions
description: Installer, activer et examiner des packs de compétences tiers sans quitter les licences compatibles MIT.
---

**À quoi ça sert.** Extensions est le catalogue des packs de compétences et outils qui n'ont pas pu être fournis avec EYAS à cause des licences. EYAS reste MIT. GPL, LGPL, AGPL et SSPL (et copyleft similaire) ne sont pas dans le produit ; vous acceptez ici, pack par pack, après l'avis de licence. Vous ajoutez ainsi des compétences ou outils compagnons sans mélanger des licences interdites dans l'arbre cœur.

## Quand l'utiliser

- Vous voulez un pack de compétences absent du catalogue fourni.
- Vous avez besoin d'un CLI ou service compagnon (conversion de documents, antivirus, SAST) auquel EYAS parle comme processus séparé.
- Vous devez vérifier si un pack est compatible MIT, copyleft ou propriétaire avant d'installer.
- Vous voulez désactiver un pack sans le désinstaller, ou le retirer entièrement.

## Déroulement typique

1. Ouvrez dans la barre latérale **Paramètres** → groupe **Modules** → **Extensions** (`/extensions`).
2. Lisez **Packs à installation automatique** et **Outils tiers compatibles**. Chaque carte montre nom, badge de licence, version, auteur et nombre de compétences.
3. Pour un pack auto, **Installer**. Lisez l'**Avis de licence**, puis **Accepter et installer** (ou **Annuler**).
4. Après installation, le bouton d'alimentation **Activer** / **Désactiver** ; la corbeille désinstalle.
5. Pour un pack tiers, ouvrez **GitHub**, suivez le **Guide de configuration** et installez-le vous-même sous sa licence. EYAS ne le télécharge pas pour vous.

Vous devez voir le badge **Installé** et le compteur d'installés dans l'en-tête.

## Fonctions

Le sous-titre pose la règle : certains outils et packs n'ont pas pu être fournis ; les packs auto sont téléchargés par EYAS avec votre consentement ; les outils tiers doivent être pris à leur source d'origine sous leur licence.

Badges de licence :

| Classe | Signification |
|--------|---------------|
| Compatible MIT | MIT, Apache-2.0, BSD, ISC, Unlicense et similaires — bundlables en principe |
| Copyleft | GPL, LGPL, AGPL, MPL, CC-BY-SA et similaires — non fournis ; l'install est un opt-in. Les copyleft qu'EYAS peut récupérer tournent en **processus séparé**, non liés dans EYAS |
| Propriétaire | EYAS ne les distribue pas ; vous les téléchargez |
| Unknown | La chaîne de licence n'a pas classé |

Les **Packs à installation automatique** arrivent en archive (somme SHA-256 si publiée), extraits sous le répertoire de données, avec la licence acceptée. **Installer** est refusé tant que vous n'acceptez pas l'avis. Les packs manuels ne s'auto-installent pas.

Les packs activés versent leurs fichiers de compétences dans le catalogue [Compétences](/docs/fr/automation/skills/). Le compteur de la carte est le nombre déclaré (zéro pour la plupart des outils compagnons). Désactiver arrête le chargement ; désinstaller efface le répertoire et la ligne en base.

N'installez pas un pack dont vous ne pouvez pas respecter la licence. Qu'EYAS reste MIT n'annule pas les termes du pack.

## Champs et commandes

<h2 id="catalogue">Catalogue</h2>

| Commande | Signification |
|----------|---------------|
| Compteur installé | En-tête : combien de packs sont installés |
| **Packs à installation automatique** | EYAS peut les télécharger après consentement |
| **Outils tiers compatibles** | Vous les prenez à la source d'origine |
| Nom / description / version / **par** auteur | Identité du pack |
| Badge de licence | SPDX, coloré selon la classe |
| **Installé** | Le pack est sur disque |
| Nombre de compétences | Combien le pack déclare |
| Étiquettes | Puces de filtre le cas échéant |

<h2 id="install">Installer, activer, désactiver</h2>

| Commande | Signification |
|----------|---------------|
| **Installer** | Démarrer le consentement d'un pack auto |
| **Avis de licence** | Texte complet à accepter |
| **Accepter et installer** | Licence acceptée et téléchargement |
| **Annuler** | Fermer l'avis sans installer |
| **Installation…** | Téléchargement en cours |
| Alimentation | **Activer** / **Désactiver** un pack auto installé |
| Corbeille | Désinstaller un pack auto installé |
| **GitHub** | Ouvrir la page amont d'un pack manuel |
| **Guide de configuration** / **Masquer les détails** | Déplier ou replier le texte d'install manuelle |

<h2 id="recordly">Recordly (compagnon AGPL)</h2>

Recordly est un enregistreur d’écran bureau (zooms, curseur, webcam). **AGPL-3.0** : EYAS ne le livre pas et ne l’installe pas. La carte est sous **Outils tiers**. Téléchargez-le depuis GitHub, exportez **MP4/GIF** dans Recordly, joignez le fichier dans [Documents](/docs/fr/knowledge/documents/). Pas d’outil agent `recordly_*`. Coupes suivantes sur cette machine : [Video Use](/docs/fr/studio/videouse/). Ce n’est **pas** un moteur [Studio](/docs/fr/studio/).

## Voir aussi

- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
- [Notifications](/docs/fr/admin/notifications/)
- [Nœuds distants](/docs/fr/admin/nodes/)
- [Mains](/docs/fr/admin/hands/)
- [Compétences](/docs/fr/automation/skills/)
- [Outils](/docs/fr/automation/tools/)
- [Studio](/docs/fr/studio/)
- [Documents](/docs/fr/knowledge/documents/)
