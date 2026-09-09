---
title: Réunions
description: Ingérer des enregistrements (Fireflies et similaires) en transcriptions, résumés et actions.
---

**À quoi ça sert.** Réunions est la surface d’ingest des enregistrements : lister les réunions, tirer transcriptions et résumés d’un fournisseur, garder les actions à côté du reste du travail. L’UI produit est encore **Coming Soon** ; le fournisseur backend (Fireflies) est déjà câblé et fail-closed sans clé API.

## Quand l’utiliser

- Des réunions Fireflies (ou d’un fournisseur futur) listées dans EYAS, pas seulement dans l’app du vendor.
- Une transcription, un résumé ou une liste d’actions à côté des suivis Tableau — une fois l’ingest prêt.
- Vérifier pourquoi la liste est vide : pas de secret `fireflies-api-key`, ou encore la bannière prévue.

## Déroulement typique

1. Ouvrez **Paramètres → Réunions** (barre latérale **Paramètres**, groupe **Infrastructure**) — route `/meetings`.
2. Lisez la bannière **Coming Soon** / **Planned**.
3. Si une clé Fireflies est stockée en secret `fireflies-api-key` (portée system), l’API peut lister ; la page montre alors un tableau. Sans clé le fournisseur reste unconfigured et renvoie une liste vide — il n’invente jamais de transcriptions.
4. Vous devez voir l’état vide (*No meetings recorded yet*) ou des lignes titre, date, durée, participants, statut.

## Fonctions

Sous-titre : *Meeting recordings, transcripts, and action items.* Bannière **Coming Soon**. Colonnes : Title, Date, Duration, Participants, Status. Adaptateur Fireflies vers un hôte GraphQL fixe, fetch SSRF-safe. Sans clé : liste vide ; détail « not configured ». Pas de données fictives.

## Voir aussi

- [Tableau](/docs/fr/daily/board/)
- [Secrets](/docs/fr/admin/secrets/)
- [Mémoire](/docs/fr/knowledge/memory/)
