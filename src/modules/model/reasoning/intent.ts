// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Which effort a run asks for, from the chain of conversations it belongs to
// (D4 precedence). The first link is the run's own conversation, the rest are
// its delegating parents, nearest first:
//   1. the conversation's own effort                → source 'conversation'
//   2. the conversation is Deep                     → 'max', source 'deep'
//   3. the conversation's agent has an effort       → source 'agent'
//   4. the first parent that resolves one by 1–3    → that level, source 'inherited'
// Nothing anywhere → undefined: the tier default or the model's own default
// applies (the gateway decides, after routing).
//
// Pure. Stored values are untrusted: anything that is not exactly a ladder
// rung is skipped (never guessed into one), and 'auto' means "not set here".

import { normalizeEffortSetting, type EffortIntent, type EffortLevel } from './ladder.js'

/** One conversation of the chain, as stored (values unvalidated). */
export interface EffortChainLink {
  /** The conversation's effort column. */
  effort?: unknown
  /** The conversation's orchestration mode ('deep' defaults effort to max). */
  orchestration?: unknown
  /** The effort of the agent the conversation runs as. */
  agentEffort?: unknown
}

/** A stored level that is exactly a rung; 'auto', null and garbage are "not set". */
function levelOf(value: unknown): EffortLevel | null {
  return normalizeEffortSetting(value) ?? null
}

/** A link's own level and the rule that supplied it, or null. */
function ownIntent(link: EffortChainLink): EffortIntent | null {
  const conversation = levelOf(link.effort)
  if (conversation) return { level: conversation, source: 'conversation' }
  if (link.orchestration === 'deep') return { level: 'max', source: 'deep' }
  const agent = levelOf(link.agentEffort)
  if (agent) return { level: agent, source: 'agent' }
  return null
}

export function pickEffortIntent(chain: ReadonlyArray<EffortChainLink | null | undefined>): EffortIntent | undefined {
  const [self, ...parents] = chain
  if (self) {
    const own = ownIntent(self)
    if (own) return own
  }
  for (const parent of parents) {
    if (!parent) continue
    const inherited = ownIntent(parent)
    if (inherited) return { level: inherited.level, source: 'inherited' }
  }
  return undefined
}
