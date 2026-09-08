---
title: Configuration
description: YAML par défaut, overlays locaux, précédence env — après avoir choisi un chemin d’install.
---

**À quoi ça sert.** Adresse d’écoute, modules, autonomie, capture mémoire et verify commands sans rebuild. `local.yaml` et `EYAS_*` — pas `config/default.yaml` si tu peux l’éviter.

## Quand l'utiliser

- Hôte/port, niveau de log, désactiver un module.
- Couper le **capture par appel modèle** (`memory.capture.enabled: false`) — défaut on. Cela n’arrête **pas** la capture brute : `memory.l0.enabled` est un interrupteur distinct, lui aussi on par défaut.
- Couper la **capture brute** (`memory.l0.enabled: false`) si tu ne veux pas d’une seconde copie mot pour mot de chaque message gardée sur le disque.
- Dossiers extra de skills ou personas (`skills.importRoots` / `agent.importRoots`) sans allumer la config Claude hôte.
- `agent.verifyCommands` pour qu’une course de code ne soit pas « finie » avant les tests.
- Plusieurs checkouts Odoo via `EYAS_ODOO_SOURCES_JSON`.

## Déroulement typique

1. Crée `local.yaml`.
2. Seulement les clés nécessaires. `eyas config validate`.
3. `eyas restart` ou `eyas config reload`.
4. Paramètres + `eyas doctor`.

Précédence : flags CLI → `EYAS_*` → YAML local → YAML par défaut.

```yaml
memory:
  capture:
    enabled: true
    minUserChars: 40
    maxPerConversation: 20
```

```yaml
skills:
  importRoots: []
agent:
  importRoots: []
```

La liste livrée est vide. Chemins dans `local.yaml`. Les skills importées gagnent contre les copies bundled. L’isolation reste active. Voir [Compétences](/docs/fr/automation/skills/).

`agent.verifyCommands` sans shell. `EYAS_AUTO_FAILOVER` remplit les fallbacks de routage vides. `EYAS_BROWSER_USER_DATA_DIR` est le profil headless EYAS (jamais le Chrome quotidien). `EYAS_AGENT_BROWSER_BIN` pointe vers la CLI optionnelle agent-browser (sinon PATH ; chemin défini mais absent = fail-closed). Voir [Mémoire](/docs/fr/knowledge/memory/) et [FAQ](/docs/fr/reference/faq/).

## Capture brute (0.8.23-beta)

```yaml
memory:
  engine: legacy           # 'legacy' ou 'v2' ; le rappel est identique dans les deux cas
  l0:
    enabled: true          # false = aucune copie brute conservée
    captureToolResults: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

Ce n’est **pas** le même interrupteur que `memory.capture` ci-dessus. Le capture écrit des notes de coffre et coûte un petit appel modèle ; la capture brute garde une **seconde copie mot pour mot de chaque message persisté** — compressée et adressée par contenu — **sans appel modèle et sans coût d’API**. Elle est on par défaut.

| Clé | Défaut | Signification |
|-----|--------|---------------|
| `memory.l0.enabled` | **`true`** | Interrupteur maître de la capture brute. `false` n’enregistre rien et ne met rien en tampon. |
| `memory.l0.extractInLegacy` | **`true`** | Lance la passe déterministe (faits, résumé, entités, thèmes, importance) après chaque écriture tant que `engine` vaut encore `legacy`. `false` garde le texte brut et n’en dérive rien. |
| `memory.engine` | **`legacy`** | `legacy` ou `v2`. Aujourd’hui, cela ne conditionne que l’extraction — `v2` fait tourner la passe déterministe même quand `extractInLegacy` vaut `false`. Cela **ne change pas** ce qu’une conversation se rappelle. |
| `memory.l0.chunkTokens` | **`8000`** | Déclencheur d’écriture par taille : le tampon d’une conversation est écrit dès que son nombre de tokens estimé atteint cette valeur. |
| `memory.l0.idleFlushMinutes` | **`30`** | Déclencheur d’écriture par inactivité : un balayage à la minute écrit tout tampon resté inactif aussi longtemps. Fermer la conversation et arrêter EYAS écrivent aussi, donc un redémarrage propre ne perd rien. |
| `memory.l0.captureToolResults` | **`false`** | Capturer aussi la sortie des outils. **Lis le paragraphe suivant avant de l’activer.** |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Plafond en octets d’un seul résultat d’outil capturé, coupé sur une frontière UTF-8 avec un marqueur de troncature visible. Résultats d’outil seulement ; les messages ne sont pas plafonnés. |

**`captureToolResults` est off pour une raison.** Un résultat d’outil capturé, c’est la sortie entière, mot pour mot et non expurgée, plus 2 048 caractères tronqués des arguments de l’appel : la sortie standard de `run_command`, le contenu lu par `read_file` et un code à usage unique `browser_totp` encore valide atterrissent tous en texte clair dans la couche brute. Rien ne les masque et rien ne les chiffre au repos — la compression n’est pas de la confidentialité. Le drapeau activé, chaque démarrage logue un avertissement qui dit exactement cela. Ne l’active que là où c’est acceptable pour cette machine.

**Rien ne lit encore ces lignes.** 0.8.23-beta n’est qu’un chemin d’écriture : pas de rappel, pas de page dans l’UI, pas d’endpoint d’API, pas de commande `eyas memory`. Les prompts sont toujours assemblés depuis le coffre et les conversations passées exactement comme avant, donc mettre `memory.engine: v2` aujourd’hui ne change rien de visible.

**La capture brute grossit et rien ne l’élague.** Ni réglage de rétention, ni tâche de nettoyage dans cette version ; un message capturé coûte environ 5 Ko sur le disque, index compris. Si tu préfères ne pas payer ça tout de suite, mets `memory.l0.enabled: false`. Voir [Mémoire](/docs/fr/knowledge/memory/).

## Index de mémoire et rappel

| Clé | Défaut | Signification |
|-----|--------|---------------|
| `memory.index.budgetChars` | **`2400`** | Caractères de l’index permanent de la mémoire par tour (≈ 600 tokens). Montez-le vers 8000 quand vos notes `user` et `feedback` n’y tiennent plus. Nécessite un redémarrage. |
| `memory.recall.includeSecrets` | **`false`** | Si les notes, lignes épisodiques et compétences taguées `contains-secrets` (des fichiers où l’importateur a trouvé des identifiants, stockés tels quels) sont montrées au modèle dans l’index de mémoire, le travail connexe et `search_memory`. Désactivé, elles sont stockées et visibles sur la page Mémoire, mais n’atteignent jamais un prompt. Nécessite un redémarrage. |

## Durabilité de la base de données

Depuis la 0.8.23-beta, chaque connexion à la base EYAS exécute `PRAGMA synchronous = NORMAL` au lieu du `FULL` par défaut de SQLite. Combiné au WAL, qu’EYAS a toujours utilisé, cela veut dire :

- Un crash de **processus** — EYAS tué, une erreur non gérée — ne perd rien de ce qui est déjà commité.
- Un crash de l’**OS** ou une coupure de courant à l’instant d’un commit peut perdre la dernière transaction.

C’est le compromis WAL standard, et il vaut pour **tous** les modules, pas seulement la mémoire. Si ton instance porte du travail que tu ne peux pas ressaisir, c’est la [Sauvegarde](/docs/fr/admin/backup/) qui fait la durabilité, pas le mode de commit.

## Voir aussi

- [CLI](/docs/fr/deploy/cli/)
- [Fournisseurs](/docs/fr/ai/providers/)
- [Routage et budget](/docs/fr/ai/routing-budget/)
- [Mémoire](/docs/fr/knowledge/memory/)
