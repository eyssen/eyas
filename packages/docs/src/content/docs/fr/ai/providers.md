---
title: Fournisseurs
description: Backends IA — API, CLI hôte et runtimes locaux. L’isolation est honnête par fournisseur.
---

**À quoi ça sert.** Les fournisseurs sont les backends LLM de cette instance. C’est ici qu’on **opte** pour la config Claude de l’hôte — éteinte par défaut — et que Grok/Kimi ACP disent qu’ils ne sont pas isolables.

**Route :** `/providers`. Onglets : **Niveaux de routage · Fournisseurs · Budget · Analyse IA**. Barre : **Fournisseurs**.

## Quand l'utiliser

- Après le setup : fournisseur **On**, clé, modèles.
- `claude` / `grok` / `kimi` sur l’hôte, fournisseur CLI sans clé.
- Les conversations lisaient `~/.claude` — **Charger la config Claude de l’hôte** **OFF**.
- Grok/Kimi ACP **chargent toujours** leur config machine — pas de faux interrupteur.

## Déroulement typique

1. **Fournisseurs** → onglet **Fournisseurs**.
2. Carte On/Off. Authentification : clé API (dans [Secrets](/docs/fr/admin/secrets/)) ou CLI hôte.
3. Active les modèles. Refresh API/CLI.
4. Claude Code CLI : laisse **Charger la config Claude de l’hôte** **OFF** sauf si tu veux settings.json, CLAUDE.md, skills hôte et `.mcp.json` projet.
5. Niveaux et dépense : [Routage et budget](/docs/fr/ai/routing-budget/).

Défaut isolé. L’opt-in envoie `settingSources: ['user','project','local']`. Les appels isolés/opt-out posent aussi `CLAUDE_CODE_DISABLE_AUTO_MEMORY` et `strictMcpConfig` — `settingSources: []` **seul** n’arrête pas l’auto-mémoire cwd. ACP n’a pas de paramètre d’isolation ; grok charge `~/.grok` et démontrablement `~/.claude`.

## Voir aussi

- [Assistant de setup](/docs/fr/setup-wizard/)
- [Secrets](/docs/fr/admin/secrets/)
- [MCP](/docs/fr/ai/mcp/)
- [Mémoire](/docs/fr/knowledge/memory/)
