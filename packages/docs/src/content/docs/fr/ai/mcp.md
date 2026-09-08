---
title: Serveurs MCP
description: Model Context Protocol — serveurs actifs, catalogue et parité d’outils CLI.
---

**À quoi ça sert.** MCP branche des *boîtes à outils externes*. Les outils découverts s’affectent comme les builtins. Ce n’est pas un [canal](/docs/fr/communication/channels/) de chat ni une [Connexion](/docs/fr/admin/connections/) — tu peux toutefois enregistrer un serveur MCP comme Connexion.

**Route :** `/mcp-settings`. Onglets : **Actifs** · **Catalogue**. Barre : **Serveurs MCP**.

## Quand l'utiliser

- Des outils qu’EYAS ne livre pas.
- Install en un clic (clé API) plutôt que de taper une commande.
- Le CLI Grok/Kimi doit voir la même surface ToolExecutor.
- Serveur déconnecté — **Tester**.

## Déroulement typique

1. **Serveurs MCP**.
2. **Catalogue** : prêt / un clic / manuel.
3. **Installer** ou **Ajouter un serveur MCP** (stdio/HTTP/SSE).
4. **Actifs** : connected, **Tester**, outils/ressources/prompts découverts.
5. Ids dans **Configuration** de l’agent.

Copyleft/proprietary tournent en **processus séparé** — EYAS reste MIT. Parité CLI : Claude Code MCP in-process ; Grok/Kimi stdio MCP + pont `/api/v1/internal/cli-mcp/*`.

**Authentification :** aucune / Bearer (clé API) / OAuth (navigateur). Le transport **SSE** est le Streamable HTTP — pas de suffixe `/sse` ; EYAS gère l’en-tête de session.

Magnific, Higgsfield et fal se branchent sous [Médias](/docs/fr/ai/media/) ; l’agent utilise cinq outils `media_*` au lieu des catalogues MCP bruts du vendeur.

**Chrome DevTools MCP** (Google, Apache-2.0) est une ligne de catalogue **DevTools** : `npx -y chrome-devtools-mcp@latest --isolated`, télémétrie off, `--categoryExperimentalWebmcp=true`. Coding/debug seulement (console, réseau, Lighthouse, WebMCP) — **pas** de remplissage de formulaire. Outils : `mcp_chrome-devtools_*`. WebMCP seulement si le sidecar les annonce. `--autoConnect` et le profil Chrome quotidien sont refusés. Voir [Browser Use](/docs/fr/automation/browser-use/#chrome-devtools-mcp).

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [Médias](/docs/fr/ai/media/)
- [Configurer les agents](/docs/fr/agents/configure/)
- [Connexions](/docs/fr/admin/connections/)
- [Fournisseurs](/docs/fr/ai/providers/)
