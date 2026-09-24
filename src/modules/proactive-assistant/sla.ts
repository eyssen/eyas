// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Wave 2 — SLA / escalation helpers for the proactive assistant.
 *
 * Detects board conversations that are overdue or aging past WIP limits and
 * produces structured escalation targets (owner agent, channel, human).
 */

export interface SlaCandidate {
  conversationId: string
  title: string
  projectId?: string
  agentId?: string
  stage?: string
  dueAt?: string | null
  updatedAt?: string | null
  ageHours: number
  reason: 'overdue' | 'stale' | 'wip_aging'
}

export interface SlaPolicy {
  /** Hours without update before a card is stale (default 48). */
  staleHours: number
  /** Hours past due before hard overdue (default 0 = any past due). */
  overdueGraceHours: number
}

export const DEFAULT_SLA_POLICY: SlaPolicy = {
  staleHours: 48,
  overdueGraceHours: 0,
}

export interface SlaSignal {
  breaches: SlaCandidate[]
  count: number
}

/**
 * Pure function: score board rows into SLA breaches.
 * `now` injectable for tests.
 */
export function evaluateSla(
  rows: Array<{
    id: string
    title?: string
    name?: string
    project_id?: string
    agent_id?: string
    stage?: string
    stage_name?: string
    due_at?: string | null
    due_date?: string | null
    updated_at?: string | null
    status?: string
  }>,
  policy: SlaPolicy = DEFAULT_SLA_POLICY,
  now: Date = new Date(),
): SlaSignal {
  const breaches: SlaCandidate[] = []
  const nowMs = now.getTime()

  for (const r of rows) {
    if (r.status === 'archived' || r.status === 'done' || r.status === 'completed') continue
    const title = r.title ?? r.name ?? r.id
    const dueRaw = r.due_at ?? r.due_date
    const updatedRaw = r.updated_at
    const updatedMs = updatedRaw ? Date.parse(updatedRaw) : NaN
    const ageHours = Number.isFinite(updatedMs)
      ? (nowMs - updatedMs) / (1000 * 60 * 60)
      : 0

    if (dueRaw) {
      const dueMs = Date.parse(dueRaw)
      if (Number.isFinite(dueMs)) {
        const graceMs = policy.overdueGraceHours * 3600_000
        if (nowMs > dueMs + graceMs) {
          breaches.push({
            conversationId: r.id,
            title,
            projectId: r.project_id,
            agentId: r.agent_id,
            stage: r.stage ?? r.stage_name,
            dueAt: dueRaw,
            updatedAt: updatedRaw,
            ageHours,
            reason: 'overdue',
          })
          continue
        }
      }
    }

    if (ageHours >= policy.staleHours) {
      breaches.push({
        conversationId: r.id,
        title,
        projectId: r.project_id,
        agentId: r.agent_id,
        stage: r.stage ?? r.stage_name,
        dueAt: dueRaw,
        updatedAt: updatedRaw,
        ageHours,
        reason: 'stale',
      })
    }
  }

  return { breaches, count: breaches.length }
}

/** Format breaches for heartbeat notify / human escalation. */
export function formatSlaEscalation(signal: SlaSignal, limit = 5): string {
  if (signal.count === 0) return ''
  const lines = signal.breaches.slice(0, limit).map((b) => {
    const tag = b.reason === 'overdue' ? 'OVERDUE' : 'STALE'
    return `- [${tag}] ${b.title} (${b.conversationId})${b.agentId ? ` agent=${b.agentId}` : ''} age=${b.ageHours.toFixed(1)}h`
  })
  const more = signal.count > limit ? `\n…+${signal.count - limit} more` : ''
  return `SLA breaches (${signal.count}):\n${lines.join('\n')}${more}`
}
