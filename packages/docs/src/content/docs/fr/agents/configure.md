---
title: Créer et configurer
description: Nom, modèle, outils, budget et liaisons de canaux d’un agent.
---

**À quoi ça sert.** L’onglet **Configuration** est l’identité enregistrée d’un agent : nom, rôle, modèle, effort, outils, contraintes et budget mensuel de tokens. Les fichiers de l’espace de travail et les profils vocaux sont des onglets à part. C’est ce que vous remplissez à la création, et ce que vous modifiez quand son travail change.

## Quand l’utiliser

- Vous créez un agent et il vous faut un nom, un type, un modèle et une liste d’outils.
- Un agent de code sur un modèle d’API doit avoir `read_file` / `edit_file` / `grep` sans dépendre d’une CLI.
- Un plafond mensuel de tokens doit arrêter la dépense, ou vous voulez le lever (`0` = illimité).
- Telegram (ou un autre canal) entrant doit aboutir chez cet agent.
- Vous voulez que le coach de prompt resserre le prompt système — pas la voix, pas le domaine du projet.

## Déroulement typique

1. Ouvrez **Agents** → cliquez sur l’agent (ou **Créer un agent**) — route `/agents/:id`, onglet **Configuration**. La conversation de l’assistant **Créer un agent** ne nomme aucun modèle : elle tourne sur le défaut de l’installation, fixé à son premier message.
2. Remplissez **Nom**, **Rôle**, **Niveau**, **Type d'agent**, **Modèle** (un fournisseur + un modèle, ou **Modèle propre de la conversation**), **Effort**, **Outils (séparés par des virgules)**, **Contraintes (une par ligne)**.
3. Définissez un **Budget mensuel de tokens** si vous voulez un plafond. Sur l’onglet **Canaux**, liez un canal si les messages entrants doivent arriver ici.
4. **Enregistrer les modifications**. Une nouvelle conversation avec cet agent utilise ce modèle, cette liste d’outils et ce prompt.

## Fonctions

L’en-tête affiche le résumé **Budget de tokens** et, pendant une exécution, **Exécution…**. Onglets : **Configuration**, **Souvenirs**, **Voix**, **Espace de travail**, **Canaux**.

## Classification

| Champ | Signification |
|-------|---------------|
| **Niveau** | **Principal** / **Équipe** = collègues à qui vous parlez ; **Spécialiste** = pool partagé lancé à la demande (voir [vue d’ensemble](/docs/fr/agents/overview/)) |
| **Type d'agent** | **Assistant**, **Ingénieur**, **Développeur**, **Réviseur**, **Critique**, **Chercheur**, **Planificateur**, **Coordinateur**, **Observateur** |

## Bloc persona

| Champ | Signification |
|-------|---------------|
| **Nom** | Nom affiché |
| **Rôle** | Ligne de rôle courte |
| **Description** | Description plus longue |
| **Objectif** | Ce qui guide les décisions (*Ce qui guide les décisions de cet agent*) |
| **Histoire** | Contexte qui façonne l’approche (*Contexte qui façonne l'approche et le point de vue de l'agent*) |
| **Avatar** | Emoji affiché dans l’interface |
| **Prompt système** | Instructions au niveau de l’agent (combinées aux prompts en couches) |
| **Coach de prompt** | Coach IA pour le prompt système (protocole d’exploitation uniquement — pas la voix, pas le domaine du projet) — [Prompts](/docs/fr/ai/prompts/#prompt-coach) |

<h2 id="model--effort">Modèle et effort</h2>

| Champ | Signification |
|-------|---------------|
| **Modèle** | Un fournisseur plus un modèle, choisis dans une liste groupée par fournisseur — ou **Modèle propre de la conversation** (vide) : le collègue tourne alors sur le modèle de la conversation — celui du tour qui délègue, ou le défaut de l’installation fixé à la première utilisation (voir [Équipes et délégation](/docs/fr/agents/teams/#which-model-and-effort-a-specialist-or-member-uses)) |
| Bouton de réinitialisation | *Utiliser le modèle propre de la conversation* — efface le modèle ; l’enregistrement l’efface vraiment |
| Note rouge | *&lt;fournisseur&gt; / &lt;modèle&gt; n'est pas un modèle activé d'un fournisseur actif. Jusqu'à son retour, ce collègue utilise le modèle propre de la conversation.* |
| **Effort** | Le même sélecteur d’effort que dans les conversations : seulement les niveaux que propose le modèle de l’agent (parmi **Aucun**, **Minimal**, **Faible**, **Moyen**, **Élevé**, **Très élevé**, **Maximum** ; **Activé** / **Désactivé** pour un modèle à bascule), avec **Automatique** en premier, qui affiche le défaut du modèle (*Automatique · défaut du modèle (Moyen)*). Choisir un modèle qui ne propose pas le niveau enregistré le modifie avant l’enregistrement et le signale (*Effort ajusté de Très élevé à Élevé : le modèle choisi ne propose pas Très élevé.*) ; un modèle sans réglage d’effort le ramène à Automatique. Un niveau que le modèle ne prend pas en charge n’est pas enregistré, et un message indique les niveaux qu’il prend en charge — vos autres modifications restent dans le formulaire. Sans modèle fixe, le sélecteur propose tout niveau qu’accepte un modèle d’un niveau du routage automatique. L’effort du collègue s’applique partout où il tourne — son chat, son fil d’accueil, les réponses de canal, et comme niveau hérité des spécialistes auxquels il délègue. Voir [Fournisseurs — Effort de raisonnement](/docs/fr/ai/providers/#reasoning-effort). |
| Indication d’effort | *Effort de raisonnement de ce collègue — seuls les niveaux proposés par son modèle sont listés, et un changement de modèle ajuste un niveau que le nouveau modèle ne propose pas. Automatique = la valeur par défaut du modèle.* |
| **Tours max.** | Plafond strict d’allers-retours avec le modèle par exécution — pour les tours de chat de ce collègue et pour ses exécutions en arrière-plan, de spécialiste, d’équipe et de canal. Sur Claude Code, Grok et Kimi, c’est aussi le plafond de tours propre à la CLI. Pour un agent sans valeur enregistrée, le champ affiche 10, et l’enregistrement stocke le nombre affiché. Sans valeur enregistrée, un tour de chat autorise 25 allers-retours, une exécution en arrière-plan, d’équipe ou de canal 20, et une exécution de spécialiste 10. |

Enregistrer d’autres champs (nom, prompt…) ne renvoie pas le modèle : une modification n’échoue donc jamais parce que le modèle a été désactivé entre-temps.

**Mise à jour.** Au premier démarrage après la mise à jour, chaque agent existant dont l’identifiant de modèle apparaît sous exactement un fournisseur du catalogue de modèles reçoit automatiquement ce fournisseur. Les identifiants listés sous plusieurs fournisseurs, les identifiants inconnus et les noms de niveau comme `sonnet` restent sans fournisseur ; ils sont rattachés à leur propriétaire à l’exécution et, si ce n’est pas possible, le modèle propre de la conversation est utilisé.

<h2 id="tools--constraints">Outils et contraintes</h2>

| Champ | Signification |
|-------|---------------|
| **Outils (séparés par des virgules)** | Noms des outils que cet agent peut appeler. Espace réservé : *Vide = tous les outils · p. ex. read_file, grep, research*. Indication : *Vide = tous les outils. S'applique dans le chat et avec chaque fournisseur, y compris aux outils d'écriture, de shell et web propres à un modèle CLI. La recherche en mémoire est toujours disponible ; avec un modèle CLI, la lecture de fichiers dans les dossiers de la conversation aussi.* |
| **Capacités (séparées par des virgules)** | Étiquettes de capacité (p. ex. `research, coding`) |
| **Contraintes (une par ligne)** | Règles strictes (p. ex. pas d’opérations destructrices) |

### Ce que signifie la liste Outils

La liste s’applique de la même façon sur tous les chemins où un agent tourne : chat interactif, exécutions planifiées et de tableau d’une conversation, spécialistes lancés avec `run_specialist` / `delegate_to_agent`, membres d’une équipe et réponses de canal (Telegram, Slack, e-mail et les autres canaux) — et avec chaque fournisseur : modèles d’API et modèles CLI Claude Code, Grok et Kimi.

- **Une liste vide signifie tous les outils.**
- Sinon, l’agent se voit proposer **exactement les outils listés, plus `memory_search` et `memory_expand`**. Tout agent reçoit toujours ces deux outils mémoire d’EYAS, même si sa liste les omet.
- Dans une conversation **Solo**, `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` et `propose_team` sont aussi retirés ; `memory_search`, `memory_expand` et `assign_task` (travail de tableau) restent.
- L’inventaire d’outils du prompt système de l’agent ne nomme que les outils réellement proposés à l’exécution.
- **Un modèle ne peut utiliser qu’un outil qui lui a été proposé.** Si un modèle nomme un outil hors de la liste, ou un outil qui n’existe pas, EYAS refuse l’appel avec *'&lt;tool&gt;' is not in this agent's toolset* et ne l’exécute pas. Il n’y a pas de demande d’approbation ; le refus est immédiat, avec chaque fournisseur.
- **Les noms inconnus sont écartés.** Un nom qui n’est pas un outil installé (une faute de frappe, un module désactivé, un serveur MCP non connecté) n’est pas proposé, et le journal du serveur affiche un avertissement par agent et par nom d’outil.
- **Pour les modèles CLI (Claude Code, Grok, Kimi), la liste limite aussi les outils intégrés propres de la CLI**, de la même façon pour chaque CLI :
  - **Écriture de fichiers** (Write, Edit, NotebookEdit de Claude Code ; les outils d’édition et de déplacement de Grok et Kimi, et les écritures de fichiers qu’EYAS sert à la CLI) : seulement quand la liste contient `write_file` ou `edit_file`.
  - **Commandes shell** (Bash de Claude Code ; les outils d’exécution de Grok et Kimi ; une suppression compte comme commande shell, comme la classe la porte de sécurité) : seulement quand la liste contient `run_command`. `git_status` et `git_diff` n’accordent pas le shell ; sur une liste sans `run_command`, ils sont proposés à la place à la CLI comme outils EYAS par le pont.
  - **Récupération et recherche web** (WebFetch, WebSearch de Claude Code ; les outils de récupération de Grok et Kimi, web_fetch et web_search de Grok) : seulement quand la liste contient un outil web — `research`, `browser_navigate`, `agent_browser_run` ou `browser_use_exec`.
  - **Lecture de fichiers** (Read, Glob, Grep de Claude Code ; les outils de lecture, de recherche et de liste de Grok et Kimi) : toujours permise, quoi que dise la liste. Elle reste dans les dossiers de la conversation, sous la politique mémoire et le sandbox de fichiers du noyau. La recherche en mémoire reste disponible aussi.
  - Une liste vide signifie toujours tous les outils, outils propres de la CLI compris.

  Sur Claude Code, les outils retenus ne sont pas du tout proposés au modèle. Sur Grok et Kimi, un outil retenu que la CLI tente d’utiliser est refusé par EYAS avant que la porte de sécurité soit consultée : pas de demande d’approbation, et la ligne d’outil affiche **Refusé**. Les demandes de permission de Kimi ne disent pas quel type d’outil demande (d’après le source de Kimi 1.52.0 ; pas encore vérifié sur un hôte) : un agent dont la liste n’a pas les outils d’écriture de fichiers ou `run_command` ne peut donc utiliser aucun des outils de Kimi qui demandent (écriture ou remplacement de fichier, shell, tâches d’arrière-plan). La recherche et la récupération web de Kimi ne demandent jamais rien à EYAS : elles ne peuvent donc pas être permises par agent ; la vérification d’isolation d’EYAS arrête toujours un tour qui les utilise. Voir [Fournisseurs — Isolation de Claude Code](/docs/fr/ai/providers/#claude-code-isolation).
- Par le pont EYAS — le serveur intégré au processus de Claude Code comme le pont MCP de Grok/Kimi —, la liste gouverne les outils EYAS qu’atteint la CLI. Les outils EYAS pour lesquels la CLI a un équivalent propre autorisé (`read_file`, `grep`, `glob` toujours ; `write_file`, `edit_file` tant qu’elle peut écrire ; `run_command`, `git_status`, `git_diff` tant qu’elle peut utiliser son shell) ne passent pas par le pont : la CLI utilise ses propres outils sous la porte de sécurité, la politique mémoire et le sandbox de fichiers du noyau. Les outils EYAS de navigateur, agent-browser, browser-use et OpenCode atteignent aussi les modèles CLI. Voir [MCP — Parité des outils pour les CLI](/docs/fr/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

**Changement de comportement pour les agents existants :** une liste étroite est respectée partout. Par exemple, l’**Assistant personnel** ne reçoit pas `run_command` / `write_file` dans les exécutions de chat, en arrière-plan, de spécialiste ou d’équipe, comme le prévoit son modèle — et sur Claude Code, Grok et Kimi, il ne peut plus non plus écrire de fichiers ni lancer de commandes via les propres Write, Edit ou Bash de la CLI. Pour accorder un outil, ajoutez-le à la liste (`write_file` / `edit_file` pour l’écriture, `run_command` pour le shell), ou videz la liste pour autoriser tous les outils. Les agents dont la liste nomme des outils inexistants perdent ces noms (avec un avertissement dans le journal), et un modèle qui appelle un outil hors de sa liste proposée reçoit un refus.

### Agents de programmation (surface indépendante du modèle)

Pour implémenter, corriger ou relire avec un modèle d’API, accordez les outils fichiers de premier rang afin que le modèle puisse modifier sans shell :

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| Outil | Usage |
|-------|-------|
| `read_file` / `edit_file` / `write_file` | Lire et modifier de façon ciblée dans les dossiers de travail ou le worktree |
| `grep` / `glob` | Trouver symboles et fichiers |
| `git_status` / `git_diff` | Aides à la relecture (lecture seule) |
| `run_command` | Tests/lint (niveau rouge — approbation / autonomie) |

Les modèles CLI (Claude Code, Grok, Kimi) utilisent à la place leurs propres outils de fichiers et de shell, et ces noms dans la liste sont ce qui les autorise : `write_file` / `edit_file` débloquent les écritures de fichiers propres de la CLI et `run_command` son shell. Sans `run_command`, `git_status` et `git_diff` atteignent une CLI par le pont comme outils EYAS.

L’**Assistant personnel** (principal, type assistant) coordonne — ne lui donnez pas `write_file` / `edit_file` / `run_command`. L’**Ingénieur système** et les spécialistes du code possèdent ces outils. Voir [Équipes et délégation](/docs/fr/agents/teams/).

Les **agents existants** créés avant 0.8.6 **ne** reçoivent **pas** automatiquement les nouveaux outils — ajoutez-les ici (ou rechargez-les depuis un modèle mis à jour). Catalogue complet : [Outils](/docs/fr/automation/tools/).

<h2 id="imported-personas">Personas importés</h2>

Les agents peuvent venir de fichiers de persona dans les dossiers listés sous `agent.importRoots` dans `local.yaml` (voir [Configuration — Racines supplémentaires de skills et de personas](/docs/fr/deploy/configuration/#extra-skill-and-persona-roots)). Un agent que vous modifiez dans EYAS n’est **jamais écrasé** par son fichier :

- Au premier démarrage, un fichier crée son agent.
- Les modifications ultérieures du fichier ne mettent cet agent à jour que tant que son **nom, rôle, description, prompt système et outils** sont exactement tels que le dernier import les a laissés. Dès que vous modifiez l’un de ces cinq champs ici, le fichier ne change plus l’agent.
- Modifier seulement son modèle, son effort, son interrupteur marche/arrêt, son avatar, ses étiquettes ou son budget n’arrête pas les mises à jour, car l’import n’écrit jamais ces champs.
- Un agent importé que vous supprimez n’est pas recréé. Pour le récupérer, importez le fichier avec l’[Import de données](/docs/fr/admin/data-port/).
- Un agent existant de même identifiant que l’import n’a pas créé — un modèle intégré, un agent créé dans l’interface ou un agent venu de l’import de données — n’est jamais écrasé. S’il correspond déjà exactement au fichier, il est repris et suit les modifications ultérieures du fichier.
- Si deux dossiers d’import contiennent un persona de même identifiant, le dossier listé en premier l’emporte ; si ce fichier est retiré, le fichier du dossier suivant prend le relais.

**Mise à jour.** Les agents importés par des versions précédentes et non modifiés depuis sont repris automatiquement. Ceux que vous avez modifiés restent exactement tels quels.

## API (intégrateurs)

- `PATCH /api/v1/agents/:id` valide son corps comme la création : les champs inconnus comme `source` ou `id` sont ignorés, les valeurs invalides renvoient `400` avec les détails (un effort non pris en charge renvoie le code `EFFORT_UNSUPPORTED` avec les `levels` pris en charge par le modèle), et un agent inconnu renvoie `404`.
- `POST` / `PATCH /api/v1/agents` acceptent `provider` avec `model`. La paire doit être un modèle activé d’un fournisseur actif ; sinon la réponse est `400` avec `code: model_binding_unavailable`, `providerId` et `modelId`, et rien n’est enregistré. `provider` sans `model` → `400`.
- `model` seul (l’ancienne forme) est toujours accepté ; son fournisseur est rempli quand exactement un fournisseur liste cet identifiant de modèle.
- `provider: null, model: null` (ou un modèle vide) efface les deux. Les réponses `GET` incluent `provider`.

## Budget

| Champ | Signification |
|-------|---------------|
| **Budget mensuel de tokens** | Plafond du mois ; **`0` = illimité** |
| Consommation de tokens | Utilisé vs budget dans la liste et l’en-tête |

## Actions

| Commande | Signification |
|----------|---------------|
| **Enregistrer les modifications** | Enregistrer la configuration |

## Onglet Souvenirs (liste en lecture seule)

| Élément | Signification |
|---------|---------------|
| **Épisodique / De travail** | Filtre par niveau de mémoire |
| *N souvenirs* | Nombre |
| *pertinence : N* | Score d’importance |
| *consulté N×* | Nombre d’accès |
| *Premiers N sur M caractères — le souvenir entier est stocké* | Un long souvenir n’est raccourci que dans la liste |
| Indication vide | *Les souvenirs apparaîtront ici à mesure que l'agent interagit et apprend.* |

## Onglet Canaux (résumé)

Liez des instances de canal pour que les messages entrants atteignent cet agent. Liste complète des champs : [Canaux — vue d’ensemble](/docs/fr/communication/channels/).

| Commande | Signification |
|----------|---------------|
| **Associer une instance de canal** | Choisir une instance Telegram/… existante |
| **Associer à cet agent** | Attacher |
| **Dissocier** | Détacher |
| Statut **Connecté / Erreur / Identifiants définis / Non configuré** | Santé de l’instance |
| Mode **Autonome** | Le canal peut déclencher un traitement autonome |

## Voir aussi

- [Identité et espace de travail](/docs/fr/agents/identity-workspace/)
- [Équipes et délégation](/docs/fr/agents/teams/)
- [Profils vocaux](/docs/fr/agents/voice/)
- [Fournisseurs](/docs/fr/ai/providers/)
