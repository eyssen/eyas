// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/skills/classify-skill.ts
//
// OWNER-REVIEWABLE POLICY. Everything here is a judgement call, not mechanics.
// Two traps this rule exists to avoid:
//   1. A newly added skill has zero usage BY DEFINITION. A naive "unused for N
//      days" rule would disable every new skill on sight — hence graceDays.
//   2. A situational skill (disaster recovery, a migration) legitimately sleeps
//      for months. It is insurance; disabling it would fail at exactly the worst
//      moment — hence `situational`, which exempts a skill from TIME-based
//      proposals but NOT from evidence-based ones (orphan/shadowed).
//
// Evidence-based categories (orphan, shadowed) are facts: the file is gone, or
// another source always wins. Time-based categories (never-used, dormant) are
// inferences and are therefore the ones the exemptions guard.
import type { SkillCategory } from './types.js'

export interface ClassifyInput {
  source: string
  createdAt: string
  useCount: number
  lastUsedAt: string | null
  isShadowed: boolean
  isOrphan: boolean
  /** Marked situational via frontmatter `situational: true` or a configured category prefix. */
  situational: boolean
}

export interface ClassifyConfig {
  /** A skill younger than this is never proposed on time-based grounds. */
  graceDays: number
  /** Never used and older than this → proposed. */
  neverUsedDays: number
  /** Used once, but not since this many days → proposed. */
  dormantDays: number
  /** Sources exempt from time-based proposals (the owner made these deliberately). */
  timeExemptSources: string[]
}

export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = {
  graceDays: 30,
  neverUsedDays: 90,
  dormantDays: 180,
  timeExemptSources: ['user'],
}

export interface ClassifyResult {
  category: SkillCategory
  reason: string
  proposeDisable: boolean
}

function daysBetween(from: string, to: Date): number {
  return (to.getTime() - new Date(from).getTime()) / 86_400_000
}

export function classifySkill(input: ClassifyInput, cfg: ClassifyConfig, now: Date): ClassifyResult {
  // ── Evidence first. These are facts about the world, not inferences about
  //    intent, so no exemption applies to them.
  if (input.isOrphan) {
    return { category: 'orphan', reason: 'source file no longer exists', proposeDisable: true }
  }
  if (input.isShadowed) {
    return { category: 'shadowed', reason: 'another source always wins this id', proposeDisable: true }
  }

  const ageDays = daysBetween(input.createdAt, now)
  if (ageDays < cfg.graceDays) {
    return { category: 'new', reason: `within ${cfg.graceDays}-day grace period`, proposeDisable: false }
  }

  // ── Inference from here down. Exemptions guard this half only.
  const timeExempt = input.situational || cfg.timeExemptSources.includes(input.source)

  if (input.useCount === 0) {
    if (ageDays < cfg.neverUsedDays) {
      return { category: 'never-used', reason: 'never used, still young enough to wait', proposeDisable: false }
    }
    return {
      category: 'never-used',
      reason: `never used in ${Math.floor(ageDays)} days`,
      proposeDisable: !timeExempt,
    }
  }

  const idleDays = input.lastUsedAt ? daysBetween(input.lastUsedAt, now) : ageDays
  if (idleDays >= cfg.dormantDays) {
    return {
      category: 'dormant',
      reason: `last used ${Math.floor(idleDays)} days ago`,
      proposeDisable: !timeExempt,
    }
  }

  return { category: 'healthy', reason: `used ${input.useCount}×, last ${Math.floor(idleDays)} days ago`, proposeDisable: false }
}

/** Reads `skills.classify.*` from config, falling back per-field to the defaults. */
export function resolveClassifyConfig(config: unknown): ClassifyConfig {
  const raw = (config as any)?.skills?.classify ?? {}
  return {
    graceDays: typeof raw.graceDays === 'number' ? raw.graceDays : DEFAULT_CLASSIFY_CONFIG.graceDays,
    neverUsedDays: typeof raw.neverUsedDays === 'number' ? raw.neverUsedDays : DEFAULT_CLASSIFY_CONFIG.neverUsedDays,
    dormantDays: typeof raw.dormantDays === 'number' ? raw.dormantDays : DEFAULT_CLASSIFY_CONFIG.dormantDays,
    timeExemptSources: Array.isArray(raw.timeExemptSources) ? raw.timeExemptSources : DEFAULT_CLASSIFY_CONFIG.timeExemptSources,
  }
}
