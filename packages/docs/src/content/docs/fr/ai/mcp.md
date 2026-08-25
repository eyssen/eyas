---
title: Serveurs MCP
description: Connexions Model Context Protocol et parité des outils CLI.
---

**Itinéraire :** `/mcp-settings`.

Ajoutez des serveurs MCP pour que les agents puissent appeler des boîtes à outils externes.

| Champ typique | Signification |
|---------------|---------------|
| Nom du serveur | Identifiant d'affichage |
| Transport / commande / URL | Comment démarrer ou joindre le serveur |
| Authentification | Jetons/en-têtes si requis |
| Activer | Exposer les outils aux agents |
| Catalogue | Outils découverts |

Les outils apparaissent ensuite pour affectation sous la configuration de l'agent / le catalogue d'outils.

Vous pouvez aussi enregistrer un serveur MCP comme ligne d'inventaire [Connexion](/docs/fr/admin/connections/) (type **MCP server**) pour le suivi de santé à côté d'Odoo/GitHub/etc.

---

## Parité des outils MCP CLI (Grok / Kimi) {#cli-mcp-tool-parity-grok--kimi}

Les fournisseurs API et in-process partagent déjà les outils EYAS. Pour les fournisseurs **CLI hôte** :

| Fournisseur | Comportement |
|-------------|--------------|
| **Claude Code** | MCP in-process (existant) |
| **Grok CLI / Kimi Code CLI** | Serveur MCP stdio + pont loopback (`/api/v1/internal/cli-mcp/*`) avec secrets de courte durée ; ACP `session/new` reçoit `mcpServers` pour que l'hôte CLI puisse appeler les mêmes outils ToolExecutor |

Résultat : les CLI de codage et le chemin agent web voient une **surface d'outils cohérente** au lieu d'inventer des intégrations parallèles.

---

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [Configuration des agents](/docs/fr/agents/configure/)
- [Connexions](/docs/fr/admin/connections/)
- [Fournisseurs](/docs/fr/ai/providers/)
