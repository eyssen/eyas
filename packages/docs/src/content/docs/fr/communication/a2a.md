---
title: A2A et agents externes
description: Protocole agent-à-agent, carte d’agent et exécution de tâches.
---

EYAS peut exposer une **carte d’agent** à `/.well-known/agent-card.json` pour la découverte compatible A2A.

| Concept | Signification |
|---------|---------------|
| Carte d’agent | Description lisible par machine des capacités / points de terminaison |
| Frontière de confiance | N’activez A2A que lorsque l’exposition réseau est volontaire |
| Découverte | Les pairs récupèrent l’URL well-known |
| Exécution de tâche | Un `tasks/send` entrant est relié au véritable exécuteur d’agent (`executeAgent`) — crée une conversation, puis lance l’agent assigné |
| Boîte aux lettres | list/get du service de communication pour les surfaces de boîte aux lettres de tâches A2A |

Configurez l’exposition avec soin derrière authentification / ingress. Lorsque les agents sont correctement mis en place, une exécution en échec ou non configurée n’est plus signalée instantanément comme indisponible.

## Voir aussi

- [Ingress](/docs/fr/admin/ingress/)
- [Canaux](/docs/fr/communication/channels/)
- [Vue d’ensemble des agents](/docs/fr/agents/overview/)
