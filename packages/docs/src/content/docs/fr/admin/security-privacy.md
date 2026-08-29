---
title: Sécurité et confidentialité
description: Portail de sécurité, flux d’événements, journal d’audit et scan PII — avant et après les outils.
---

**À quoi ça sert.** Trois surfaces. Le **portail de sécurité** autorise, refuse ou escalade un appel *avant* qu’il s’exécute. **Événements de sécurité** (`/security`) est le flux. **Audit** (`/audit`) le journal immuable. **Confidentialité** (`/privacy`) est le PII — le même sanitizer que le capture de mémoire durable fait tourner *avant* l’écriture vault.

## Quand l'utiliser

- Un appel a été refusé — checkpoint, risque, motif.
- Les outils navigateur ne doivent pas toucher les hôtes privés/metadata (SSRF). Le profil headless appartient à EYAS (`data/browser/profile`), jamais le Chrome quotidien (Chrome 136+). Les index meurent à la navigation. `evaluate` dans la page seulement. `browser_totp` est jaune (graine dans Secrets/Trousseau ; le code va à `browser_fill`). Le cache d’actions stocke des locators, pas des secrets.
- Tu vas activer l’autonomie et tu veux voir ce que le portail escalade.
- PII dans les logs, notes vault ou prompts sortants.

## Déroulement typique

1. **Sécurité** (`/security`) : Allow/Deny/Escalate.
2. **Audit** (`/audit`) : qui, module, résultat, coût. Rollback avec confirmation.
3. **Confidentialité** (`/privacy`) : stats, **Tester le scanner PII**.
4. Avec [Autonomie](/docs/fr/agents/autonomy/) et [Secrets](/docs/fr/admin/secrets/).
5. SSH : [Nœuds](/docs/fr/admin/nodes/) — les motifs destructeurs demandent un force flag.

Interrupteur de capture : `memory.capture.enabled` (défaut **on**). Voir [FAQ](/docs/fr/reference/faq/).

## Voir aussi

- [Autonomie](/docs/fr/agents/autonomy/)
- [Utilisateurs](/docs/fr/admin/users/)
- [Outils](/docs/fr/automation/tools/)
- [Observabilité](/docs/fr/admin/observability/)
- [Nœuds](/docs/fr/admin/nodes/)
- [Mémoire](/docs/fr/knowledge/memory/)
