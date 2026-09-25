---
title: Architecture (renvoi)
description: Où se trouvent les spécifications techniques, et les règles transversales sur lesquelles s’appuie le reste de ce manuel.
---

La documentation utilisateur s’arrête ici. Pour les implémenteurs :

| Chemin | Contenu |
|--------|---------|
| `docs/eyas-architecture.md` | L’architecture modulaire complète |
| `docs/superpowers/specs/` | Spécifications de conception |
| `docs/superpowers/plans/` | Plans d’implémentation |
| `CHANGELOG.md` | Versions |

Ne traitez pas ces fichiers comme des manuels destinés aux utilisateurs finaux. Les sections ci-dessous résument les règles valables chez tous les fournisseurs — modèles API, Claude Code CLI, Grok CLI, Kimi Code CLI, runtimes locaux et OpenCode — et renvoient aux pages qui les expliquent.

## Couche de souveraineté de la mémoire {#memory-sovereignty-layer}

EYAS est la seule mémoire d’un modèle. Un modèle ne la lit que par le bloc de rappel joint à son message et par les outils `memory_search` / `memory_expand`. Il n’écrit jamais la mémoire — c’est EYAS qui l’enregistre — et il ne peut atteindre aucune mémoire hors d’EYAS, par aucun canal :

```text
L'appel d'outil d'un modèle arrive par l'un de ces canaux :
  1. Outils EYAS dans la boucle d'agent propre à EYAS (fournisseurs API)
  2. Outils EYAS que Grok CLI et Kimi Code CLI appellent par le pont d'outils
  3. Les outils intégrés de Claude Code (un contrôle avant leur exécution)
     et les demandes d'autorisation de Claude Code
  4. Les demandes d'autorisation de Grok / Kimi, et les fichiers qu'ils
     lisent ou écrivent via EYAS
                         |
                         v
        UNE politique de chemins. Elle protège :
          - la mémoire des autres outils d'IA
          - les coffres Obsidian
          - les chemins de security.foreignMemoryPaths
          - le dossier de données d'EYAS (vault, base de données, clés, connexions CLI)
          - les espaces de travail des autres conversations
                         |
             +-----------+-----------+
             v                       v
       refus ferme                autorisé
   (pas de juge IA, pas d'approbation,
    ne compte pas pour le blocage,
    une ligne dans Événements de sécurité)

Sous le shell propre des CLI, le sandbox de fichiers du système
d'exploitation bloque les mêmes endroits (Claude Code et Grok CLI ;
Kimi Code CLI n'en a pas).

Mémoire entrante :  le bloc <eyas-memory> + memory_search / memory_expand
Mémoire sortante :  écrite uniquement par EYAS
```

Les tâches headless d’OpenCode passent le même contrôle, et le modèle d’OpenCode ne lit la mémoire que par ces deux mêmes outils.

- Où la politique s’applique et ce qu’on répond au modèle : [Sécurité et confidentialité — Mémoire hors d’EYAS](/docs/fr/admin/security-privacy/#memory-outside-eyas).
- Comment elle est prouvée sur les vraies CLI avant chaque publication : [Sécurité et confidentialité — Comment l’isolation est prouvée](/docs/fr/admin/security-privacy/#how-isolation-is-proven).
- Ce que le modèle reçoit à la place : [Mémoire — Comment fonctionne le rappel](/docs/fr/knowledge/memory/#how-recall-works) et [La mémoire hors d’EYAS est refusée](/docs/fr/knowledge/memory/#memory-outside-eyas-is-refused).

## Transmission de la mémoire {#memory-delivery}

La mémoire rappelée atteint chaque modèle de la même façon, par chaque point d’entrée.

- **Un seul producteur.** L’assembleur de prompt est le seul endroit où le rappel est produit, par un unique service de rappel. Le chat, les exécutions d’arrière-plan et planifiées, les exécutions du bot du tableau, les workers de God Mode, les spécialistes et agents délégués, les membres d’équipe, les réponses sur les canaux, les passations entre collègues et les tâches OpenCode passent tous par lui. La requête de rappel est construite par le service lui-même à partir de la conversation, si bien que chaque chemin cherche de la même façon.
- **Un seul emplacement.** Le runner d’agent joint le bloc du tour — la date et l’heure courantes, puis le bloc de rappel — au message utilisateur courant au moment d’envoyer la requête. Le message enregistré ne change jamais, et une exécution reprise reçoit un bloc neuf au lieu de l’ancien. Rien de ce qui change d’un tour à l’autre ne se trouve dans le prompt système ; il reste donc identique et peut être mis en cache (automatique sur l’API Anthropic).
- **Dimensionné pour le modèle.** Le profil de transmission de chaque tour vient d’un seul résolveur de fenêtre : la fenêtre du modèle dans le catalogue, sinon la fenêtre connue du fournisseur CLI, sinon 200k jetons. Les budgets sont fixés pour une fenêtre de 100k jetons — la part du bloc de rappel y est `memory.index.budgetChars`, 2 400 caractères par défaut — et suivent la fenêtre : jusqu’à 2,5× à partir de 250k jetons, tandis qu’en dessous de 100k le budget du prompt ne prend jamais plus de 35 % de la fenêtre. L’identité maîtresse et les règles ne sont jamais coupées.
- **Des noms pour l’hôte.** Les noms d’outils sont canoniques, et chaque indication les nomme comme l’hôte du modèle les liste : `memory_search` chez les fournisseurs API, `mcp__eyas__memory_search` dans Claude Code, `use_tool` avec `eyas__memory_search` dans Grok CLI, et `memory_search` sur le serveur MCP `eyas` dans Kimi Code CLI. Un modèle qui ne peut pas appeler d’outils ne reçoit ni outils ni indication d’approfondissement, et obtient jusqu’à quatre notes en texte intégral au lieu de deux.
- **Approfondissement.** `memory_search` et `memory_expand` permettent ensemble 3 appels par tour, chez tous les fournisseurs. EYAS résout leur périmètre de projet sur le serveur à partir de la conversation, jamais à partir d’un argument d’outil.
- **Public.** La mémoire du propriétaire n’est pas poussée vers des lecteurs extérieurs. Les tâches de pairs A2A et les réponses sur les canaux à la voix externe — ou dont la voix ne peut être déterminée — ne reçoivent que la date et l’heure, et le tour enregistre que le rappel a été retenu. Les outils mémoire eux-mêmes restent soumis au portail de sécurité.
- **Visible.** Chaque tour enregistre ce qu’il a reçu : dans l’encadré **Mémoire transmise** de sa composition du contexte, et dans `memoryTiersUsed` de sa trace. La carte **Transmission de la mémoire par fournisseur** d’**Observabilité → Contexte** compare les fournisseurs. Voir [Conversations — Composition du contexte](/docs/fr/daily/conversations/#context-composition) et [Observabilité et opérations](/docs/fr/admin/observability/#memory-delivery-by-provider).

## Une liaison, un périmètre d’outils, une seule façon de lancer des spécialistes {#binding-tools-specialists}

- **Une liaison de modèle par tour.** Chaque tour tourne sur le modèle auquel sa conversation est liée — un modèle fixe, le modèle par défaut du collègue ou l’auto-routage. La liaison est connue avant l’assemblage du prompt, si bien que sa taille et ses noms d’outils sont faits pour ce modèle. Un modèle que vous avez choisi n’est jamais remplacé en silence ; un modèle qu’EYAS a fixé de lui-même se rabat avec une note. Voir [Conversations — Quel modèle répond](/docs/fr/daily/conversations/#which-model-answers).
- **Une seule façon de lancer des spécialistes.** Les spécialistes passent toujours par EYAS avec `run_specialist`, chez tous les fournisseurs, sous forme de sous-conversations avec leur propre exécution supervisée. L’outil de sous-agents propre à Claude Code n’est pas proposé. Voir [Équipes et délégation](/docs/fr/agents/teams/).
- **Un périmètre d’outils.** Un agent reçoit sa liste d’outils plus `memory_search` et `memory_expand` (une liste vide signifie tous les outils), et le mode Solo retire les outils de délégation. Le même périmètre vaut sur chaque chemin d’exécution et chez chaque fournisseur, y compris pour les outils EYAS qu’une CLI atteint par le pont ; un appel hors de ce périmètre est refusé. Voir [Créer et configurer — Outils et contraintes](/docs/fr/agents/configure/#tools--constraints).

## Effort de raisonnement et versions de CLI prouvées {#effort-and-cli-versions}

- **Effort.** Le niveau est déterminé par modèle, au moment où un modèle répond — de nouveau après un routage, une nouvelle tentative ou un repli — et ajusté à ce que ce modèle prend en charge. Chaque fournisseur ne fait que le traduire en son propre paramètre, et un modèle sur lequel EYAS n’a pas de faits vérifiés n’en reçoit aucun. Claude Code CLI, Grok CLI et Kimi Code CLI rapportent le niveau avec lequel ils ont réellement tourné. Voir [Fournisseurs — Comment chaque fournisseur applique le niveau d’effort](/docs/fr/ai/providers/#effort-by-provider).
- **Versions de CLI prouvées.** L’isolation des CLI est vérifiée au démarrage de chaque session, et chaque version de CLI est prouvée avant publication par la vérification de publication (`bun run test:live-cli`). `eyas doctor` compare le binaire installé avec la dernière version prouvée. Voir [Fournisseurs — Versions de CLI prouvées](/docs/fr/ai/providers/#proven-cli-versions).

## Observabilité chez tous les fournisseurs {#observability-on-every-provider}

- **Appels d’outils, comptés une fois.** Une trace compte les appels que le modèle a rendus à EYAS pour exécution et ceux qu’une CLI a réglés dans sa propre boucle — ses outils intégrés et les outils EYAS via le pont —, chacun une fois, de la même façon chez tous les fournisseurs.
- **Les outils lancés par une CLI sont journalisés, pas relancés.** Un outil qu’une CLI a lancé elle-même reçoit une ligne dans le journal d’exécution des outils sous son nom canonique, avec son exécution. EYAS ne l’exécute ni ne l’autorise une seconde fois, et rien du journal ne passe dans la mémoire : seul `memory.l0.captureToolResults` décide si la sortie des outils est enregistrée en mémoire. Voir [Outils — Journal d’exécution des outils](/docs/fr/automation/tools/#tool-execution-log).
- **La mémoire par tour.** Les traces portent `memoryTiersUsed`, les éléments rappelés comptés par préfixe d’identifiant de mémoire, et `GET /api/v1/observability/memory-parity` agrège le rappel et les approfondissements par fournisseur ayant répondu. Voir [Observabilité et opérations](/docs/fr/admin/observability/#usage-tab).
- **Les appels de modèle d’EYAS lui-même.** Le travail d’arrière-plan — titres, capture mémoire, juge de sécurité, … — tourne sur le modèle d’arrière-plan et est tracé et compté dans le budget comme un tour de conversation. Voir [Routage et budget — Le modèle d’arrière-plan](/docs/fr/ai/routing-budget/#background-model).

## Pour les contributeurs {#for-contributors}

- **Appels de modèle.** Le code backend n’appelle directement la passerelle de modèles que depuis une courte liste relue : le runner d’agent, la route de streaming du chat, les routes de l’API des modèles, le tracing, la passerelle elle-même et quelques appels interactifs isolés à usage unique (Plan d’abord, le relecteur de God Mode, Design). Le travail d’arrière-plan passe par le service du modèle d’arrière-plan. `tests/modules/model/no-direct-model-calls.test.ts` échoue sur tout autre appel direct.
- **Ce manuel.** L’anglais est la source, et les cinq traductions gardent les mêmes titres dans le même ordre. Un titre traduit garde l’ancre anglaise grâce au suffixe `## Titre {#english-id}`, si bien que les liens `/docs/<lang>/<page>/#<id>` et les hashes d’aide de l’application fonctionnent dans toutes les langues, et que le titre reste dans la table des matières de la page. Un identifiant contenant `--` ne survit pas au passage typographique, qui s’exécute avant ; un tel titre utilise un `<h3 id="…">` brut. Un seul test, `tests/contracts/handbook-locale-parity.test.ts`, échoue quand une page listée diverge entre les langues (titres, ancres, forme du titre, lignes de tableau) ou quand un lien du manuel pointe vers une ancre que sa page n’a pas. Structure et ton des pages : `packages/docs/PAGE_TEMPLATE.md`.
