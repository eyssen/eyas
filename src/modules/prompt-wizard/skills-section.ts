// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/skills-section.ts
//
// The assembled system prompt's skills section: one line per enabled skill,
// on every turn, for every agent.
//
// This is the widest D-7 consumer there is (P-19 / A-29): a skill's line reaches
// every turn of every agent with no match and no click, and an imported skill's
// frontmatter DESCRIPTION can hold a credential exactly as its body can. That is
// what makes the gate necessary, and it is extracted from the module's onStart
// closure so the gate has a test.
//
// The `?? s.content` fallback below is dead through the loader as it stands:
// `skill-loader.ts:68` maps `description: raw.description ?? ''`, and every
// insert and update writes `''`, so a description-less skill arrives with an
// empty string and `??` (null/undefined only) never reaches the content. Left
// as-is because making it live would change what every turn's prompt carries,
// which is a prompt-content decision rather than a D-7 one — but if anyone does
// switch it to `||`, the body head starts reaching the model and this gate is
// what keeps a flagged skill's body out of it.

import { recallableSkills } from '@modules/skills/recallable.js'

export interface SkillSectionLine {
  name: string
  oneLine: string
}

/** How much of a description-less skill's body stands in for its description. */
const ONE_LINE_CHARS = 120

interface SkillsServiceLike {
  loader?: { list?: (enabled?: boolean) => Array<{
    name?: string
    description?: string
    content?: string
    capabilities?: string[]
  }> }
  recall?: () => { includeSecrets: boolean }
}

/**
 * The enabled skills a prompt may name. A missing service, a missing loader or
 * a throwing loader all mean "no skills section", never a failed turn; a
 * missing `recall` accessor means the exclusion applies.
 */
export function resolveSkillSectionLines(svc: SkillsServiceLike | undefined | null): SkillSectionLine[] {
  if (!svc?.loader?.list) return []
  try {
    const enabled = recallableSkills(svc.loader.list(true) ?? [], svc.recall?.().includeSecrets ?? false)
    return enabled.map((s) => ({
      name: s.name ?? '',
      oneLine: (s.description ?? s.content ?? '').slice(0, ONE_LINE_CHARS),
    }))
  } catch {
    return []
  }
}
