---
title: Assistant de configuration
description: Assistant du premier démarrage — chaque étape, champ et commande expliqués.
---

**À quoi ça sert.** Au premier démarrage uniquement. L’assistant crée le mot de passe maître, le propriétaire principal, vos deux agents principaux et un premier backend de modèles pour que l’application principale se déverrouille. Ensuite, modifiez ces éléments dans **Paramètres**, **Fournisseurs** et **Agents** — ne comptez pas relancer l’assistant.

## Quand l’utiliser

- Le navigateur vous a envoyé vers `/setup` parce que la configuration est incomplète
- Vous avez sauté une étape facultative et voulez la liste des champs
- Vous restaurez une instance neuve

Pas pour les changements quotidiens une fois l’application ouverte.

## Déroulement typique

L’assistant s’exécute **une fois** tant que la configuration est incomplète. Le navigateur est redirigé vers `/setup` jusqu’à ce que les étapes obligatoires soient terminées. Les étapes facultatives peuvent être ignorées et complétées plus tard dans les Paramètres.

Commandes présentes à chaque étape :

| Commande | Signification |
|----------|---------------|
| **Langue** | Langue de l’interface (`en` / `hu` / `de` / `es` / `fr` / `tlh`). Enregistrée dans le réglage de langue du navigateur. |
| **Apparence** | Gabarit de thème (p. ex. Halo, Nebula) + bascule clair/sombre. |
| *Étape N sur M* | Progression dans les étapes restantes. |
| **Continuer / Terminer l'installation** | Valider l’étape en cours et avancer. |

## Ordre des étapes (typique)

| Ordre | Étape | Obligatoire | Module |
|------:|-------|-------------|--------|
| — | Apparence / langue (cadre de l’interface) | — | frontend |
| 1 | **Mot de passe maître** | Oui | secrets |
| 2 | **Propriétaire principal** | Oui | auth |
| 3 | Agents principaux (*Vos deux coéquipiers IA toujours actifs*) | Oui | auth |
| 4 | **Agents d'équipe** | Non | auth |
| 5 | **Fournisseur d'IA** | En général | model |
| 6 | **Modèles d'IA** | En général | model |

L’enregistrement est modulaire — les modules enregistrent leurs étapes au démarrage. Les étapes obligatoires doivent être terminées avant que l’application principale se déverrouille.

## Mot de passe maître

**Objet :** chiffrer au repos tous les secrets stockés (clés d’API, jetons).

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| **Mot de passe maître** | Oui | Phrase secrète pour le matériel de clé du chiffrement des secrets. Choisissez-la solide ; si vous la perdez, il faudra ressaisir les clés des fournisseurs. |
| **Confirmer le mot de passe** | Oui | Doit correspondre au mot de passe maître. |

Après cette étape, les secrets saisis dans l’interface passent par le coffre chiffré Secrets.

## Propriétaire principal

**Objet :** créer l’administrateur humain principal (`role: owner`, `is_root_owner`).

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| **Nom d'utilisateur** | Oui | Identifiant de connexion (espace réservé : `admin`). Doit être unique. |
| **Mot de passe** | Oui | Mot de passe du compte (haché ; jamais stocké en clair). |
| **Nom affiché** | Non | Nom convivial dans l’interface (par défaut le nom d’utilisateur). |

L’assistant garde les identifiants du owner **en mémoire** pour le reste de la session, afin que les étapes facultatives qui exigent un owner authentifié puissent s’exécuter sans nouvelle connexion. Si vous rechargez en cours d’assistant alors qu’il ne reste que des étapes facultatives, vous pouvez être envoyé vers **Connexion**, puis revenir sur `/setup`.

## Agents principaux

**Objet :** créer les deux **collègues** toujours disponibles à qui vous parlez (barre latérale **Collègues**, un fil d’accueil chacun). À l’écran : *Vos deux coéquipiers IA toujours actifs*.

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| **Assistant personnel — votre coéquipier IA au quotidien** | Oui | Nom affiché de votre agent du quotidien (p. ex. Jarvis). Niveau : principal, type : assistant. Rattaché au type de projet **general**. |
| **Ingénieur système — maintient EYAS en bon état** | Oui | Nom affiché de l’agent qui maintient EYAS lui-même (p. ex. R2D2). Niveau : principal, type : ingénieur. Rattaché au type de projet **eyas**. |

Pour chacun sont créés :

- une ligne `agent_definitions` (modèle, outils, chemin de l’espace de travail, …)
- une arborescence d’espace de travail sous `data/agents/<id>/` (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- un enregistrement lié d’**utilisateur agent** (`is_agent = 1`) pour les permissions et l’adressage

Vous pourrez les renommer et les reconfigurer plus tard sous **Agents**. Après l’assistant, ouvrez-les depuis la liste **Collègues** de la barre latérale. L’Assistant coordonne et ne modifie pas le code source ; l’Ingénieur est responsable de la plateforme et du code. Voir [Équipes et délégation](/docs/fr/agents/teams/).

## Agents d’équipe (facultatif)

**Objet :** activer des **collègues** supplémentaires (niveau équipe) et des **spécialistes** (pool partagé que tout collègue peut lancer). Les agents principaux n’ont pas besoin de carte de proposition pour appeler un spécialiste activé.

| Commande | Description |
|----------|-------------|
| **Recommandé** | Ensemble de modèles mis en avant pour une installation typique. |
| **Spécialistes** | Catalogue complet des modèles d’agents facultatifs. |
| **Tout sélectionner / Tout désélectionner** | Sélection groupée. |
| *N sélectionné(s)* | Nombre de modèles choisis. |
| **Ignorer / Continuer** | Terminer sans spécialistes, ou appliquer la sélection. |

La sélection est enregistrée comme identifiants de modèles et transformée en vrais agents (même schéma d’espace de travail que les principaux). Modifiez-la plus tard sous **Paramètres → Agents**.

## Fournisseur d’IA

**Objet :** s’assurer qu’au moins un backend de modèles est disponible.

### CLI de l’hôte (si détectées)

| Commande | Description |
|----------|-------------|
| Badge (*Claude Code détecté et configuré* / *CLI Grok …* / *CLI Kimi Code …*) | CLI locale trouvée et utilisable — **pas de clé d’API**. Pour Claude, *détecté et configuré* signifie que l’environnement Claude Code démarre **et est connecté** (connexion claude.ai, `ANTHROPIC_API_KEY` ou configuration Bedrock/Vertex) ; que `claude` soit simplement dans le PATH ne suffit pas. Voir [Fournisseurs — Environnement Claude Code](/docs/fr/ai/providers/#claude-code-runtime). |
| **Se connecter pour EYAS** (Grok / Kimi) | Affiché dès que Grok CLI ou Kimi Code CLI est détecté. EYAS exécute ces CLI dans son propre dossier et n’utilise pas leur connexion sur cet ordinateur ; connectez-vous donc une fois pour EYAS ici : **Se connecter avec un code d'appareil** (les deux) — ouvrez le lien sur n’importe quel appareil et confirmez le code, sans navigateur sur le serveur — ou **Utiliser plutôt une clé d'API** (Grok, une clé d’API xAI). Voir [Fournisseurs — Connecter Grok et Kimi pour EYAS](/docs/fr/ai/providers/#sign-in-grok-and-kimi-for-eyas). |
| **CLI principal** | Affiché quand plusieurs CLI sont détectées : laquelle est le défaut pour les agents et le routage. Elle devient le fournisseur et le modèle par défaut de l’installation, qui répondent aussi aux appels internes ne nommant aucun modèle quand aucun niveau Standard n’est défini — voir [Routage et budget](/docs/fr/ai/routing-budget/#default-binding). |
| **Utiliser un autre fournisseur** | Passer à la configuration d’une API cloud ou locale. |
| **Retour aux CLI détectés** | Revenir à la vue CLI. |

### Fournisseurs manuels / d’API

| Commande | Description |
|----------|-------------|
| Liste des fournisseurs | Backends connus (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **Actif / Inactif** | Si le fournisseur est activé pour le routage. |
| **Configurer / Changer la clé** | Ouvrir la saisie de la clé d’API. |
| Champ de clé d’API (*Saisissez la clé API…*) | Secret ; enregistré dans le coffre chiffré Secrets. |
| **Enregistrer** | Enregistrer la clé et rendre le fournisseur utilisable. |
| **Revérifier** | Re-sonder un point d’accès local (p. ex. l’URL d’Ollama). |
| **Continuer / Terminer l'installation** | Avancer même si aucun n’est actif (vous pourrez terminer plus tard dans Paramètres → Fournisseurs) — voir la note à l’écran. |

## Modèles d’IA

**Objet :** attribuer un modèle concret à chaque agent une fois un fournisseur prêt.

| Commande | Description |
|----------|-------------|
| Colonne **Agent** | Nom de l’agent issu des étapes précédentes. |
| Colonne **Modèle** | Liste déroulante des modèles des fournisseurs actifs, chacun sous la forme *Fournisseur / modèle* (le plus adapté présélectionné) ; **— aucun —** laisse le modèle de l’agent tel quel. |
| **Appliquer** | Enregistrer les attributions. Chacune est envoyée et enregistrée comme la paire fournisseur + modèle choisie, si bien qu’un identifiant de modèle que listent deux fournisseurs n’est jamais ambigu ; une paire absente du catalogue de modèles est ignorée. |
| **Aller aux fournisseurs** | Aller à la page complète des Fournisseurs si rien n’est configuré. |
| **Terminer l'installation** | Terminer l’assistant et entrer dans l’application principale. |

Si aucun fournisseur n’est détecté (*Aucun fournisseur d'IA détecté*), configurez-en un sur la page Fournisseurs après l’assistant.

## Après l’assistant

| Destination | Pourquoi |
|-------------|----------|
| [Votre première heure](/docs/fr/first-hour/) | Parcourir l’interface en direct : Accueil, une conversation, Tableau, Mémoire |
| [Accueil](/docs/fr/daily/home/) | Recommandations de configuration pour le travail facultatif restant |
| [Fournisseurs](/docs/fr/ai/providers/) | Ajouter des backends, des clés, des modèles |
| [Agents](/docs/fr/agents/overview/) | Passer en revue collègues et spécialistes |
| [Équipes et délégation](/docs/fr/agents/teams/) | Comment les collègues passent le relais et lancent des spécialistes |
| [Utilisateurs](/docs/fr/admin/users/) | Ajouter des utilisateurs humains (en multi-utilisateur) |

## Notes de sécurité

- Le mot de passe maître protège les **secrets** ; à lui seul, il ne chiffre pas le fichier SQLite au repos — protégez le disque de l’hôte et les sauvegardes.
- Le mot de passe du propriétaire principal est indépendant du mot de passe maître.
- Les « utilisateurs » agents ne sont pas des connexions interactives pour des humains ; ils existent pour l’identité et le contrôle d’accès.
