---
title: Notifications
description: Qui est prévenu, sur quel canal, et à quel volume — dans l'app, e-mail, Telegram, webhook.
---

**À quoi ça sert.** Les paramètres de notification décident quels événements vous atteignent, sur quel canal, et à quel volume. Chaque préférence est une ligne motif d'événement × canal. Ainsi les alertes de budget, événements d'agents et similaires arrivent dans la cloche, par e-mail, Telegram ou webhook — sans vous réveiller pour du bruit. La gravité **Critique** contourne toujours les heures calmes et le regroupement.

## Quand l'utiliser

- Vous voulez la cloche in-app pour certains événements et **Telegram** ou **E-mail** pour d'autres.
- Vous ne voulez que **Avertissement** et au-dessus, pas chaque **Info**.
- Vous voulez une fenêtre calme (y compris la nuit), sauf pour **Critique**.
- Vous voulez un résumé plutôt qu'une rafale d'e-mails ou de POST webhook.
- Vous avez besoin d'un webhook HTTPS signé pour l'automatisation (n8n, Zapier, Home Assistant et similaires).

## Déroulement typique

1. Ouvrez dans la barre latérale **Paramètres** → groupe **Modules** → **Notifications** (`/notifications-settings`).
2. Sous **Ajouter une préférence**, saisissez un **Motif d'événement** (par exemple `agent.*`, `budget.warning` ou `*`).
3. Choisissez **Canal**, **Gravité minimale** et **Mode de livraison**.
4. Éventuellement **Silence de** et **Silence jusqu'à**. Les plages de nuit du type 22:00–07:00 fonctionnent.
5. **Ajouter**. La ligne apparaît sous **Préférences actives**.
6. Si le canal est **Webhook**, renseignez le **Point de terminaison webhook** puis **Enregistrer le webhook**.

Vous devez voir la nouvelle ligne avec le motif, le canal, ≥ gravité, et éventuellement les badges **résumé** / silence.

## Fonctions

Une ligne par motif d'événement × canal. Les motifs sont des globs par segment : `*` correspond à tout ; `agent.*` un segment après `agent` ; `budget.warning` uniquement cet événement.

**Canal :** **Web** (in-app / WebSocket), **E-mail**, **Telegram**, **Webhook**. E-mail et Telegram ne livrent que si l'intégration est réellement configurée (SMTP dans les Secrets / bot Telegram apparié). Choisir le canal ici ne crée pas cette intégration.

**Immédiat** envoie maintenant. **Regroupé** met un résumé en file (e-mail et webhook ; fenêtre par défaut cinq minutes). **Web** et **Telegram** sautent le regroupement. **Critique** part toujours tout de suite et ignore les heures calmes.

Les heures calmes utilisent `HH:MM` et traversent minuit.

Un POST webhook est du JSON (`event`, `severity`, `title`, `body`, `data`, `createdAt`, `notificationId`). Un secret partagé optionnel ajoute `X-EYAS-Signature: sha256=…` (HMAC-SHA256). Des en-têtes HTTP supplémentaires peuvent être stockés sur le point de terminaison (API) ; le formulaire a URL, secret et **Activé**. L'indication de la page : uniquement les URL https ; les hôtes loopback et de métadonnées (`169.254.169.254`, `.internal`) sont bloqués.

Les envois en échec vont dans la file de nouvelles tentatives (trois essais, backoff exponentiel à partir de 30 secondes). Ensuite **Échoués (lettre morte)**. **File de nouvelles tentatives** s'affiche lorsque les retries sont activés.

La cloche de l'en-tête liste les notifications et le marquer comme lu. Cette page n'est que les préférences.

## Champs et commandes

<h2 id="preferences">Préférences actives</h2>

| Commande | Signification |
|----------|---------------|
| **Préférences actives** | Lignes existantes. Vide : *Aucune préférence pour le moment. Ajoutez-en une ci-dessous.* |
| Badge de motif | Glob qui a correspondu, p. ex. `agent.*` |
| Badge de canal | **Web** / **E-mail** / **Telegram** / **Webhook** |
| ≥ gravité | Gravité minimale de cette ligne |
| **résumé** | Quand **Mode de livraison** est **Regroupé** |
| silence `de`–`jusqu'à` | Heures calmes de cette ligne |
| Corbeille | Supprimer cette ligne motif × canal |

<h2 id="add-preference">Ajouter une préférence</h2>

| Commande | Signification |
|----------|---------------|
| **Motif d'événement** | Espace réservé : `agent.* ou budget.warning ou *` |
| **Canal** | **Web**, **E-mail**, **Telegram**, **Webhook** |
| **Gravité minimale** | **Info**, **Avertissement**, **Erreur**, **Critique** |
| **Mode de livraison** | **Immédiat** ou **Regroupé** |
| **Silence de** / **Silence jusqu'à** | Champs heure. Les deux sont requis pour enregistrer le silence ; vide = aucun |
| **Ajouter** | Enregistrer la ligne (désactivé si le motif est vide) |

<h2 id="webhook">Point de terminaison webhook</h2>

| Commande | Signification |
|----------|---------------|
| **URL** | Destination. Espace réservé `https://hooks.example.com/eyas` |
| **Secret partagé (facultatif — active les signatures HMAC-SHA256)** | Champ mot de passe. Si un secret existe déjà : *(inchangé — laissez vide pour conserver l'existant)* |
| **Activé** | Décoché, le webhook est stocké mais inutilisé |
| **Enregistrer le webhook** | Persister URL / secret / activé (désactivé sans URL) |
| **Retirer** | Supprimer le webhook stocké (seulement s'il en existe un) |

<h2 id="retry-queue">File de nouvelles tentatives</h2>

| Commande | Signification |
|----------|---------------|
| **En attente** | Retries encore planifiés |
| **Échoués (lettre morte)** | Tentatives épuisées |
| **Actualiser** | Recharger préférences, webhook et stats de retry |

## Voir aussi

- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
- [Extensions](/docs/fr/admin/extensions/)
- [Nœuds distants](/docs/fr/admin/nodes/)
- [Mains](/docs/fr/admin/hands/)
- [Canaux](/docs/fr/communication/channels/)
- [Telegram](/docs/fr/communication/telegram/)
- [Secrets](/docs/fr/admin/secrets/)
