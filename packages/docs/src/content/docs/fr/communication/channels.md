---
title: Canaux — aperçu
description: Instances de messagerie externe — types, modes, file d’entrée, appariement. Pas Connexions, pas Mains.
---

**À quoi ça sert.** Les canaux sont la façon dont les gens hors de cette machine écrivent à un agent EYAS : Telegram, Slack, e-mail et le reste du catalogue. Chaque instance a ses propres secrets et un agent lié. Ce n’est **pas** [Connexions](/docs/fr/admin/connections/) (Odoo, GitHub, inventaire MCP) ni [Mains](/docs/fr/admin/hands/) (un appareil local qui offre des outils système ou CLI). MCP et A2A sont des intégrations d’une autre forme et ont leurs propres pages.

**Route :** `/communication` → onglets **Canaux · File d'entrée · Appariement**. Sous-titre : *Connectez des canaux de messagerie et associez-les à votre agent principal.*

## Quand l'utiliser

- Tu veux parler à ton agent principal depuis Telegram (ou un autre type du catalogue) sans ouvrir l’UI web.
- Tu fais tourner deux bots du même type (travail + personnel) et il te faut une deuxième instance.
- Des messages entrants sont bloqués et tu as besoin de la file durable (réessayer une ligne **mort**).
- Un DM Telegram attend un code d’appariement.

## Déroulement typique

1. Ouvre **Communication** (`/communication`) sur l’onglet **Canaux**.
2. Déplie une carte du catalogue, ou **Ajouter une instance** pour un autre compte du même type.
3. Colle les secrets, choisis l’**Agent pour les messages entrants**, clique sur **Enregistrer et connecter**.
4. Choisis **Autonome** (sans surveillance, toujours contrôlé par l’échelle d’autonomie) ou **Géré** (portail de sécurité à chaque appel d’outil).
5. Pour les DM Telegram : écris au bot, puis approuve le code sous **Appariement**. Surveille la **File d'entrée** si des livraisons échouent.

## Fonctions

Tu peux faire tourner **plusieurs comptes du même type** (p. ex. deux bots Telegram), chacun avec ses identifiants et son agent. Utilise **Ajouter une instance** ou, sur une carte, **Ajouter une instance …**.

### Types de canal (catalogue) {#channel-types}

Voici les types de messagerie qu’EYAS propose. MCP / A2A **ne sont pas** des canaux de chat.

| Type | Ce que tu connectes | Appariement | Extra |
|------|---------------------|-------------|-------|
| **Telegram** | Jeton d’API HTTP de BotFather | Oui — DM inconnus | De première classe ; voir [Telegram](/docs/fr/communication/telegram/) |
| **Discord** | Jeton du bot de l’application | Non | Nécessite `discord.js` à l’exécution |
| **Slack** | Jeton du bot (`xoxb-`) + jeton de niveau app (`xapp-`) | Non | Socket Mode — pas de webhook public |
| **Email (SMTP/IMAP)** | SMTP (obligatoire) + IMAP optionnel | Non | N’importe quelle boîte |
| **Gmail (API)** | ID et secret client OAuth, refresh token, boîte | Non | API Gmail |
| **Microsoft 365 (Graph)** | Tenant, ID et secret client, UPN de la boîte | Non | Identifiants d’app Graph |
| **WhatsApp Business** | ID du numéro de téléphone, jeton d’accès, jeton de vérification, secret de l’app | Non | Webhook `/api/v1/webhooks/whatsapp` |
| **Signal** | Numéro E.164 du bot + URL du pont HTTP signal-cli | Non | EYAS n’embarque pas Signal |
| **Google Chat** | ID de projet/app, jeton d’envoi et espace par défaut optionnels | Non | Webhook `/api/v1/channels/googlechat/webhook` |
| **Microsoft Teams** | ID d’app, mot de passe d’app, tenant optionnel | Non | Webhook `/api/v1/channels/teams/webhook` |

Chaque carte déplie **Comment configurer ceci** avec des étapes numérotées avant le formulaire d’identifiants. Les types à webhook affichent aussi **Chemins de webhook à exposer**.

## Champs et commandes

### Créer une instance {#create-instance}

| Champ | Signification |
|-------|---------------|
| **Type de canal** | Modèle du catalogue |
| **Nom affiché** | p. ex. Signal travail, Telegram personnel |
| **Créer et connecter** | Crée l’instance et lance la connexion |
| **Supprimer l'instance** | Supprime l’instance et ses identifiants (avec confirmation) |

### Statut de l’instance {#status}

| Statut | Signification |
|--------|---------------|
| **Connecté** | Connexion active |
| **Déconnecté** | Pas connecté |
| **Identifiants définis** | Secrets stockés ; il peut falloir connecter |
| **Non configuré** | Secrets manquants |
| **Erreur** | Dernière erreur |
| État **Conflit / Erreur d'authentification / Dégradé** | État de fonctionnement |

### Mode {#mode}

| Mode | Signification |
|------|---------------|
| **Autonome** | Tourne sans surveillance ; l’échelle d’autonomie progressive contrôle toujours chaque action |
| **Géré** | Le portail de sécurité contrôle chaque appel d’outil |

Un clic bascule d’un mode à l’autre (les infobulles expliquent chacun).

### Mémoire dans les réponses des canaux {#memory-in-replies}

Une réponse formulée avec la voix **interne** du propriétaire reçoit le même bloc de mémoire rappelée, avec la date et l’heure actuelles, qu’un tour de chat (voir [Mémoire — Comment le rappel atteint le modèle](/docs/fr/knowledge/memory/#how-recall-reaches-the-model)). Une réponse dont la portée de voix est **Externe** — **Forcer Externe** réglé sur la conversation, ou une surcharge temporaire — ne reçoit que la date et l’heure : aucune mémoire rappelée du propriétaire n’est poussée vers un lecteur extérieur. Si EYAS ne peut pas déterminer la portée de voix d’une réponse, celle-ci part aussi sans mémoire rappelée. Les outils mémoire ne changent pas et restent gouvernés par le portail de sécurité.

La liste **Outils** de l’agent lié s’applique aux réponses des canaux comme sur tous les autres chemins, plus `memory_search` et `memory_expand` ([Configurer — Outils](/docs/fr/agents/configure/#tools--constraints)). Ce qu’écrivent les expéditeurs des canaux est mémorisé comme texte *peer*, pas comme le tien.

**Capture de mémoire sur les réponses de canal.** Chaque réponse de canal exécute désormais aussi la capture de mémoire durable d’EYAS, sous les mêmes réglages `memory.capture.*` qu’un tour de chat. Le message de l’expéditeur est lu comme les mots d’un tiers : il ne peut jamais créer de note sur qui tu es ni de règle sur la façon dont EYAS doit travailler, il ne peut produire que des notes `reference`, `project` ou `domain`, qui portent `trust: peer` et sont stockées avec la confiance *peer*, et une telle note ne complète jamais une de tes propres notes. Le contrôle de longueur ne compte que les mots de l’expéditeur : un court « ok » ne déclenche donc aucun appel au modèle, et une conversation de canal partage un seul plafond `maxPerConversation` entre tous ses messages. Voir [Mémoire — Le capture est activé par défaut](/docs/fr/knowledge/memory/#capture-is-on-by-default).

**Modèle et effort.** Une conversation de canal suit le modèle de l’agent lié ; si l’agent n’en a pas, le défaut de l’install est fixé sur la conversation à sa première réponse. L’effort de raisonnement propre de l’agent s’applique aussi. Chaque réponse de canal enregistre le fournisseur et le modèle qui ont répondu, et l’effort avec lequel elle a tourné.

### Messages refusés (confidentialité) {#refused-messages}

Un canal compte toujours comme une destination distante. Un message entrant qui contient une valeur que la politique de confidentialité règle sur **Bloquer** — par défaut un IBAN, un numéro de compte bancaire, un numéro fiscal, un numéro de carte d’identité, un numéro de carte bancaire ou un SSN américain, plus tout motif personnalisé réglé sur Bloquer — est refusé avant que quoi que ce soit ne soit stocké :

- L’expéditeur reçoit une réponse automatique dans la langue dans laquelle il a écrit (anglais, hongrois, allemand, espagnol, français ou klingon ; anglais en cas de doute). Elle nomme les types, jamais les valeurs, et lui demande de renvoyer le message sans ces valeurs.
- Aucune conversation, aucun message ni aucune exécution d’agent n’est créé. Dans la **File d'entrée**, l’événement affiche le statut **ignoré** avec l’erreur `privacy_blocked`, et seul son texte masqué est gardé. Si l’envoi de l’avis échoue, l’événement est retenté comme toute livraison.
- Les messages déjà stockés avant un changement de politique ne sont pas refusés après coup. Les adresses e-mail et numéros de téléphone (classe Masquer) et les valeurs de classe Avertir ne sont jamais refusés.

Chaque refus est audité sous `privacy.inbound_refused` (les types et l’identifiant de l’événement entrant, jamais une valeur). Voir [Sécurité et confidentialité — Messages refusés](/docs/fr/admin/security-privacy/#refused-messages).

### Identifiants et agent lié {#credentials}

| Champ | Signification |
|-------|---------------|
| Champs secrets | Propres à chaque canal (voir la carte ou le chapitre Telegram) |
| *Laissez vide pour conserver la valeur actuelle* | Texte indicatif à l’édition |
| Badge **défini** | Le secret est déjà stocké |
| **Agent pour les messages entrants** | Quel agent répond ; par défaut l’assistant principal |
| **— aucun (messages stockés, pas de réponse automatique) —** | Stockage seulement |
| **Agent lié** | Agent lié actuellement |
| **Enregistrer et connecter** | Enregistre les secrets et connecte |
| **Tester / Connecter / Déconnecter / Reconnecter / Configurer** | Actions du cycle de vie |

### Onglet File d'entrée {#inbound}

File durable à livraison au moins une fois pour les messages entrants des canaux. Les livraisons échouées sont retentées avec délai puis passent en dead-letter ; les lignes **mort** peuvent être remises en file.

| Colonne | Signification |
|---------|---------------|
| **Source** | Instance du canal |
| **Expéditeur** | Identifiant / nom de l’expéditeur |
| **Message** | Corps |
| **Tentatives** | Tentatives de livraison |
| **Reçu** | Ancienneté (*il y a N s / il y a N min / il y a N h*) |

La colonne **Statut** affiche **en attente**, **livré**, **mort** ou **ignoré** ; la raison d’une ligne en échec ou ignorée apparaît sous le message (par exemple `privacy_blocked`, voir [plus haut](#refused-messages)). **Réessayer** sur une ligne **mort** la remet en file ; **Actualiser** recharge la liste.

### Onglet Appariement {#pairing}

Les expéditeurs inconnus reçoivent un code d’appariement et attendent ici. Approuver donne au canal l’accès à son agent lié ; les appariements survivent aux redémarrages. Telegram est le type du catalogue avec **supportsPairing**.

| Commande | Signification |
|----------|---------------|
| Badge **Appariement** | Sur la carte du canal quand l’appariement est requis |
| **Approuver / Rejeter** | Décision sur une demande en attente |
| Colonnes | Source, Expéditeur, Code, Demandé |

Vide : *Aucune demande d'appariement en attente.*

## Voir aussi

- [Telegram](/docs/fr/communication/telegram/)
- [A2A](/docs/fr/communication/a2a/)
- [Agents — canaux](/docs/fr/agents/configure/)
- [Connexions](/docs/fr/admin/connections/)
- [Mains](/docs/fr/admin/hands/)
- [Ingress](/docs/fr/admin/ingress/)
