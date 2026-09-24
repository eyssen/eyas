---
title: Autonomie
description: Réglez ce que les agents peuvent faire sans demander — file d’approbation et trois niveaux.
---

**À quoi ça sert.** L’autonomie est le cadran de sécurité. Pour chaque classe d’action, vous choisissez **Avis** (demander d’abord), **Approuver** (proposition + un clic) ou **Auto** (faire et rendre compte). Les actions sortantes et irréversibles restent verrouillées sur Avis. La même page est la file **Approbations en attente**, qui met une exécution en attente jusqu’à votre décision.

## Quand l’utiliser

- Une conversation est **En attente d'approbation** et vous devez **Approuver** ou **Rejeter** sans deviner ce qui attend.
- Vous voulez que le travail réversible (modifications de fichiers, recherche) tourne en **Auto**, sans jamais relever une classe sortante verrouillée.
- Une reprise a échoué alors que vous aviez déjà approuvé — la ligne bloquée a encore besoin de vous.
- Vous voulez activer ou désactiver les boucles d’auto-amélioration en arrière-plan (battement proactif, réflexion nocturne, propositions Forge, auto-apprentissage, adoption de compétences).

## Déroulement typique

1. Ouvrez **Autonomie** dans la barre latérale (section **Supervision**) — route `/autonomy`. Les boucles d’auto-amélioration se trouvent sous **Paramètres → Système**, carte **Autonomie et auto-amélioration**.
2. Lisez **Approbations en attente**. Pour chaque ligne, **Approuver** ou **Rejeter**. Suivez **Exécution en attente** vers la conversation si vous avez besoin de contexte.
3. Sous **Réversible**, réglez une catégorie sur **Avis / Approuver / Auto** (les catégories verrouillées ne peuvent pas dépasser Avis).
4. L’exécution en attente reprend (ou reste arrêtée en cas de rejet). **Nécessite votre attention** sur l’Accueil et le badge **En attente d'approbation** de la conversation disparaissent.

## Fonctions

L’autonomie règle le comportement **sans surveillance** : ce qu’un agent peut faire par classe d’action, et ce qui exige une **approbation humaine**.

## Principes

1. Les boucles d’auto-amélioration en arrière-plan sont **désactivées par défaut** ; les activer est votre choix.
2. Les approbations apparaissent dans **Nécessite votre attention** sur l’Accueil et comme badge **En attente d'approbation** dans la conversation.
3. Qu’un agent puisse modifier directement sa propre IDENTITY est un réglage YAML : `autonomy.identitySelfUpdate` (activé par défaut). Désactivé, les changements d’identité passent par des propositions Forge.

## File d’approbation et niveaux

**Route :** `/autonomy`. Le sous-titre explique que les actions irréversibles / sortantes sont verrouillées sur **Avis** et ne peuvent pas être relevées — un plancher de sécurité.

### Approbations en attente

| Commande | Signification |
|----------|---------------|
| **Approbations en attente** | File des demandes en attente |
| *Rien n'attend d'approbation.* | File vide |
| Catégorie · outil | Ce qui est demandé |
| Raison | Pourquoi la porte s’est déclenchée |
| **Exécution en attente** | Lien vers l’exécution / la conversation en attente |
| **Approuver / Rejeter** | Décider — approuver tente de reprendre l’exécution |
| *Reprise impossible : …* | L’approbation est décidée, mais l’exécution n’a pas redémarré (reprise bloquée) |

**Ce qui arrive dans la file.** Un appel d’outil jaune ou rouge attend ici quand la porte de sécurité demande un humain, avec chaque fournisseur — y compris les appels qu’une CLI (Claude Code, Grok, Kimi) veut faire avec ses propres outils, et les outils EYAS que Grok ou Kimi appellent via le pont d’outils. Dans une exécution autonome supervisée, une telle approbation met l’exécution en pause (**En attente d'approbation**) ; une fois approuvée, l’exécution reprend et exactement l’appel approuvé est autorisé une fois.

**Les mêmes verdicts avec chaque fournisseur.** Les outils EYAS que Grok et Kimi atteignent via le pont d’outils sont décidés exactement comme avec les fournisseurs API et Claude Code. Dans un chat que vous suivez, ou une conversation de canal, un appel que la porte autorise s’exécute : les niveaux de cette page ne s’appliquent pas aux chats suivis, et un outil marqué comme demandant une approbation n’attend plus ici du seul fait que le modèle est Grok ou Kimi. Dans les exécutions en arrière-plan (planifiées, d’équipe, de pipeline, ou toute exécution non marquée comme suivie), les niveaux s’appliquent : un appel dans une catégorie en **Avis** ou **Approuver** attend ici, et un appel que la porte remonte attend toujours une personne, même quand sa catégorie est en **Auto** — avant, un tel appel s’exécutait sans demander sur Grok et Kimi. Un outil hors de la liste **Outils** de l’agent est refusé avant que la porte soit consultée : il n’arrive donc jamais ici. Quand la vérification IA de la porte ne peut pas tourner — aucun modèle d’arrière-plan éligible, un budget arrêté, ou toutes les tentatives en échec —, l’appel est remonté ici au lieu d’être bloqué (voir [Sécurité et confidentialité — Juge de sécurité](/docs/fr/admin/security-privacy/#security-judge)).

**Une commande shell qui demande à sortir du sandbox.** Avec `security.cliSandbox: auto`, Claude Code peut demander à exécuter une commande hors du sandbox de fichiers du noyau (par exemple une commande qui a besoin de `~/.npm`). Une telle commande arrive toujours ici et attend une personne — jamais le juge IA, jamais l’échelle d’autonomie, quel que soit le niveau de la catégorie. Sa raison indique : *Une commande shell a demandé à s'exécuter hors du sandbox de fichiers du noyau. Seule une personne peut l'autoriser ; l'approuver laisse exactement cette commande s'exécuter une fois sans sandbox.* Les exécutions autonomes s’y arrêtent. Voir [Fournisseurs — Sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox).

**Décider depuis la conversation.** Un appel en attente d’approbation s’affiche comme *Approbation requise*, jamais comme réussi, et une carte d’approbation apparaît dans la conversation avec **Approuver**, **Refuser** et **Ouvrir les approbations**. La carte utilise la même permission que cette file (approuver sur Autonomie) ; un utilisateur qui ne l’a pas est informé qu’un owner ou un admin peut décider ici. Voir [Conversations — Approbations dans le chat](/docs/fr/daily/conversations/#approvals-in-the-chat).

### Niveaux (par catégorie)

| Niveau | Libellé | Indication |
|--------|---------|------------|
| 1 | **Avis** | Demander d'abord |
| 2 | **Approuver** | Proposition + approbation en un clic |
| 3 | **Auto** | Autonome + compte-rendu ensuite |

Les catégories se répartissent entre **Réversible** (vous pouvez relever le niveau) et **Sortant / irréversible (verrouillé)** (ne peut pas dépasser Avis — un plancher de sécurité).

## Paramètres (carte Autonomie et auto-amélioration)

**Paramètres → Système** contient la carte **Autonomie et auto-amélioration**. Chaque boucle activée effectue des appels de modèle payants selon un planning (ou à la demande), et toutes sont désactivées par défaut :

| Interrupteur | Signification |
|--------------|---------------|
| **Battement proactif** | Rédige des briefings proactifs lorsque quelque chose requiert votre attention |
| **Réflexion nocturne** | Une passe nocturne d’autoréflexion qui repère des améliorations dans le fonctionnement de l’assistant |
| **Propositions Forge** | Propose des améliorations d’outils ou de compétences apprises de la friction — votre approbation reste nécessaire |
| **Auto-apprentissage** | Propose des ajustements de prompt ou de routage appris des métriques d’usage — votre approbation reste nécessaire |
| **Adoption de compétences** | Propose de nouvelles compétences apprises de motifs répétés — votre approbation reste nécessaire |

Chaque interrupteur n’est qu’un indicateur de fonction — il ne supprime aucune donnée. Le modifier exige la permission **update Autonomy**.

## Surfaces du tableau de bord

| Surface | Signification |
|---------|---------------|
| Élément de configuration de l’Accueil **Autonomie et auto-amélioration** | Explication pour l’activer + lien vers la carte de paramètres |
| Accueil **Nécessite votre attention** | Approbations en attente et reprises bloquées |
| Conversation **En attente d'approbation** | Exécution bloquée sur vous |
| Telegram **Approve / Deny** | Même chemin de décision que cette file, pour les outils jaunes/rouges. La notification va au rattachement Telegram du fil, sinon à un appairage approuvé. Pas d’arguments d’outil bruts. Voir [Telegram](/docs/fr/communication/telegram/) |

## Voir aussi

- [Accueil](/docs/fr/daily/home/)
- [Forge](/docs/fr/agents/forge/)
- [Assistant proactif](/docs/fr/automation/proactive/)
- [Sécurité et confidentialité](/docs/fr/admin/security-privacy/)
- [Telegram](/docs/fr/communication/telegram/)
