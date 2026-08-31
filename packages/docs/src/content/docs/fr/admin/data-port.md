---
title: Import et export de données
description: Assistant d’import pour mémoire, compétences et règles de workspace — scanner, choisir, approuver.
---

**À quoi ça sert.** Data-port est l’**assistant d’import**. Il scanne un chemin serveur ou un zip/markdown d’un autre assistant et propose où le classer. La mémoire peut s’appliquer ; règles et identité de workspace sont **proposition seulement** jusqu’à l’approbation du merge. Pas un dump de BD — utilise [Sauvegarde](/docs/fr/admin/backup/). L’export est **Bientôt**.

**Emplacement :** Paramètres → **Portabilité des données**.

## Quand l'utiliser

- Notes durables de `~/.claude` ou d’un vault Obsidian `ai-memory` vers EYAS (la seule mémoire que les tours suivants liront).
- Compétences custom Claude/Cursor → catégorie **own**.
- Règles/identité comme propositions de merge, jamais d’auto-écrasement.

## Déroulement typique

1. **Paramètres** → **Importer des données…**
2. **Système source** (auto, Claude Code, Cursor, Obsidian, generic-md, chat-export, eyas-export).
3. **Chemin serveur** ou **Choisir un fichier…**. **Instructions** optionnelles.
4. **Scanner**. Choisis les groupes.
5. **Importer N éléments**. Règles/identité : **Approuver le merge** / **Rejeter**.

Le dossier parfait n’est pas exigé. Un scan **home** reste dans les dossiers assistant et **Documents** (atteint l’`ai-memory` Obsidian). Il **ne** parcourt **pas** `GitHub` ni les autres arbres source. Y sont **ignorés** : index `MEMORY.md`, dumps de session (`claude-sessions`), docs produit, `robots.txt`/LICENSE, `AGENTS.md` dans les dépôts — même si tout est coché. Les notes `ai-memory` / `.grok/memory` / `.claude/skills` sont copiées, `kind: reference` si non déclaré. Le chemin source n’est plus lu ensuite.

## Voir aussi

- [Mémoire](/docs/fr/knowledge/memory/)
- [Compétences](/docs/fr/automation/skills/)
- [Sauvegarde](/docs/fr/admin/backup/)
- [Agents — workspace](/docs/fr/agents/identity-workspace/)
