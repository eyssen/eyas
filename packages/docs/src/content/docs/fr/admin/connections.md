---
title: Connexions
description: Inventaire des systèmes externes — contrôles de santé, secrets du coffre, propositions d'agents.
---

**À quoi ça sert.** Connexions (`/connections`) est l'inventaire nommé des *systèmes externes* (Odoo, GitHub, MCP, …) que les agents peuvent utiliser après votre approbation. Ce n'est pas [Canaux](/docs/fr/communication/channels/) (comptes de messagerie tels que Telegram) ni le [coffre des secrets](/docs/fr/admin/secrets/) (où les identifiants sont stockés). Le système ici ; le mot de passe ou le jeton dans Secrets ; le bot de chat sous Canaux.

**Chemin :** `/connections`.  
Sous-titre : *Systèmes externes qu'EYAS peut utiliser — inventaire, santé et propositions d'agents.*

Les connexions forment un **inventaire nommé** de systèmes externes (Odoo, GitHub, MCP, …). Les identifiants vont dans le [coffre des secrets](/docs/fr/admin/secrets/) ; les agents peuvent **proposer** une connexion pour approbation humaine au lieu de disperser la configuration entre MCP, compétences et secrets ponctuels.

---

## Onglets

| Onglet | Rôle |
|--------|------|
| **Connexions** | Inventaire actif (connecté / erreur / désactivé / inconnu) |
| **Catalogue** | Types de systèmes connus — choisissez-en un pour créer une instance |
| **En attente** | Connexions proposées par un agent, en attente d'**Approuver** / **Rejeter** |

---

## Liste des connexions

| Contrôle / champ | Signification |
|------------------|---------------|
| **N connexions** | Nombre de lignes de l'inventaire |
| **Ajouter une connexion** | Ouvrir le formulaire de création (ou partir du catalogue → **Utiliser**) |
| **Nom** | Libellé humain de cette instance |
| **Système** | Type du catalogue (Odoo, GitHub, …) |
| **Statut** | En attente / Désactivé / Connecté / Erreur / Inconnu |
| **Adaptateur** | Comment EYAS dialogue : `native`, `http` ou `mcp` |
| **Dernier contrôle** | Horodatage du dernier test de santé |
| **Erreur** | Dernier message de test / d'erreur |
| **Source** | **Utilisateur** / **Agent** / **Système** — qui l'a créée |
| **Tester** | Exécuter l'adaptateur de santé (par ex. sonde d'authentification) |
| **Modifier** | Mettre à jour le nom, la configuration, les secrets |
| **Supprimer** | Retirer la connexion (le schéma des secrets du coffre reste documenté dans Secrets) |

Vide : *Aucune connexion pour l'instant. Ajoutez-en une depuis le catalogue ou approuvez une proposition d'agent.*

---

## Formulaire de création / modification

| Champ | Signification |
|-------|---------------|
| **Nom** | Nom affiché de cette instance |
| **Type de système** | Entrée du catalogue (fixe après création dans la plupart des flux) |
| **Configuration** | Champs non secrets (URL, base, organisation, …) selon le type |
| **Secrets** | Champs sensibles — stockés dans le coffre sous `conn-{id}-{field}` ; *jamais réaffichés après l'enregistrement* |
| **Disponible pour tous les agents** | Portée par défaut lorsqu'elle est affichée |
| **Enregistrer / Annuler** | Conserver ou abandonner |

Raccourcis liés : **Paramètres MCP**, **Secrets** (le cas échéant).

---

## Types du catalogue

| Type | Adaptateur | Usage typique |
|------|------------|---------------|
| **Odoo** | native | ERP / Helpdesk JSON-RPC + outils de tickets |
| **GitHub** | http | Dépôts, issues, PR, publications |
| **GitLab** | http | Projets, issues, MR |
| **Linear** | http | API issues / projets |
| **Notion** | http | Pages et bases de données |
| **Jira** | http | Issues Atlassian Cloud |
| **Slack (API)** | http | Outils de bot d'espace de travail (le canal de discussion est distinct, sous Communication) |
| **Serveur MCP** | mcp | Lier une ligne d'inventaire à un serveur MCP déjà configuré sous [MCP](/docs/fr/ai/mcp/) |
| **Playwright MCP** | mcp | Microsoft `@playwright/mcp` optionnel (Apache-2.0, npx). Snapshot a11y + refs ; extension Playwright MCP Bridge pour un onglet vivant. Les outils arrivent par le pont MCP (`mcp_playwright_*`). Test fail-closed (Node 18+, npx). Télémétrie off. `--no-sandbox` interdit. Pas le MCP Python browser-use. |
| **Agent Browser** | mcp | Vercel `agent-browser` optionnel (Apache-2.0 CLI+MCP). Refs `@e1`, state save/load. Test fail-closed (`EYAS_AGENT_BROWSER_BIN` / PATH). Jamais `chat`, jamais le Chrome quotidien. Outils : `mcp_agent_browser_*`. |
| **Chrome DevTools MCP** | mcp | Google `chrome-devtools-mcp` optionnel (Apache-2.0 npx). Coding/debug : console, réseau, Lighthouse, WebMCP. **Pas** de remplissage de formulaire. Catalogue → Chrome DevTools MCP (`--isolated`). Test fail-closed (Node 18+, npx). `--autoConnect` et le Chrome quotidien refusés. Outils : `mcp_chrome-devtools_*`. WebMCP seulement si le sidecar les liste. |
| **HTTP personnalisé** | http | REST générique avec jeton bearer / clé API |

Intro du catalogue : *Types de systèmes connus. Choisissez-en un pour créer une instance de connexion.*

### Playwright MCP (optionnel)

Installer depuis **Paramètres → Serveurs MCP → Catalogue → Playwright MCP**, puis une ligne Connections de ce type (`mcpServerName` = `playwright`) pour que **Test** lance le doctor.

- Les outils agent passent par le pont MCP existant en `mcp_playwright_*` (snapshot a11y + refs). Pas de second boucle LLM.
- Onglet vivant : extension Playwright MCP Bridge, `--extension` à la place de `--isolated`. Jamais le profil Chrome/Edge quotidien.
- Le doctor est fail-closed comme la CLI Hyperframes : Node 18+ ou npx manquant → Test échoue avec un remède. Télémétrie off (`DO_NOT_TRACK=1`).
- Jamais `--no-sandbox` / `PLAYWRIGHT_MCP_NO_SANDBOX`. Jamais le MCP Python `browser-use` (`uvx browser-use --mcp`) — il demande une clé LLM et expose `retry_with_browser_use_agent`.

### Chrome DevTools MCP (optionnel, coding / debug)

Installer depuis **Paramètres → Serveurs MCP → Catalogue → Chrome DevTools MCP**, puis une ligne Connections (`mcpServerName` = `chrome-devtools`).

- Outils : `mcp_chrome-devtools_*`. **Pas** de remplissage de formulaire — ça reste `browser_*`.
- Catalogue : `--isolated`, télémétrie off, `--categoryExperimentalWebmcp=true`.
- WebMCP seulement si le sidecar les annonce (Chrome 150+). Les outils manquants ne sont pas inventés.
- `--autoConnect` et `--no-sandbox` font échouer Test. Jamais le profil Chrome quotidien.

Headless `browser_*`, sidecars CLI et ce MCP coding/debug : [Browser Use](/docs/fr/automation/browser-use/).

---

## Propositions en attente

Les agents peuvent appeler des outils pour **proposer** une connexion. Vous examinez le motif et la configuration dans l'onglet **En attente** :

| Contrôle | Signification |
|----------|---------------|
| **Motif** | Pourquoi l'agent souhaite cette connexion |
| **Approuver** | Créer / activer la connexion |
| **Rejeter** | Écarter la proposition |

Aucune attente : *Aucune proposition en attente.*

---

## Outils d'agent

Lorsque le module des connexions est chargé, les agents peuvent utiliser :

| Outil | Rôle |
|-------|------|
| `connections_list` | Lister l'inventaire |
| `connections_catalog` | Lister les types du catalogue |
| `connections_test` | Contrôle de santé d'une connexion |
| `connections_propose` | Proposer une nouvelle connexion à approuver |

---

## Voir aussi

- [Secrets](/docs/fr/admin/secrets/)
- [Serveurs MCP](/docs/fr/ai/mcp/)
- [Browser Use](/docs/fr/automation/browser-use/)
- [Outils](/docs/fr/automation/tools/)
- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
