---
title: Votre première heure
description: Première heure guidée dans l’interface en cours — Accueil, une conversation, une carte du tableau, et où vit la mémoire.
---

**À quoi ça sert.** L’installation et l’[assistant de configuration](/docs/fr/setup-wizard/) sont faits. Cette heure parcourt le produit en direct pour que vous sachiez où le travail commence, où on le suit, et comment les faits tiennent. Ce n’est pas une liste de champs.

## Quand l’utiliser

- Vous pouvez vous connecter et l’application principale est ouverte
- Vous voulez une conversation utile, pas une visite de chaque écran
- Vous devez voir comment **Accueil**, **Tableau**, **Mémoire** et **Agents** s’emboîtent

## Connectez-vous et atterrissez sur Accueil

Ouvrez l’interface (par défaut **http://localhost:3100**). Saisissez le **Nom d'utilisateur** et le **Mot de passe** du propriétaire racine créés dans l’assistant, puis cliquez sur **Connexion**.

Vous atterrissez sur **Accueil** (`/`). Tout le monde part de la même grille d’usine jusqu’à ce que vous la personnalisiez.

Regardez d’abord trois tuiles :

- **Pouls** — vous attend, en cours, en attente, coût aujourd’hui, tâches échouées
- **Nécessite votre attention** — approbations, travail coincé, agents en attente, retards ; vous pouvez agir depuis la tuile
- **Agents en cours** — activité en direct ; **Mettre en pause**, **Reprendre** ou **Arrêter**

Une bande de configuration recommandée peut rester au-dessus de la grille. Ignorez-la pendant cette heure.

## Commencez une conversation

Dans la barre latérale, cliquez sur **Nouvelle conversation**. L’état vide dit **Commencez une conversation…**.

Tapez une demande vraiment utile — comment on doit travailler avec vous, une décision, ou une tâche à suivre. Le compositeur : **Saisissez un message… (Shift+Enter pour un saut de ligne)**. Envoyez.

Observez le flux : **Réflexion** ou **Réflexion…**, puis **Rédaction de la réponse…** ou **Outils en cours…**. Les lignes d’outils montrent l’id, un aperçu d’arguments et le résultat — les éditions de fichier ouvrent un **Diff**. **Arrêter** annule l’exécution. L’icône carte du compositeur est **Plan d’abord**.

Laissez le fil ouvert. Ensuite, il va sur le tableau.

## Mettez-le sur le Tableau

Ouvrez **Tableau** dans la barre latérale (`/board`). Les conversations sont des cartes. La vôtre y est souvent déjà, avec le titre du fil (ou **Sans titre**).

- Épinglez-la pour qu’elle reste sur la bande d’épingles (**Épinglé**).
- Ou cliquez sur **Nouveau**, saisissez un **Titre de la conversation…**, et créez une carte liée à un fil.

Vous avez maintenant un endroit pour parler et un endroit pour suivre le même travail.

## Où vit la mémoire

Ouvrez **Mémoire** (`/memory`). Commencez par **Aperçu**, puis **Fichiers du coffre**.

Depuis 0.8.16-beta, un fait durable énoncé dans n’importe quelle conversation peut devenir une note du coffre **sans que vous le demandiez**. La capture est globale et activée par défaut. Elle s’exécute après la livraison de la réponse — jamais sur le chemin critique de la réponse. Les tours courts et le bavardage ne produisent en général rien ; c’est correct.

Vous ne verrez peut-être pas de nouveau fichier dans la première minute. Revenez à **Fichiers du coffre** après un échange plus long et dense en faits, ou écrivez une note à la main. Les agents peuvent toujours enregistrer la mémoire exprès.

## Rencontrez vos agents principaux

Ouvrez **Agents** (`/agents`). Filtrez **Principal**. Ce sont les deux coéquipiers que vous avez nommés dans l’assistant : l’**Assistant personnel** (le quotidien) et l’**Ingénieur système** (EYAS lui-même). Ils restent ; les conversations vont et viennent.

Pas besoin de créer d’autres agents cette heure-ci.

## Quoi apprendre ensuite

- [Conversations](/docs/fr/daily/conversations/) — compositeur, rails, effort, orchestration
- [Tableau](/docs/fr/daily/board/) — cartes, étapes, vues
- [Vue d’ensemble des agents](/docs/fr/agents/overview/) — niveaux, types, liste
- [Mémoire](/docs/fr/knowledge/memory/) — cinq niveaux et notes du coffre
- [Compétences](/docs/fr/automation/skills/) — procédures réutilisables que les agents peuvent charger
- [Outils](/docs/fr/automation/tools/) — catalogue en direct ; cherchez `browser_` pour Playwright headless
- [Browser Use](/docs/fr/automation/browser-use/) — public vs Chrome connecté vs Mains
- [Concepts fondamentaux](/docs/fr/concepts/) — le modèle mental, une fois que vous avez cliqué un peu partout
