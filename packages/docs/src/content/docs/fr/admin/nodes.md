---
title: Nœuds distants
description: D'autres machines qu'EYAS peut joindre (SSH, WebSocket, Tailscale) pour que les agents ne travaillent pas seulement sur cette boîte.
---

**À quoi ça sert.** Nœuds distants est l'inventaire des autres machines que cette instance EYAS peut joindre. Vous enregistrez un nom, un hôte et un type de connexion pour que les agents exécutent du travail hors de cette boîte — en général en SSH. La santé est **online**, **offline** ou **unknown**. Cette page est le registre ; ce n'est pas de la télémétrie Observabilité ni une Main (appariement bureau/CLI).

## Quand l'utiliser

- Vous voulez qu'un agent exécute une commande sur un autre hôte, pas seulement sur cette instance.
- Vous ajoutez une machine joignable en **SSH**, **WebSocket** ou **Tailscale**.
- Vous devez voir quand un nœud a été vu pour la dernière fois, ou le renommer / retargeter / retirer.
- Vous avez besoin d'un invoke SSH gardé (motifs destructeurs bloqués sauf forçage) — c'est une API sur les nœuds SSH, pas un bouton sur cette page.

## Déroulement typique

1. Ouvrez dans la barre latérale **Paramètres** → groupe **Infrastructure** → **Nœuds** (`/nodes`).
2. **Ajouter un nœud**.
3. **Nom** (espace réservé `my-node`), **Hôte** (espace réservé `192.168.1.100:3100`) et **Type** (**SSH**, **WebSocket** ou **Tailscale**).
4. **Enregistrer**. La carte apparaît avec un point d'état et le badge de type.
5. Le crayon édite nom, hôte et type. La corbeille retire le nœud.

Vide : *Aucun nœud distant configuré*. Après enregistrement, l'hôte en monospace et, si connu, **Dernière activité**.

## Fonctions

Chaque carte montre **Nom**, un point d'état, un badge **Type**, **Hôte**, et **Dernière activité** lorsqu'un horodatage existe.

Couleurs : **online** (vert), **offline** (rouge), **unknown** (ambre). Les nouveaux nœuds démarrent **offline** jusqu'à ce que quelque chose les marque vus.

**Type** dans le dialogue : **SSH**, **WebSocket** ou **Tailscale**. Le dialogue ne collecte pas une liste de capacités ; l'enregistrement peut quand même stocker des capacités pour les agents.

Les nœuds SSH peuvent être invoqués via un exécuteur gardé (`POST` invoke). Les motifs `rm -f` / `rm -r`, `mkfs`, `dd if=` et bombes fork sont refusés sauf si `forceDestructive` est vrai. Les types non SSH renvoient « non implémenté » pour invoke. Les identifiants (utilisateur, mot de passe ou clé privée) viennent du corps de l'invoke ou de la config stockée — jamais journalisés.

WebSocket et Tailscale sont inventaire + santé sur cette page ; ils n'y gagnent pas un bouton invoke.

## Champs et commandes

<h2 id="add-node">Ajouter / modifier un nœud</h2>

| Commande | Signification |
|----------|---------------|
| **Ajouter un nœud** | Ouvrir le dialogue de création |
| Compteur de nœuds | Badge d'en-tête s'il en existe au moins un |
| **Nom** | Libellé humain. Espace réservé `my-node` |
| **Hôte** | Adresse. Espace réservé `192.168.1.100:3100` |
| **Type** | **SSH**, **WebSocket** ou **Tailscale** |
| **Enregistrer** / **Enregistrement…** | Persister (désactivé tant que nom ou hôte est vide) |
| Crayon | **Modifier le nœud** — mêmes champs |
| Corbeille | Supprimer le nœud |

<h2 id="health">Santé</h2>

| Commande | Signification |
|----------|---------------|
| Point d'état | **online** / **offline** / **unknown** |
| Badge de type | Type de connexion sur la carte |
| **Dernière activité** | Horodatage auquel le registre a marqué le nœud vu |

## Voir aussi

- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
- [Mains](/docs/fr/admin/hands/)
- [Notifications](/docs/fr/admin/notifications/)
- [Extensions](/docs/fr/admin/extensions/)
- [Ingress](/docs/fr/admin/ingress/)
- [Observabilité et opérations](/docs/fr/admin/observability/)
- [Secrets](/docs/fr/admin/secrets/)
