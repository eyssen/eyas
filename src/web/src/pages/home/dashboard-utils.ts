// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Minimal conversation fields the dashboard needs from GET /conversations. */
export interface DashboardConversation {
  id: string
  taskId: string
  title: string | null
  status: string
  pinned: boolean
  priority: string
  dueDate: string | null
  updatedAt: string
  projectId: string | null
}

export interface DashboardApproval {
  id: number
  category: string
  toolName: string | null
  reason: string | null
  requestedAt: string
  runId: string | null
  conversationId: string | null
  resumeError: string | null
}

export type AttentionKind =
  | 'approval'
  | 'stuck_resume'
  | 'agent_waiting'
  | 'overdue'
  | 'due_today'
  | 'proactive'

export interface AttentionItem {
  id: string
  kind: AttentionKind
  title: string
  detail: string | null
  href: string | null
  conversationId: string | null
  /** For approval quick-actions */
  approvalId?: number
  priority: number
}

/** Local-calendar day key (viewer timezone, not UTC). */
export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Extract YYYY-MM-DD from ISO or date-only strings. */
export function dueDay(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null
  const m = dueDate.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

export function isOverdue(dueDate: string | null | undefined, today = dayKey()): boolean {
  const d = dueDay(dueDate)
  return d !== null && d < today
}

export function isDueToday(dueDate: string | null | undefined, today = dayKey()): boolean {
  const d = dueDay(dueDate)
  return d !== null && d === today
}

export function pickPinned(conversations: DashboardConversation[], limit = 12): DashboardConversation[] {
  return conversations
    .filter((c) => c.pinned)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit)
}

export function pickRecent(
  conversations: DashboardConversation[],
  limit = 6,
  excludeIds?: Set<string>,
): DashboardConversation[] {
  return conversations
    .filter((c) => !excludeIds?.has(c.id))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit)
}

export function pickDueFocus(
  conversations: DashboardConversation[],
  today = dayKey(),
  limit = 8,
): { overdue: DashboardConversation[]; dueToday: DashboardConversation[] } {
  const overdue: DashboardConversation[] = []
  const dueToday: DashboardConversation[] = []
  for (const c of conversations) {
    if (isOverdue(c.dueDate, today)) overdue.push(c)
    else if (isDueToday(c.dueDate, today)) dueToday.push(c)
  }
  const byDue = (a: DashboardConversation, b: DashboardConversation) =>
    (dueDay(a.dueDate) ?? '').localeCompare(dueDay(b.dueDate) ?? '') ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  overdue.sort(byDue)
  dueToday.sort(byDue)
  return {
    overdue: overdue.slice(0, limit),
    dueToday: dueToday.slice(0, limit),
  }
}

export function relativeTime(isoOrMs: string | number, now = Date.now()): string {
  const ts = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs)
  if (Number.isNaN(ts)) return ''
  const mins = Math.floor(Math.max(0, now - ts) / 60_000)
  if (mins < 1) return 'just_now'
  if (mins < 60) return `m:${mins}`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `h:${hrs}`
  return `d:${Math.floor(hrs / 24)}`
}

export function buildAttentionItems(input: {
  approvals: DashboardApproval[]
  stuck: DashboardApproval[]
  waitingAgents: { sessionId: string; agentName: string; pendingApprovals: number }[]
  overdue: DashboardConversation[]
  dueToday: DashboardConversation[]
  proactive: { id: string; title: string; body: string; priority: string; actionUrl?: string }[]
}): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const a of input.approvals) {
    items.push({
      id: `approval:${a.id}`,
      kind: 'approval',
      title: a.toolName ? `${a.category} · ${a.toolName}` : a.category,
      detail: a.reason,
      href: a.conversationId ? `/conversations/${a.conversationId}` : '/autonomy',
      conversationId: a.conversationId,
      approvalId: a.id,
      priority: 0,
    })
  }

  for (const a of input.stuck) {
    items.push({
      id: `stuck:${a.id}`,
      kind: 'stuck_resume',
      title: a.toolName ? `${a.category} · ${a.toolName}` : a.category,
      detail: a.resumeError ?? a.reason,
      href: a.conversationId ? `/conversations/${a.conversationId}` : '/autonomy',
      conversationId: a.conversationId,
      priority: 1,
    })
  }

  for (const ag of input.waitingAgents) {
    items.push({
      id: `agent-wait:${ag.sessionId}`,
      kind: 'agent_waiting',
      title: ag.agentName,
      detail: ag.pendingApprovals > 0 ? `approvals:${ag.pendingApprovals}` : null,
      href: '/mission-control',
      conversationId: null,
      priority: 2,
    })
  }

  for (const c of input.overdue) {
    items.push({
      id: `overdue:${c.id}`,
      kind: 'overdue',
      title: c.title || c.taskId || c.id.slice(0, 8),
      detail: c.dueDate,
      href: `/conversations/${c.id}`,
      conversationId: c.id,
      priority: 3,
    })
  }

  for (const c of input.dueToday) {
    items.push({
      id: `due:${c.id}`,
      kind: 'due_today',
      title: c.title || c.taskId || c.id.slice(0, 8),
      detail: c.dueDate,
      href: `/conversations/${c.id}`,
      conversationId: c.id,
      priority: 4,
    })
  }

  for (const p of input.proactive) {
    if (p.priority !== 'urgent' && p.priority !== 'high') continue
    items.push({
      id: `proactive:${p.id}`,
      kind: 'proactive',
      title: p.title,
      detail: p.body,
      href: p.actionUrl ?? '/proactive',
      conversationId: null,
      priority: p.priority === 'urgent' ? 1 : 5,
    })
  }

  return items.sort((a, b) => a.priority - b.priority).slice(0, 12)
}

export function pickNextJobs(
  jobs: { id: string; name: string; status: string; nextRunAt?: string; nextRun?: string }[],
  limit = 5,
  now = Date.now(),
): { id: string; name: string; nextAt: string }[] {
  return jobs
    .filter((j) => j.status === 'active')
    .map((j) => ({
      id: j.id,
      name: j.name,
      nextAt: j.nextRunAt ?? j.nextRun ?? '',
    }))
    .filter((j) => j.nextAt && Date.parse(j.nextAt) >= now - 60_000)
    .sort((a, b) => Date.parse(a.nextAt) - Date.parse(b.nextAt))
    .slice(0, limit)
}
