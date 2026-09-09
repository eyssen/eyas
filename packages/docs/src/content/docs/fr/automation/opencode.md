---
title: OpenCode
description: Sidecar optionnel du moteur de code (MIT) avec terminal web dans la conversation.
---

**À quoi ça sert.** OpenCode est un agent de code en terminal (MIT, [opencode.ai](https://opencode.ai)). EYAS **n’importe pas** son noyau privé ni ses SDK d’IA. Voie officielle : serveur HTTP local (`opencode serve` sur 127.0.0.1) et PTY POSIX vers xterm.js. Le chat hydrate la mémoire EYAS ; `opencode_run` envoie la tâche. Vous pouvez regarder ou prendre le TUI.

**Route :** `/opencode`. Barre : **IA → OpenCode**. Dans la conversation, l’icône terminal.

## Quand

- La tâche de code doit tourner dans la boucle OpenCode.
- Vous voulez **voir** le TUI ou taper dedans.
- OpenCode doit lire la mémoire EYAS et renvoyer diffs/stdout en L0.

## Déroulement

1. Ouvrir **OpenCode** (`/opencode`). Pas prêt : installer le CLI ou `EYAS_OPENCODE_BIN`.
2. Accorder `opencode_status` / `opencode_run`.
3. Dans la conversation, l’icône terminal.
4. Demander `opencode_run`. Mémoire d’abord, capture ensuite.

OpenCode utilise **sa propre auth fournisseur** (`opencode auth login` dans le TUI).

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [Conversations](/docs/fr/daily/conversations/)
