// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 dream-engine — the LLM reflection pass. Turns a day's signals into the
// digest's accomplishments / learnings / suggestions buckets, plus a 4th
// structured `improvements` channel (typed friction → fix candidates for a
// later bridge into forge/self-learning), via a cheap-tier model. Deterministic
// blockers (overdue tasks) are always present; the LLM-filled output is
// FAIL-OPEN so enabling reflection can never break the nightly job. The LLM is
// only called when there is actual activity to reflect on (a 0-token gate, in
// the spirit of the Cap 5 heartbeat).

import type { DigestBucket } from './reflection-digest.js'

export interface ReflectionSignals {
  /** Recently completed runs (sessionId + outcome + tool-name trace). */
  completedRuns: Array<{ sessionId: string; toolNames: string[]; success: boolean }>
  /** Short recent episodic memory snippets. */
  recentMemories: string[]
  /** Number of overdue tasks (deterministic blocker signal). */
  overdueCount: number
}

/**
 * A typed, actionable friction surfaced by the reflection pass — e.g. a tool
 * that keeps failing, a skill worth authoring, a prompt worth tightening.
 * Exported for the improvement bridge (routes candidates into forge/self-learning).
 */
export interface ImprovementCandidate {
  target: 'tool' | 'skill' | 'prompt'
  targetId: string
  friction: string
  suggestion: string
  confidence: number
  evidenceSessions: string[]
}

/** Result of a reflection pass: the digest buckets plus structured improvements. */
export interface ReflectionBuildResult {
  buckets: DigestBucket[]
  improvements: ImprovementCandidate[]
}

export interface ReflectionEngineDeps {
  /** Cheap-tier LLM call: prompt → raw text reply. */
  summarize: (prompt: string) => Promise<string>
  logger?: { warn?: (m: string) => void; debug?: (m: string) => void }
  /** Max items kept per LLM-filled bucket. Default 5. */
  maxItemsPerBucket?: number
  /**
   * Runtime gate for the `memory.reflection` Phase-3 loop feature flag
   * (security-gate/autonomy-features.ts), read FRESH by the caller at fire
   * time and passed in here. Defaults to `true` so existing callers/tests
   * that predate the flag are unaffected — the production wiring
   * (memory/index.ts) always passes the live, OFF-by-default value.
   * `false` skips the model pass entirely (same shape as a missing model).
   */
  modelPassEnabled?: boolean
}

const REFLECTION_SECTIONS: Array<{ key: keyof ParsedReflection; bucketIndex: number }> = [
  { key: 'accomplishments', bucketIndex: 0 },
  { key: 'learnings', bucketIndex: 2 },
  { key: 'suggestions', bucketIndex: 3 },
]

interface ParsedReflection {
  accomplishments?: string[]
  learnings?: string[]
  suggestions?: string[]
  improvements?: unknown
}

const VALID_TARGETS = new Set(['tool', 'skill', 'prompt'])

/** Tolerant validation of the model's `improvements` channel — drops malformed entries, never throws. */
function sanitizeImprovements(raw: unknown, maxItems: number): ImprovementCandidate[] {
  if (!Array.isArray(raw)) return []
  const out: ImprovementCandidate[] = []
  for (const item of raw.slice(0, maxItems)) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.target !== 'string' || !VALID_TARGETS.has(c.target)) continue
    if (typeof c.targetId !== 'string' || !c.targetId.trim()) continue
    if (typeof c.friction !== 'string' || !c.friction.trim()) continue
    if (typeof c.suggestion !== 'string' || !c.suggestion.trim()) continue
    const confidence = typeof c.confidence === 'number' && Number.isFinite(c.confidence)
      ? Math.min(1, Math.max(0, c.confidence))
      : 0
    const evidenceSessions = Array.isArray(c.evidenceSessions)
      ? c.evidenceSessions.filter((s): s is string => typeof s === 'string')
      : []
    out.push({
      target: c.target as ImprovementCandidate['target'],
      targetId: c.targetId.trim(),
      friction: c.friction.trim(),
      suggestion: c.suggestion.trim(),
      confidence,
      evidenceSessions,
    })
  }
  return out
}

function emptyBuckets(): DigestBucket[] {
  return [
    { key: 'accomplishments', title: 'Accomplishments', items: [] },
    { key: 'blockers', title: 'Blockers', items: [] },
    { key: 'learnings', title: 'Learnings', items: [] },
    { key: 'suggestions', title: 'Suggestions', items: [] },
    { key: 'external', title: 'External', items: [] },
  ]
}

export function buildReflectionPrompt(signals: ReflectionSignals): string {
  const runs = signals.completedRuns
    .slice(0, 20)
    .map((r) => `- run ${r.sessionId.slice(0, 8)} [${r.success ? 'ok' : 'error'}]: ${r.toolNames.join(' → ') || '(no tools)'}`)
    .join('\n')
  const memories = signals.recentMemories.slice(0, 20).map((m) => `- ${m}`).join('\n')
  return [
    'You are a concise daily-reflection assistant for an autonomous agent system.',
    'Summarise the day below into FOUR JSON channels. Reply with ONLY a JSON object',
    'of the shape {"accomplishments":[],"learnings":[],"suggestions":[],"improvements":[]}.',
    'accomplishments/learnings/suggestions are each an array of short, specific',
    'one-line strings (max 5 each). improvements is an array (max 5) of objects',
    '{"target":"tool"|"skill"|"prompt","targetId":string,"friction":string,',
    '"suggestion":string,"confidence":0-1,"evidenceSessions":string[]} — only',
    'include one when a run above errored or a clear recurring friction is',
    'evident; evidenceSessions references the run ids above. No prose, no markdown.',
    '',
    `## Completed runs\n${runs || '(none)'}`,
    '',
    `## Recent notes\n${memories || '(none)'}`,
  ].join('\n')
}

/** Tolerant JSON extraction — strips markdown fences, returns {} on any failure. */
export function parseReflection(raw: string): ParsedReflection {
  if (!raw) return {}
  let text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()
  else {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first >= 0 && last > first) text = text.slice(first, last + 1)
  }
  try {
    const obj = JSON.parse(text)
    if (!obj || typeof obj !== 'object') return {}
    return obj as ParsedReflection
  } catch {
    return {}
  }
}

export async function buildReflectionBuckets(
  signals: ReflectionSignals,
  deps: ReflectionEngineDeps,
): Promise<ReflectionBuildResult> {
  const buckets = emptyBuckets()
  const maxItems = deps.maxItemsPerBucket ?? 5
  let improvements: ImprovementCandidate[] = []

  // Deterministic blockers — always reliable, independent of the LLM.
  if (signals.overdueCount > 0) buckets[1].items.push(`${signals.overdueCount} overdue task(s)`)

  // 0-token gate: only spend an LLM call when there is real activity.
  const hasActivity = signals.completedRuns.length > 0 || signals.recentMemories.length > 0
  if (!hasActivity) return { buckets, improvements }

  // Feature-flag gate (Task 10): OFF skips the model pass, same as a missing model.
  if (deps.modelPassEnabled === false) return { buckets, improvements }

  try {
    const raw = await deps.summarize(buildReflectionPrompt(signals))
    const parsed = parseReflection(raw)
    for (const { key, bucketIndex } of REFLECTION_SECTIONS) {
      const items = parsed[key]
      if (Array.isArray(items)) {
        for (const item of items.slice(0, maxItems)) {
          const s = String(item).trim()
          if (s) buckets[bucketIndex].items.push(s)
        }
      }
    }
    improvements = sanitizeImprovements(parsed.improvements, maxItems)
  } catch (err) {
    deps.logger?.warn?.(`reflection LLM pass failed (fail-open): ${String(err)}`)
  }

  return { buckets, improvements }
}
