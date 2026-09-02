---
title: Outils
description: Catalogue de capacités invocables — risque, approbation et affectation.
---

**À quoi ça sert.** Les outils sont les actions qu’un agent peut vraiment prendre. Cette page est le catalogue vivant. L’affectation reste dans **Configuration** de l’agent ; ici tu vois nom, catégorie, risque et si l’appel attend une approbation.

**Route :** `/tools`. Barre : **Outils**.

## Quand l'utiliser

- Avant de poser des ids sur un agent.
- Un appel a été bloqué : palier de risque et **approbation requise**.
- MCP ou Connexion branchés, outils découverts à côté des builtins.
- Schéma d’entrée dont l’agent se trompe.

## Déroulement typique

1. **Outils** (`/tools`).
2. Cherche ou filtre par **catégorie** et **palier de risque**.
3. **Afficher le schéma** pour le JSON.
4. Affecte l’id dans **Configuration**. [Configurer](/docs/fr/agents/configure/).
5. Les appels dangereux passent encore le [portail de sécurité](/docs/fr/admin/security-privacy/).

## Fonctions

En-tête : compte et combien **requièrent une approbation**. Catégories `system`/`file`/`network`/`compute`/`data`. Le catalogue affiche le risque **green / yellow / red**. Surface de code (`read_file`, `edit_file`, `grep`, `glob`, `git_status`/`git_diff`, `run_command` — chemins enfermés dans les **dossiers de travail**). Un `run_command`/`Bash` clairement `git status` ou `git diff` (sans métacaractère, sans `-C`/`--git-dir`/`--no-index`, sans chemin absolu) est remappé vers les outils verts **sans clic**. `git commit` / `git add` / `ls` restent rouges. recherche/`needsPin`, blocs mémoire + `search_memory`/`save_memory` (`scope` par défaut `current` : ce projet + type + notes globales ; `all` = autres projets ; `search_memory` cherche aussi les messages de conversations antérieures (user + assistant) dans le projet courant ; `scope=all` traverse les projets ; la page Mémoire ne filtre pas), e-mail draft→approve→send, Odoo optionnel, inventaire Connexions. **Médias** (optionnel) : `media_generate`, `media_wait`, `media_catalog`, `media_balance`, `media_history` — [Médias](/docs/fr/ai/media/). Le polish d’écran n’est pas un outil : Recordly est un compagnon AGPL sous [Extensions](/docs/fr/admin/extensions/#recordly) — pas de `recordly_*`. Parité CLI MCP : [MCP](/docs/fr/ai/mcp/).

<h3 id="browser">Navigateur</h3>

Playwright headless (`browser_*`) : SSRF ; index `browser_snapshot` + `snapshotId` (meurent à la navigation) ; onglets, back, wait, hover, select, dialog, upload, `evaluate` dans la page seulement, téléchargement → Documents, `storageState`. `browser_replay` / `browser_action_cache` enregistrent un locator (JSON projet ou vault, pas de LLM, pas de valeurs). `browser_totp` (jaune) lit la graine dans Secrets/Trousseau et passe le code à `browser_fill`. Profil `data/browser/profile`, jamais le Chrome quotidien (Chrome 136+). [Browser Use](/docs/fr/automation/browser-use/) optionnel : recommandé `agent_browser_*`, héritage `browser_use_*`.

Vide : *Aucun outil enregistré pour le moment.*

## Voir aussi

- [Agents — outils](/docs/fr/agents/configure/)
- [Portail de sécurité](/docs/fr/admin/security-privacy/)
- [Connexions](/docs/fr/admin/connections/)
- [Compétences](/docs/fr/automation/skills/)
- [Serveurs MCP](/docs/fr/ai/mcp/)
- [Médias](/docs/fr/ai/media/)
- [Studio](/docs/fr/studio/)
- [Extensions](/docs/fr/admin/extensions/#recordly)
