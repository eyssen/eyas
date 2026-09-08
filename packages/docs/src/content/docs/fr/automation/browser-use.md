---
title: Browser Use
description: Outils Playwright headless pour les pages publiques, et sidecar CLI optionnel pour le Chrome déjà connecté.
---

**À quoi ça sert.** Deux surfaces. Les `browser_*` headless ouvrent des pages publiques dans le Chromium d’EYAS — contrôles numérotés, formulaires, téléchargement vers Documents. **Browser Use** (`/browser-use`) est le sidecar optionnel qui pilote **votre** Chrome réel via CDP lorsque cookies et 2FA sont déjà là. Pas de SDK LLM tiers. Le modèle reste EYAS.

**Route :** `/browser-use`. Barre : **AI → Browser Use**. Catalogue headless : [Outils](/docs/fr/automation/tools/) (`/tools`).

## Quand l’utiliser

- L’agent doit lire ou remplir une page **publique** sans votre Chrome quotidien.
- Un téléchargement doit atterrir dans [Documents](/docs/fr/knowledge/documents/) et sur la conversation.
- Vous avez besoin du Chrome **déjà connecté** — c’est le sidecar.
- Un appel a été bloqué ; vous voulez voir **Prêt** / **Pas prêt** et le remède.

## Déroulement typique

1. **Outils** (`/tools`). Recherchez `browser_`. Index plutôt que CSS, `browser_snapshot`.
2. Les ids sur l’onglet **Configuration** de l’agent. [Configurer](/docs/fr/agents/configure/).
3. Page publique : naviguer, snapshot, clic par index, nouveau snapshot après navigation.
4. Chrome connecté : **Browser Use** (`/browser-use`). Si **Pas prêt**, installez le check manquant (Python 3.11+, CLI sur PATH). Puis `browser_use_status` et `browser_use_exec`.
5. Hors navigateur : [Mains](/docs/fr/admin/hands/).

## Fonctions

### Quatre voies

| Tâche | Où | Outils |
|-------|-----|--------|
| Page publique, headless | [Outils](/docs/fr/automation/tools/) | `browser_*` — Playwright, index, profil EYAS |
| Auth persistante, `@e1` (sidecar recommandé) | cet écran, `/browser-use` | `agent_browser_status` puis `agent_browser_run` (ou `mcp_agent_browser_*`) |
| CLI Python héritée | cet écran, deuxième carte | `browser_use_status` puis `browser_use_exec` |
| Sidecar MCP a11y-ref / onglet vivant | [Connexions](/docs/fr/admin/connections/) + catalogue [MCP](/docs/fr/ai/mcp/) | `mcp_playwright_*` une fois Playwright MCP connecté |
| Coding/debug : console, réseau, Lighthouse, WebMCP | [Connexions](/docs/fr/admin/connections/) + catalogue [MCP](/docs/fr/ai/mcp/) | `mcp_chrome-devtools_*` une fois Chrome DevTools MCP connecté — **pas** de remplissage de formulaire |
| Bureau | [Mains](/docs/fr/admin/hands/) | Mains |

<h2 id="headless">Playwright headless (browser_*)</h2>

Pas de Python. Le même Chromium que l’impression design. Le **processus** dure 5 minutes ; les cookies restent sous `data/browser/profile` (ou `EYAS_BROWSER_USER_DATA_DIR`). **Jamais** le profil Chrome/Edge quotidien — Chrome 136+ refuse le CDP sur Default ; EYAS le refuse d’abord.

| Outil | Rôle |
|-------|------|
| `browser_navigate` | URL http(s). **SSRF** vers hôtes privés/metadata |
| `browser_snapshot` | Arbre d’accessibilité + liste numérotée + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | **Index** (préféré) ou CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` — pas la dernière |
| `browser_back` | Retour (invalide les index) |
| `browser_wait` | Sélecteur, URL, load ou timeout (max 30 s) |
| `browser_dialog` | Accept/dismiss **avant** le clic qui ouvre `alert`/`confirm`/`prompt` |
| `browser_upload` | Champ fichier — chemins workspace et/ou ids Documents |
| `browser_evaluate` | JavaScript **dans la page**, pas dans Node. JSON max 50k |
| `browser_download` | Prochain téléchargement → Documents, lié à la conversation |
| `browser_storage` | Sauver/charger le `storageState` Playwright |
| `browser_replay` / `browser_action_cache` | Rejouer un locator enregistré sans LLM. JSON dans le dossier projet du vault, sinon `procedural/browser-action-cache.json`. Pas Stagehand ; ni valeurs ni graines TOTP |
| `browser_totp` | TOTP 6 chiffres depuis [Secrets](/docs/fr/admin/secrets/) (ou Trousseau macOS). Passer le code à `browser_fill`. Jaune. La graine n’est jamais renvoyée |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Capture, texte, fin du process (le profil reste) |

Index et `snapshotId` meurent à la navigation. Snapshot à nouveau. Un clic/remplissage avec `intent` enregistre un locator CSS/rôle ; `browser_replay` le réutilise sur la même origine. Téléchargements sous **Documents** (`/documents`). Les appels dangereux attendent une [approbation](/docs/fr/admin/security-privacy/).

<h2 id="agent-browser">Agent Browser (sidecar recommandé)</h2>

Vercel `agent-browser` optionnel (Apache-2.0). Pas de Rust vendored. Résolution : `EYAS_AGENT_BROWSER_BIN` → PATH. Chemin défini mais absent = fail-closed. Installer : `npm i -g agent-browser` puis `agent-browser install`. Agent : `agent_browser_status` puis `agent_browser_run` avec `argv` (`["snapshot","-i"]`, `["click","@e1"]`) ou `batch`. Profil : `data/browser/agent-browser/profile`. Jamais Default / Chrome quotidien (Chrome 136+). Jamais `chat`, jamais `--no-sandbox`. MCP : catalogue **Agent Browser** (`mcp --tools core,state`) → `mcp_agent_browser_*`.

<h2 id="sidecar">CLI Python (héritée)</h2>

Le module extra enveloppe toujours la **CLI** MIT Browser Use. Pas de lib Python vendored, pas de SDK LLM. Télémétrie off. Clé Cloud seulement si vous l’activez. Jamais `--no-sandbox`. Préférez Agent Browser lorsque Prêt.

Il faut : Python 3.11+ et `browser-use` sur PATH, `uvx` ou `EYAS_BROWSER_USE_BIN`.

Si un check est **Manquant**, la CLI n’est pas prête — installez le remède, puis `browser_use_exec`. N’inventez pas d’URL CDP.

<h2 id="playwright-mcp">Playwright MCP (Connexions)</h2>

Microsoft `@playwright/mcp` optionnel (Apache-2.0). Installer depuis **Paramètres → Serveurs MCP → Catalogue**, puis éventuellement une ligne [Connexions](/docs/fr/admin/connections/) de type **Playwright MCP**. **Test** est fail-closed (Node 18+, npx), comme la CLI Hyperframes. Télémétrie off (`DO_NOT_TRACK=1`). `--no-sandbox` est retiré et refusé.

Pas de second boucle LLM. Les outils arrivent par le pont MCP existant en `mcp_playwright_*` (snapshot a11y + refs). Pour un onglet Chrome/Edge vivant : extension Playwright MCP Bridge et `--extension` (sans `--isolated`). Jamais le profil Chrome quotidien.

**Ne pas** installer le MCP Python `browser-use` (`uvx browser-use --mcp`). Il demande une clé LLM et expose `retry_with_browser_use_agent`. EYAS le refuse à l’ajout / connexion.

<h2 id="chrome-devtools-mcp">Chrome DevTools MCP (coding / debug)</h2>

Google `chrome-devtools-mcp` optionnel (Apache-2.0). Installer depuis **Paramètres → Serveurs MCP → Catalogue → Chrome DevTools MCP**, puis éventuellement une ligne [Connexions](/docs/fr/admin/connections/) de type **Chrome DevTools MCP**. **Test** est fail-closed (Node 18+, npx). Télémétrie off. `--no-sandbox` et `--autoConnect` (Chrome quotidien, Chrome 136+) sont refusés. Le catalogue utilise `--isolated`.

Ce n’est **pas** la voie formulaire. N’utilisez pas `click` / `fill` / `fill_form` de ce serveur pour un formulaire — ça reste `browser_*`. Les outils arrivent par le pont MCP en `mcp_chrome-devtools_*` (console, réseau, Lighthouse).

**WebMCP est fail-closed.** Catalogue : `--categoryExperimentalWebmcp=true`. `list_webmcp_tools` / `execute_webmcp_tool` n’apparaissent **que si le sidecar les annonce** (Chrome 150+, `--enable-features=WebMCP`). S’ils manquent, EYAS ne les invente pas.

## Champs et contrôles

<h2 id="status">Carte d’état</h2>

| Contrôle | Signification |
|----------|----------------|
| Titre | **Browser Use** |
| Sous-titre | Sidecar CLI optionnel pour votre Chrome via CDP |
| Hint de voie | `browser_*` headless public ; sidecar connecté ; Mains pour le reste |
| Badge | **Prêt** / **Pas prêt** |
| Vide | *La CLI Browser Use n’est pas prête…* |
| Ligne de check | Libellé + **OK** / **Manquant** / **Avertissement**, détail, remède |
| Aide **?** | Ouvre ce chapitre |

Cet écran ne lance pas de tâches. L’agent appelle `browser_use_exec` quand l’état est prêt.

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [Connexions](/docs/fr/admin/connections/)
- [Serveurs MCP](/docs/fr/ai/mcp/)
- [Documents](/docs/fr/knowledge/documents/)
- [Mains](/docs/fr/admin/hands/)
- [Sécurité et confidentialité](/docs/fr/admin/security-privacy/)
- [Configuration](/docs/fr/deploy/configuration/) (`EYAS_BROWSER_USER_DATA_DIR`)
