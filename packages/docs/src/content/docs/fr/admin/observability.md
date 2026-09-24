---
title: Observabilité et opérations
description: Télémétrie des tokens, traces, coût, courses God Mode, coût du contexte du prompt et transmission de la mémoire par fournisseur.
---

**À quoi ça sert.** L'observabilité (`/observability`) est la surface de télémétrie de cette instance : traces, coût, latence, anomalies, courses d'ensemble (God Mode), ce que le modèle a *réellement* reçu, et avec quelle égalité chaque fournisseur a reçu la mémoire d'EYAS. **Ops** (`/ops`) sert à la remédiation. Les mains, les nœuds distants, les extensions et les préférences de notification ne sont **pas** sur cette page — elles ont leurs propres chapitres.

| Domaine | Chemin | Signification |
|---------|--------|---------------|
| Observabilité | `/observability` | Page **Observabilité IA** (barre latérale **Observabilité**) — onglets **Utilisation**, **God Mode**, **Contexte** |
| Ops | `/ops` | Agent ops Kubernetes — observer → diagnostiquer → proposer → approuver → appliquer. Par défaut **proposer seulement**. L'URL du cluster, le kubeconfig et le dépôt GitOps relèvent de la configuration de l'instance, pas des valeurs par défaut du produit. |

Ailleurs (pas sur cette page) : [Mains](/docs/fr/admin/hands/) (`/hands`), [Nœuds distants](/docs/fr/admin/nodes/) (`/nodes`) — y compris l'invocation SSH surveillée, [Ingress](/docs/fr/admin/ingress/) (`/ingress`), [Extensions](/docs/fr/admin/extensions/) (`/extensions`), [Notifications](/docs/fr/admin/notifications/) (`/notifications-settings`).

## Quand l'utiliser

- Vous voulez savoir ce que coûtent les appels IA, par jour et par modèle, et lesquels relevaient du travail d'arrière-plan d'EYAS lui-même.
- Un tour a été lent, coûteux ou a utilisé des outils, et vous voulez sa trace.
- Vous voulez noter des réponses, ou voir comment une course God Mode a été tranchée.
- Vous voulez voir ce qui est vraiment entré dans le prompt, quelles sections ont été coupées et de combien l'estimation des tokens dévie.
- Vous voulez vérifier que chaque fournisseur — modèles d'API comme CLI — a reçu la même mémoire.

## Déroulement typique

1. Ouvrez **Observabilité** dans la barre latérale (`/observability`).
2. Sur **Utilisation**, affinez le tableau des traces avec **Modèle**, **Du**, **Au** et **Finalité** ; notez une trace avec le pouce levé / baissé en fin de ligne.
3. Ouvrez **God Mode** pour les courses d'ensemble et les taux de victoire.
4. Ouvrez **Contexte** et commencez par **Transmission de la mémoire par fournisseur**, puis les cartes des moyennes par section, de la troncature et de l'estimé vs réel.

## Fonctions

<h3 id="usage-tab">Onglet Utilisation</h3>

**Utilisation** est la télémétrie des tokens : les cartes **Traces totales**, **Coût total**, **Latence moyenne** et **Anomalies**, **Coût quotidien**, **Répartition des modèles**, **Anomalies actives**, et le tableau des traces — **Horodatage**, **Modèle**, **Fournisseur**, **Finalité**, **Tokens**, **Coût**, **Latence**, **Outils**, **Qualité** — avec les filtres **Modèle**, **Du**, **Au** et **Finalité** au-dessus.

**Modèle et « a répondu ».** La colonne **Modèle** garde l'identifiant de modèle que vous avez choisi, pour que les libellés et la tarification restent stables. Quand le fournisseur a rapporté un autre modèle concret — une version datée du modèle, le choix d'un routeur comme OpenRouter auto, le modèle chargé dans Ollama ou LM Studio, le modèle que Grok a réellement exécuté —, une seconde ligne affiche *a répondu : &lt;modèle&gt;*. Les exécutions de capture mémoire en arrière-plan sont elles aussi attribuées à ce modèle concret.

**Effort.** La trace de chaque appel IA enregistre l'effort de raisonnement demandé, l'effort réellement utilisé après ajustement au modèle, et l'origine de la demande (conversation, Profond, collègue, conversation qui délègue, niveau de routage, défaut du modèle, …). Voir [Fournisseurs — Effort de raisonnement](/docs/fr/ai/providers/#reasoning-effort).

**Finalité.** Un appel modèle d'arrière-plan — un appel qu'EYAS fait pour lui-même, pas un tour de conversation — affiche son groupe de finalité dans la colonne **Finalité** :

| Libellé | Appels d'arrière-plan |
|---------|-----------------------|
| **Mémoire** | Capture mémoire, consolidation nocturne, briefing de réflexion, enrichissement des imports Data Port |
| **Apprentissage** | Heartbeat, Auto-apprentissage, Forge, écriture de compétences |
| **Titres** | Titres automatiques |
| **Contrôles de sécurité** | Juge de sécurité, critique de complétude, planificateur de grille |
| **Planification** | Propositions d'équipe, re-planificateur entre les phases |
| **Recherche** | Exécutions de recherche |
| **Triage** | Le classifieur du routage automatique |

Un tour de conversation (un tour de chat ou d'agent normal) affiche *—*, tout comme les traces des versions qui n'enregistraient pas encore la finalité. Le filtre **Finalité** propose **Tous les appels** (par défaut) ou un groupe ; un groupe ne liste que ses appels d'arrière-plan (les tours de conversation n'y correspondent jamais), et changer le filtre ramène à la première page. Chaque appel d'arrière-plan est tracé comme un tour de conversation — fournisseur, modèle, tokens, coût, latence, effort demandé et effectif (origine *niveau de routage*) — et son coût compte dans les plafonds quotidien, hebdomadaire et mensuel du budget, comme les tours de conversation. Un appel d'arrière-plan qui n'a pas pu tourner faute de modèle éligible ne fait aucun appel modèle, ne laisse aucune trace et ne coûte rien. Les appels de titre automatique sont attribués à leur conversation. Où partent les appels de chaque groupe : [Routage et budget — Appels de modèle en arrière-plan](/docs/fr/ai/routing-budget/#background-model-calls-card).

**Outils.** La colonne **Outils** compte les appels d'outils d'une trace de la même façon chez tous les fournisseurs : un appel que le modèle a rendu à EYAS pour exécution, et un appel qu'une CLI a exécuté dans sa propre boucle — Claude Code, Grok CLI et Kimi Code CLI —, qu'il s'agisse d'un outil intégré de la CLI (shell, lecture de fichier, …) ou d'un outil EYAS qu'elle a appelé par le pont EYAS. Chaque appel compte une fois. Les versions précédentes affichaient 0 pour chaque tour de CLI.

**Qualité.** La colonne **Qualité** est votre propre note : le pouce levé / baissé en fin de ligne marque la trace comme *bonne* ou *mauvaise*. EYAS ne note pas les traces automatiquement ; un nombre dans cette colonne provient d'une trace enregistrée par une version plus ancienne.

**Les compteurs de tokens ont le même sens sur tous les fournisseurs.** Les tokens d'*entrée* sont les tokens du prompt qui n'ont **pas** été servis depuis le cache du fournisseur ; les lectures en cache (et, sur Anthropic, les écritures en cache) sont comptées à part. Les versions précédentes incluaient la part en cache dans les tokens d'entrée pour la famille OpenAI et Gemini : leurs chiffres d'entrée sur les conversations très mises en cache sont donc plus petits aujourd'hui, et la part en cache apparaît en lectures de cache. Les tokens de raisonnement ou de réflexion font partie des tokens de *sortie* ; les tokens de réflexion de Gemini manquaient auparavant, donc les compteurs de sortie de Gemini pour les modèles à réflexion sont plus élevés. Les tokens de raisonnement d'OpenAI et de réflexion de Gemini sont aussi enregistrés à part comme tokens de raisonnement, à titre d'information seulement — ils ne sont pas facturés deux fois. Les compteurs de Grok CLI et Kimi Code CLI suivent le même sens. Si un fournisseur n'envoie aucun usage (certains serveurs compatibles, un serveur Ollama sans compteurs, une CLI dont le runtime n'a rien rapporté), le tour est marqué *non rapporté* au lieu d'être stocké comme un vrai zéro ; la conversation affiche *Utilisation non communiquée* et l'arbre d'exécution *—* au lieu de 0 $. Sur l'API Anthropic, la mise en cache du prompt est automatique : les tokens de lecture et d'écriture en cache apparaissent donc pour ces appels (voir [Fournisseurs — Mise en cache du prompt](/docs/fr/ai/providers/#prompt-caching-anthropic-api)).

**Coût.** Quand un fournisseur rapporte son propre coût, la trace l'utilise. Sinon, EYAS l'estime à partir des compteurs de tokens, en tarifant chaque token du prompt une seule fois : l'entrée non mise en cache au tarif d'entrée, les lectures de cache au tarif de lecture de cache du modèle, les écritures de cache à son tarif d'écriture de cache. Si la table de prix (ou une surcharge `model.pricing` dans la configuration) n'a pas de tarif de cache pour un modèle, ses tokens en cache sont facturés au tarif d'entrée normal. Un appel dont l'usage est *non rapporté* n'est jamais tarifé d'après des compteurs de tokens : son coût est celui que le fournisseur a lui-même rapporté, ou 0 $. Par rapport aux versions précédentes :

- Kimi K3 via l'API Kimi, et tout modèle avec un tarif de lecture de cache dans une surcharge `model.pricing` : les estimations sont plus basses, car la part en cache n'est plus comptée deux fois.
- OpenAI et Gemini avec la table intégrée : le coût d'entrée ne change pas.
- Modèles Gemini à réflexion : les estimations sont plus élevées, car les tokens de réflexion sont facturés en sortie.
- Points de terminaison compatibles Anthropic absents de la table : les tokens en cache sont facturés au tarif d'entrée de repli prudent au lieu d'être gratuits.
- Exécutions Claude Code pour lesquelles la CLI n'a rapporté aucun coût mais bien des compteurs de tokens : les tokens de cache sont tarifés aux tarifs de cache Anthropic correspondants au lieu d'être gratuits.

Rien à configurer ni à migrer : les nouvelles colonnes de trace sont ajoutées automatiquement.

**API (admins et intégrateurs).** `GET /api/v1/observability/traces` (et `/traces/:id`) exige le droit de lecture du journal d'audit (read `AuditEntry`). En plus des colonnes ci-dessus, chaque trace porte :

- `purpose` (la finalité exacte, par exemple `capture`, `title`, `security_judge`, `triage`), `auxRoute` (comment le modèle a été choisi : `tier` = le niveau de routage de la finalité, `default` = le défaut de l'installation, `api` = un fournisseur d'API, `isolated-cli` = une CLI capable de tourner isolée) et `purposeGroup` — les trois sont null pour les tours de conversation ;
- `toolCalls` — une liste JSON des appels, chacun `{name, id}`, plus `executedBy` (`provider` ou `eyas`) pour un appel que la CLI a réglé dans sa propre boucle ;
- `memoryTiersUsed` — les comptes JSON de la mémoire rappelée dans ce tour, par couche : `vt` note du vault, `gs` résumé, `ft` fait, `en` entité, `ep` épisode, `rw` enregistrement brut, par exemple `{"vt":75,"gs":5,"ft":3}`. Il vaut null quand le tour ne portait aucune mémoire, et pour les appels sans composition de contexte (appels d'arrière-plan).

La liste accepte `purposeGroup=memory|learning|title|safety|planning|research|triage`. La requête est validée : un `purposeGroup` inconnu, un `limit` non numérique ou hors plage (1–500), un `offset` négatif ou un `minCost` non numérique ou négatif renvoie `400` au lieu d'être ignoré ; les paramètres vides comptent comme absents.

<h3 id="god-mode-tab">Onglet God Mode</h3>

L'onglet **God Mode** liste les exécutions d'ensemble (conversation, gagnant, nombre de modèles, coût, durée, égalité départagée ou non), le taux de victoire par modèle et le multiple de coût moyen par rapport à un seul modèle. Cliquez sur une exécution pour ouvrir l'onglet God de la conversation (journal des étapes, qui a voté pour qui, et les commentaires de chaque modèle sur les autres).

Comment une course est montée, comment le gagnant est choisi et comment lire l'onglet God de la conversation : [Conversations — Mode Dieu](/docs/fr/daily/conversations/#mode-dieu).

<h3 id="context-tab">Onglet Contexte</h3>

L'onglet **Contexte** montre ce que le modèle a *réellement* reçu, pas ce qu'on voulait envoyer. Il commence par **Transmission de la mémoire par fournisseur** (ci-dessous), suivie de :

- **Estimé vs réel** — l'écart entre l'estimation de tokens d'EYAS et ce que le fournisseur a rapporté, avec l'erreur absolue moyenne ;
- **Tokens moyens par section** — le coût moyen et maximal en tokens de chaque section du prompt, et le nombre d'échantillons sur lequel il repose ;
- **Fréquence de troncature** — à quelle fréquence, et quelle section, est coupée pour tenir dans le budget.

Les enregistrements détaillés par section sont de courte durée par conception (7 jours par défaut, `observability.contextRetentionDays`) ; seul le cumul quotidien survit à long terme. Si vous cherchez un détail ancien sans le trouver, c'est normal, pas une perte de données.

<h4 id="memory-delivery-by-provider">Transmission de la mémoire par fournisseur</h4>

Cette carte montre, par fournisseur, si ses tours ont reçu la même mémoire EYAS — la vérification qu'un modèle d'API et une CLI reçoivent la mémoire de la même manière. Choisissez la période en haut à droite : **7 derniers jours**, **30 derniers jours** ou **90 derniers jours**. Il y a une ligne par fournisseur ayant répondu à des tours sur la période ; après un basculement, un tour compte pour le fournisseur qui a réellement répondu.

| Colonne | Signification |
|---------|---------------|
| **Fournisseur** | L'identifiant du fournisseur. Cliquez dessus pour voir ses derniers tours |
| **Tours avec mémoire** | *N sur M* : les tours dont le message portait de la mémoire rappelée, sur l'ensemble de ses tours |
| **Éléments par couche (moy.)** | Le nombre moyen d'éléments de mémoire injectés par couche, sur les tours avec mémoire, sous forme de badges de code de couche (`vt`, `gs`, `ft`, `en`, `ep`, `rw`) ; survolez un badge pour voir le nom de la couche |
| **Tokens de mémoire (moy.)** | La moyenne des estimations de tokens propres aux éléments injectés, sur les tours avec mémoire |
| **Consultations de la mémoire par tour** | *X appels · Y éléments*, en moyenne sur tous les tours : les appels `memory_search` / `memory_expand` que le modèle a faits lui-même et qui ont lu quelque chose, et les éléments de mémoire lus par ces appels |

Cliquer sur un fournisseur liste ses 10 derniers tours : l'heure (un lien qui ouvre la conversation), le modèle, les éléments par couche ou *pas de mémoire*, les tokens de mémoire et les consultations (*appels · éléments*, ou seulement *éléments* pour les tours enregistrés avant que les numéros d'appel soient journalisés).

**Comment comparer les fournisseurs.** Des valeurs proches pour **Tours avec mémoire** et **Éléments par couche (moy.)** signifient que chaque modèle a reçu la même mémoire. **Consultations de la mémoire par tour** montre si un modèle ouvre aussi la mémoire lui-même : une CLI avec nettement moins de consultations que les modèles d'API n'atteint pas, ou n'utilise pas, les outils de mémoire d'EYAS.

La carte est construite à partir du détail de composition du contexte : elle ne remonte donc pas plus loin que `observability.contextRetentionDays` (7 jours par défaut). **30 derniers jours** et **90 derniers jours** n'en montrent davantage que si cette rétention est augmentée. Un tour dont le rappel n'a pas été journalisé élément par élément compte comme un tour, mais sans éléments.

**API.** `GET /api/v1/observability/memory-parity?days=N` — `N` est un entier de 1 à 90 (7 par défaut) ; il faut le même droit read `AuditEntry` que pour les autres points de terminaison d'observabilité, et un `days` invalide renvoie `400`. La réponse est `{days, since, providers: [{provider, turns, memoryTurns, avgItemsByLayer, avgItems, avgMemoryTokens, drillDownTurns, avgDrillDownCalls, avgDrillDownReads, recentTurns: [{compositionId, createdAt, conversationId, model, hasMemory, itemsByLayer, items, memoryTokens, drillDownCalls, drillDownReads}]}]}`.

<h4 id="single-turn-composition">La composition d'un seul tour</h4>

La composition d'un seul tour s'ouvre depuis la barre de contexte de la conversation — voir [Conversations — Composition du contexte](/docs/fr/daily/conversations/#context-composition) : le remplissage mesuré ou estimé de la fenêtre, les badges de confidentialité par section et l'encadré **Mémoire transmise**. `GET /api/v1/observability/compositions/:id` renvoie la même chose : `composition.egress` et un `egress` par section (`{masked, spans, skipped}`) pour ce que la couche de confidentialité a fait ; `composition.delivery` (turnId, profile, budgetTotalTokens, recall — ids, hits, retrieved, expanded, chars, budgetChars, tokens, budgetTokens, withheld — et systemPromptChannel) ; et `composition.drillDown` (`{calls, reads, limit}`). Chacun est null quand rien n'a été enregistré ; `drillDown` est aussi null quand le journal d'accès mémoire est illisible. Le point de terminaison de liste est inchangé. Dans le journal d'accès mémoire, les lignes de rappel et les lignes de consultation d'un tour partagent un même identifiant de tour (l'identifiant de la composition), et les lignes de consultation enregistrent le numéro de l'appel dans le tour.

## Voir aussi

- [Mission Control](/docs/fr/agents/runs/)
- [Routage et budget](/docs/fr/ai/routing-budget/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [Instances multiples](/docs/fr/deploy/multi-instance/)
- [Sécurité](/docs/fr/admin/security-privacy/)
- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
- [Mains](/docs/fr/admin/hands/)
- [Nœuds distants](/docs/fr/admin/nodes/)
- [Extensions](/docs/fr/admin/extensions/)
- [Notifications](/docs/fr/admin/notifications/)
