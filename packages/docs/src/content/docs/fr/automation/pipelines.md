---
title: Pipelines
description: Exécutions ticket-to-code — ingest, clarifier, concevoir, implémenter, revue, PR, deploy.
---

**À quoi ça sert.** Un pipeline est un job orchestré en plusieurs étapes. La surface produit aujourd’hui est **ticket-to-code** : un ticket du Tableau (ou un id manuel) via ingest → PM Clarify → Architect Design → Implement → Review → PR → Deploy, avec une porte humaine. Pas un éditeur de flux générique.

**Route :** `/pipelines`. Barre : **Pipelines**.

## Quand l'utiliser

- Un ticket du Tableau doit devenir du code, par étapes, pas en un seul chat.
- Porte de revue ou de deploy.
- L’exécution a échoué ou a été annulée — **Reprendre**.
- Historique ticket → étape → fin.

## Déroulement typique

1. **Pipelines** (`/pipelines`).
2. **Démarrer une exécution** : source **board** / **manual**, **Ticket id**, **Démarrer**.
3. Page de l’exécution. Les étapes s’allument dans l’ordre.
4. **En attente d’approbation** → **Approuver**. **Annuler** / **Reprendre**.
5. **Actualiser** (pas de polling). Terminé avec **Terminé**.

Sources : **board** interne et **manual**. Étapes : Ingest, PM Clarify, Architect Design, Dev Implement, Review, Open PR, Deploy.

## Voir aussi

- [Exécutions](/docs/fr/agents/runs/)
- [Projets](/docs/fr/daily/projects/)
- [Tableau](/docs/fr/daily/board/)
- [Compétences](/docs/fr/automation/skills/)
