// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ScanCandidate, SourceProfile } from '../types.js'

const MAX_INSTRUCTIONS_CHARS = 4000

/** Normalize optional free-text user guidance for import. */
export function normalizeInstructions(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim().slice(0, MAX_INSTRUCTIONS_CHARS)
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Keyword hints extracted from free-text instructions.
 * Used to re-rank scan candidates without requiring an LLM at scan time.
 */
export interface InstructionHints {
  raw: string
  tokens: string[]
  wantsMemory: boolean
  wantsSkills: boolean
  wantsRules: boolean
  wantsIdentity: boolean
  mentionsObsidian: boolean
  mentionsClaude: boolean
  mentionsGrok: boolean
  mentionsCursor: boolean
  pathHints: string[]
}

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'that', 'this',
  'there', 'their', 'they', 'have', 'has', 'had', 'van', 'vannak', 'és',
  'az', 'egy', 'hogy', 'meg', 'már', 'csak', 'nem', 'igen', 'under', 'over',
  'into', 'also', 'some', 'any', 'all', 'my', 'own', 'user', 'please',
  'look', 'find', 'search', 'import', 'should', 'would', 'could', 'might',
])

export function parseInstructionHints(instructions: string): InstructionHints {
  const lower = instructions.toLowerCase()
  const tokens = lower
    .replace(/[^\p{L}\p{N}\s._/-]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t))

  const unique = [...new Set(tokens)]

  const pathHints = unique.filter(
    (t) =>
      t.includes('/') ||
      t.includes('obsidian') ||
      t.includes('vault') ||
      t.includes('memory') ||
      t.includes('skill') ||
      t.includes('claude') ||
      t.includes('grok') ||
      t.includes('cursor') ||
      t.includes('ai-memory') ||
      t.includes('session'),
  )

  return {
    raw: instructions,
    tokens: unique,
    wantsMemory:
      /\b(memor(y|ies)|emlék|memória|session|vault|jegyzet|note)\b/i.test(instructions),
    wantsSkills:
      /\b(skill|készség|skillek|procedure|recept|how-?to)\b/i.test(instructions),
    wantsRules:
      /\b(rule|rules|szabály|claude\.md|agents\.md|cursorrules)\b/i.test(instructions),
    wantsIdentity:
      /\b(identity|soul|persona|személyiség|voice)\b/i.test(instructions),
    mentionsObsidian: /\bobsidian\b/i.test(instructions),
    mentionsClaude: /\bclaude\b/i.test(instructions),
    mentionsGrok: /\bgrok\b/i.test(instructions),
    mentionsCursor: /\bcursor\b/i.test(instructions),
    pathHints,
  }
}

/**
 * Re-rank / re-select scan candidates using optional user instructions.
 * Never invents candidates — only adjusts confidence, selection, and reasons.
 */
export function applyInstructionHints(
  candidates: ScanCandidate[],
  instructions: string | null,
): ScanCandidate[] {
  if (!instructions) return candidates
  const hints = parseInstructionHints(instructions)
  if (hints.tokens.length === 0) return candidates

  return candidates.map((c) => {
    if (c.kind === 'noise') return c

    const path = c.relativePath.toLowerCase()
    const hay = `${path} ${c.title.toLowerCase()} ${c.preview.toLowerCase()} ${c.kind}`
    let boost = 0
    const matched: string[] = []

    for (const token of hints.tokens) {
      if (hay.includes(token)) {
        boost += 0.06
        if (matched.length < 6) matched.push(token)
      }
    }

    for (const hint of hints.pathHints) {
      if (path.includes(hint) || hay.includes(hint)) {
        boost += 0.1
      }
    }

    if (hints.mentionsObsidian && (path.includes('obsidian') || path.includes('vault') || path.includes('ai-memory'))) {
      boost += 0.15
      matched.push('obsidian')
    }
    if (hints.mentionsClaude && (path.includes('claude') || path.includes('.claude'))) {
      boost += 0.15
      matched.push('claude')
    }
    if (hints.mentionsGrok && (path.includes('grok') || path.includes('.grok'))) {
      boost += 0.15
      matched.push('grok')
    }
    if (hints.mentionsCursor && (path.includes('cursor') || path.includes('.cursor'))) {
      boost += 0.12
      matched.push('cursor')
    }

    // Kind alignment with stated goals
    if (hints.wantsMemory && c.kind === 'memory') boost += 0.12
    if (hints.wantsSkills && c.kind === 'skill') boost += 0.12
    if (hints.wantsRules && c.kind === 'rule') boost += 0.1
    if (hints.wantsIdentity && c.kind === 'identity') boost += 0.1

    // Soft demotion when user was specific about kinds and this is unrelated unknown
    if (
      (hints.wantsMemory || hints.wantsSkills) &&
      c.kind === 'unknown' &&
      boost < 0.08
    ) {
      boost -= 0.1
    }

    if (boost === 0) return c

    const confidence = Math.min(0.98, Math.max(0.05, c.confidence + boost))
    const selectedByDefault =
      c.target !== 'none' &&
      c.kind !== 'noise' &&
      (c.selectedByDefault || boost >= 0.12)

    const reasonExtra =
      matched.length > 0
        ? ` Matches instructions (${[...new Set(matched)].slice(0, 4).join(', ')})`
        : boost > 0
          ? ' Matches user instructions'
          : ''

    return {
      ...c,
      confidence,
      selectedByDefault,
      reason: `${c.reason}${reasonExtra}`.trim(),
    }
  })
}

/** Infer a better source profile from instructions when user left "auto". */
export function inferProfileFromInstructions(
  current: SourceProfile,
  instructions: string | null,
): SourceProfile {
  if (!instructions || current !== 'auto') return current
  const h = parseInstructionHints(instructions)
  if (h.mentionsObsidian) return 'obsidian'
  if (h.mentionsClaude) return 'claude-code'
  if (h.mentionsCursor) return 'cursor'
  return current
}
