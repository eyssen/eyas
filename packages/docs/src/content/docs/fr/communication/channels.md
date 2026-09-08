---
title: Canaux — aperçu
description: Instances de messagerie externe — types, modes, file d’entrée, appariement. Pas Connexions, pas Mains.
---

**À quoi ça sert.** Les canaux sont la façon dont les gens hors de cette machine écrivent à un agent EYAS : Telegram, Slack, e-mail et le reste du catalogue. Chaque instance a ses secrets et un agent lié. Ce n’est **pas** [Connexions](/docs/fr/admin/connections/) ni [Mains](/docs/fr/admin/hands/). MCP et A2A vivent sur leurs propres pages.

**Route :** `/communication` → **Canaux · File d’entrée · Appariement**.

## Quand l'utiliser

- Parler à l’agent primaire depuis Telegram (ou un autre type du catalogue) sans l’UI web.
- Deux bots du même type — deuxième instance.
- Entrée coincée — file durable, ré-enfiler une ligne **dead**.
- Un DM Telegram attend un code d’appariement.

## Déroulement typique

1. **Communication** → **Canaux**.
2. Ouvre une carte ou **Ajouter une instance**.
3. Secrets, **Agent pour les messages entrants**, **Enregistrer et connecter**.
4. **Autonome** ou **Géré**.
5. DM Telegram : écris au bot, approuve sous **Appariement**.

Catalogue (MCP/A2A **ne sont pas** des canaux de chat) : Telegram (appariement), Discord, Slack (Socket Mode, `xoxb-`+`xapp-`), E-mail SMTP/IMAP, Gmail API, Microsoft 365 Graph, WhatsApp Business (webhook `/api/v1/webhooks/whatsapp`), Signal (pont signal-cli ; EYAS n’embarque pas Signal), Google Chat, Microsoft Teams.

File : pending / delivered / dead / skipped. Appariement : Approuver/Rejeter, survit aux redémarrages.

## Voir aussi

- [Telegram](/docs/fr/communication/telegram/)
- [A2A](/docs/fr/communication/a2a/)
- [Agents — canaux](/docs/fr/agents/configure/)
- [Connexions](/docs/fr/admin/connections/)
- [Mains](/docs/fr/admin/hands/)
- [Ingress](/docs/fr/admin/ingress/)
