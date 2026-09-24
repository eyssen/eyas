// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/skills/recallable.ts
//
// D-7 / P-19 on the skill side. The data-port importer stores a bundled asset
// that holds a credential verbatim and inlines it into the skill body, marking
// the skill with the `contains-secrets` capability. A skill only reaches the
// model through the matcher, so this is where the key is kept out of a prompt:
// one 'apply' click on a proposed skill would otherwise paste it into the
// system prompt in full.

import { SECRETS_TAG } from '@modules/memory/memory-index.js'

/**
 * The skills a matcher may see. `includeSecrets` is
 * `memory.recall.includeSecrets` — the same flag the memory index, related
 * work and `search_memory` read, so the owner has one switch, not four.
 */
export const recallableSkills = <T extends { capabilities?: string[] }>(
  skills: T[],
  includeSecrets: boolean,
): T[] => (includeSecrets ? skills : skills.filter((s) => !(s.capabilities ?? []).includes(SECRETS_TAG)))
