---
title: Mains
description: Appariez une « main » locale pour qu'EYAS utilise des CLI et l'automatisation de bureau sur une machine que vous contrôlez.
---

**À quoi ça sert.** Mains est le hub d'appariement des clients EYAS Hand — des machines que vous contrôlez et qui exposent des outils CLI, l'automatisation du SE et/ou l'utilisation de l'ordinateur à ce serveur. Un code d'appariement de courte durée lie l'appareil ; les Hands connectées rapportent plateforme, architecture, OS, capacités et combien d'outils CLI/app elles ont découverts. Ce n'est pas un nœud SSH distant ni de l'Observabilité.

## Quand l'utiliser

- Vous voulez que l'agent exécute un CLI ou une action de bureau sur *votre* Mac, Windows ou Linux, pas seulement dans le processus serveur.
- Vous appariez un nouveau client Hand et avez besoin d'un code qui expire dans cinq minutes.
- Vous devez voir si une Hand est connectée, ce qu'elle peut faire (**CLI**, **Automatisation du SE**, **Utilisation de l'ordinateur**) et combien d'outils elle a trouvés.
- Vous voulez déconnecter un appareil auquel vous ne faites plus confiance.

## Déroulement typique

1. Ouvrez dans la barre latérale **Paramètres** → groupe **Infrastructure** → **Mains** (`/hands`).
2. **Générer un code d'appariement**. Un grand **Code d'appariement** apparaît ; il **expire dans 5 minutes — saisissez ce code sur votre appareil Hand**.
3. Saisissez le code sur le client Hand. Le code disparaît de cette page à l'expiration.
4. **Actualiser** si la nouvelle carte n'est pas encore visible.
5. Vérifiez plateforme · arch · OS, badges de capacité et nombre d'outils, puis gardez la Hand ou **Déconnecter**.

Vide : *Aucune Hand connectée* / *Générez un code d'appariement et connectez un client EYAS Hand*. Après appariement, point vert et identifiant court.

## Fonctions

Les codes durent **300 secondes** (cinq minutes) puis disparaissent. Un échec de génération affiche une bannière d'erreur.

Chaque Hand connectée montre : nom, identifiant court, `platform · arch · osVersion`, **N outils**, version de protocole, **Vu pour la dernière fois** relatif, badges de capacité. Icônes de plateforme : Darwin, Windows, Linux (générique sinon).

Capacités rapportées par le client :

| Badge | Signification |
|-------|---------------|
| **CLI** | Outils en ligne de commande sur cette machine |
| **Automatisation du SE** | Automatisation au niveau du SE |
| **Utilisation de l'ordinateur** | Bureau / computer-use |

Les outils découverts sont **cli** ou **app** (id, nom, chemin, version optionnelle). Cette page montre le **compte**, pas une liste par outil.

**Déconnecter** désinscrit la Hand (et démonte un transport MCP si c'est ainsi qu'elle était connectée). **Actualiser** recharge la liste.

## Champs et commandes

<h2 id="pairing">Code d'appariement</h2>

| Commande | Signification |
|----------|---------------|
| **Générer un code d'appariement** / **Génération…** | Émettre un code pour l'utilisateur courant |
| **Code d'appariement** | Grand code monospace à saisir sur le Hand |
| Expire dans *n* minutes | Texte de TTL ; la carte disparaît à l'échéance |
| **Actualiser** | Recharger les Hands connectées |

<h2 id="connected-hands">Hands connectées</h2>

| Commande | Signification |
|----------|---------------|
| Nom + identifiant court | Libellé et les huit premiers caractères de `handId` |
| platform · arch · osVersion | Identité de la machine |
| **N outils** | Combien d'outils CLI/app la Hand a rapportés |
| Protocole v*n* | Version du protocole Hand |
| **Vu pour la dernière fois** | Temps relatif (*à l'instant*, *il y a N min*, *il y a N h*, *il y a N j*) |
| **CLI** / **Automatisation du SE** / **Utilisation de l'ordinateur** | Badges de capacité |
| Point connecté | Vert tant qu'elle est listée |
| **Déconnecter** / **Déconnexion…** | Désinscrire cette Hand |

## Voir aussi

- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
- [Nœuds distants](/docs/fr/admin/nodes/)
- [Notifications](/docs/fr/admin/notifications/)
- [Extensions](/docs/fr/admin/extensions/)
- [Outils](/docs/fr/automation/tools/)
- [Serveurs MCP](/docs/fr/ai/mcp/)
