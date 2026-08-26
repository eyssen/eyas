---
title: Outils
description: Outils intégrés et d’extension que les agents peuvent appeler.
---

**Route :** `/tools`.

Les outils sont des **capacités invocables** (système de fichiers, shell, navigateur, HTTP, recherche, intégrations métier, outils MCP, …). L’affectation à un agent se fait dans l’onglet **Configuration** de l’agent (liste `Tools` séparée par des virgules) ainsi que via les autorisations / la porte de sécurité.

| Concept | Signification |
|---------|---------------|
| Nom de l’outil | Identifiant stable utilisé dans la configuration d’agent et les journaux |
| Description | Ce que fait l’outil (affiché dans le catalogue) |
| Autorisations | CASL / la porte peut bloquer un appel à l’exécution |
| Bac à sable | Certains outils s’exécutent dans des environnements restreints |

Configurez les outils MCP sous [Serveurs MCP](/docs/fr/ai/mcp/). Identifiants des systèmes externes sous [Connexions](/docs/fr/admin/connections/).

---

## Groupes d’outils intégrés (points saillants)

### Surface de codage (indépendante du modèle)

Outils de système de fichiers de premier plan afin que **chaque** modèle (Grok, Claude API, Kimi, local, …) puisse modifier du code sans dépendre des primitives du SDK Claude Code :

| Outil | Rôle | Risque |
|-------|------|--------|
| `read_file` | Lire un fichier texte (décalage / limite de lignes) | vert |
| `write_file` | Créer / écraser un fichier | jaune |
| `edit_file` | Remplacement exact de chaîne (édition ciblée) | jaune |
| `grep` | Recherche de contenu dans l’espace de travail | vert |
| `glob` | Trouver des fichiers par motif | vert |
| `git_status` / `git_diff` | Aides de revue en lecture seule | vert |
| `run_command` | Exécution de programme sans shell (approbation) | rouge |

Les chemins sont enfermés dans l’espace de travail ou le **worktree** de l’agent. Les chemins sensibles (`.env`, `master.key`, `.ssh`, …) sont refusés. Préférez `edit_file` aux réécritures de fichier entier.

**Vérifier avant de terminer :** configurez `agent.verifyCommands` dans le YAML (p. ex. `bun test`) pour lancer des contrôles déterministes après une exécution ; les échecs rouvrent l’agent avec le résumé d’erreur.

**Hooks :** chaque appel d’outil passe par PreToolUse / PostToolUse sur le ToolExecutor (universel, pas seulement Claude).

### Recherche et ancrage

| Outil | Rôle |
|-------|------|
| `list_search_sources` | Lister les sources (libellé, version, édition, famille, chemins, statut) avant d’inventer des faits |
| `get_search_context` | Montrer quelles sources sont épinglées pour cette conversation |
| `set_search_context` | Épingler ou effacer des sources (`sourceIds`, `labels`, `version`, `edition`, ou `clear: true`) |
| `search_indexed` | Recherche hybride FTS + vecteur avec **citations** ; respecte l’épingle conversation / projet ; `sourceIds` / `labels` / `version` / `edition` optionnels |

Lorsque plusieurs sources de la **famille odoo** sont prêtes et que rien n’est épinglé, les outils renvoient **`needsPin`** au lieu de mélanger les versions. Voir [Recherche — épingle multi-version](/docs/fr/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

### Blocs de mémoire

| Outil | Rôle |
|-------|------|
| `memory_block_read` / `memory_block_write` | Blocs partagés de type Letta (entreprise / agent / équipe / exécution) |

Voir [Mémoire](/docs/fr/knowledge/memory/).

### Navigateur

| Outil | Rôle |
|-------|------|
| Outils de session navigateur | Naviguer et interagir ; **SSRF** bloque les hôtes privés / de métadonnées |
| `browser_snapshot` | Instantané de l’arbre d’accessibilité (économe en tokens) |

### E-mail (brouillon → approuver → envoyer)

| Outil | Rôle |
|-------|------|
| `email_create_draft` | Créer un brouillon local |
| `email_approve_draft` | Marquer le brouillon comme approuvé |
| `email_send_draft` | Envoyer **uniquement** s’il est approuvé |

### Odoo (module optionnel)

**Instance active** (JSON-RPC) :

| Outil | Rôle |
|-------|------|
| `odoo_search_tasks` | Rechercher des tickets / tâches (surtout lecture) |
| `odoo_get_task` | Récupérer une tâche |
| `odoo_message_post` | Publier un message chatter |
| `odoo_write_task` | Écriture sous porte |

**Index de source locale** (chaîne de codage) :

| Outil | Rôle |
|-------|------|
| `odoo_search_model` | Trouver `_name` / `_inherit` dans le Python local |
| `odoo_search_field` | Trouver les affectations `fields.*` |
| `odoo_search_xml_id` | Trouver les identifiants d’enregistrements XML |

Les racines se résolvent ainsi : **épingle** conversation / projet → Sources de recherche (`family: odoo`) → `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. Filtres d’outil optionnels : `label`, `labels`, `sourceIds`, `version`, `edition`. Citations : `[source:odoo-src:label:file:line]`.

Compétence : `coding/odoo/odoo-dev-chain`. Identifiants de l’instance active via [Connexions](/docs/fr/admin/connections/) (type Odoo). Interface multi-version : [Recherche](/docs/fr/daily/search/) · [Projets](/docs/fr/daily/projects/) · onglet **Sources** de la conversation.

### Inventaire des connexions

| Outil | Rôle |
|-------|------|
| `connections_list` / `connections_catalog` | Inventaire + catalogue |
| `connections_test` | Contrôle de santé |
| `connections_propose` | Proposer une connexion pour approbation humaine |

### Parité CLI MCP

Lorsque les agents s’exécutent sur **Grok CLI** ou **Kimi Code CLI**, EYAS injecte un pont MCP stdio afin que ces hôtes partagent les mêmes outils ToolExecutor que les sessions in-process / Claude Code. Voir [MCP](/docs/fr/ai/mcp/).

---

## Voir aussi

- [Agents — configurer les outils](/docs/fr/agents/configure/)
- [Porte de sécurité](/docs/fr/admin/security-privacy/)
- [Connexions](/docs/fr/admin/connections/)
