// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import type { EyasDb } from '@core/types'
import { sql } from 'drizzle-orm'
import { requirePermission } from '@modules/permissions/middleware'
import type { SecurityGateConfig, SecurityEvent } from './types.js'
import { AutonomyError, type AutonomyPolicy, type ApprovalRecord } from './autonomy-policy.js'
import type { AutonomyFeatures } from './autonomy-features.js'

interface SecurityRow {
  id: number
  tool_name: string
  input: string | null
  decision: string
  checkpoint: string
  reason: string | null
  risk_tier: string
  conversation_id: string | null
  agent_id: string | null
  session_risk_score: number
  created_at: string
}

interface CountRow {
  count: number
}

interface TopToolRow {
  tool_name: string
  count: number
}

// drizzle-orm/bun-sqlite: db.get() returns positional arrays, db.all() returns
// objects. Use db.all() + [0] for single-row queries to read named columns.
function getOne<T>(db: EyasDb, query: any): T | undefined {
  return (db.all(query) as T[])[0]
}

/**
 * Minimal ownership-resolution surface the approvals list needs. Structurally
 * satisfied by `ConversationService` (conversations/conversation-service.ts) —
 * declared here so security-gate does not depend on that module directly.
 */
export interface ApprovalConversationLookup {
  getAncestry(conversationId: string): { userId: string }[]
}

export function createSecurityGateRoutes(
  app: Hono,
  db: EyasDb,
  config: SecurityGateConfig,
  autonomyPolicy?: AutonomyPolicy,
  emit?: (event: string, payload: Record<string, unknown>) => void,
  features?: AutonomyFeatures,
  conversations?: ApprovalConversationLookup,
): void {
  const router = new Hono()

  // List security events (paginated)
  router.get('/events', requirePermission('read', 'SecurityEvent'), (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 200)
    const offset = parseInt(c.req.query('offset') ?? '0')
    const decision = c.req.query('decision')
    const toolName = c.req.query('toolName')

    let rows: SecurityRow[]
    let total: number

    if (decision && toolName) {
      rows = db.all(sql`SELECT * FROM security_events WHERE decision = ${decision} AND tool_name = ${toolName} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`) as SecurityRow[]
      total = getOne<CountRow>(db, sql`SELECT COUNT(*) as count FROM security_events WHERE decision = ${decision} AND tool_name = ${toolName}`)?.count ?? 0
    } else if (decision) {
      rows = db.all(sql`SELECT * FROM security_events WHERE decision = ${decision} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`) as SecurityRow[]
      total = getOne<CountRow>(db, sql`SELECT COUNT(*) as count FROM security_events WHERE decision = ${decision}`)?.count ?? 0
    } else if (toolName) {
      rows = db.all(sql`SELECT * FROM security_events WHERE tool_name = ${toolName} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`) as SecurityRow[]
      total = getOne<CountRow>(db, sql`SELECT COUNT(*) as count FROM security_events WHERE tool_name = ${toolName}`)?.count ?? 0
    } else {
      rows = db.all(sql`SELECT * FROM security_events ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`) as SecurityRow[]
      total = getOne<CountRow>(db, sql`SELECT COUNT(*) as count FROM security_events`)?.count ?? 0
    }

    return c.json({
      events: rows.map(r => ({
        id: r.id,
        toolName: r.tool_name,
        input: r.input,
        decision: r.decision,
        checkpoint: r.checkpoint,
        reason: r.reason,
        riskTier: r.risk_tier,
        conversationId: r.conversation_id,
        agentId: r.agent_id,
        sessionRiskScore: r.session_risk_score,
        createdAt: r.created_at,
      })),
      total,
      limit,
      offset,
    })
  })

  // Current config
  router.get('/config', requirePermission('read', 'SecurityEvent'), (c) => {
    return c.json({ config })
  })

  // Security stats
  router.get('/stats', requirePermission('read', 'SecurityEvent'), (c) => {
    const totalEvents = getOne<CountRow>(db, sql`SELECT COUNT(*) as count FROM security_events`)?.count ?? 0
    const denials = getOne<CountRow>(db, sql`SELECT COUNT(*) as count FROM security_events WHERE decision = 'deny'`)?.count ?? 0
    const escalations = getOne<CountRow>(db, sql`SELECT COUNT(*) as count FROM security_events WHERE decision = 'escalate'`)?.count ?? 0

    const topBlocked = db.all(
      sql`SELECT tool_name, COUNT(*) as count FROM security_events WHERE decision = 'deny' GROUP BY tool_name ORDER BY count DESC LIMIT 10`,
    ) as TopToolRow[]

    const last24h = getOne<CountRow>(
      db,
      sql`SELECT COUNT(*) as count FROM security_events WHERE decision = 'deny' AND created_at > datetime('now', '-1 day')`,
    )?.count ?? 0

    return c.json({
      totalEvents,
      denials,
      escalations,
      denialRate: totalEvents > 0 ? denials / totalEvents : 0,
      topBlockedTools: topBlocked.map(r => ({ toolName: r.tool_name, count: r.count })),
      denialsLast24h: last24h,
    })
  })

  app.route('/api/v1/security', router)

  // ─── Autonomy trust-ladder routes ───────────────────────────────────────
  if (autonomyPolicy || features) {
    const autonomy = new Hono()

    if (autonomyPolicy) registerLadderRoutes(autonomy, autonomyPolicy, emit, conversations)
    if (features) registerFeatureRoutes(autonomy, features, emit)

    app.route('/api/v1/autonomy', autonomy)
  }
}

/**
 * Resolve the human owner of a conversation, walking the parent chain so an
 * orchestrator child conversation (owned by 'system') resolves through its
 * ancestors to whichever human actually started the chain. Returns null when
 * no human owner can be found (e.g. a fully system-initiated chain).
 */
function resolveConversationOwner(conversations: ApprovalConversationLookup, conversationId: string): string | null {
  const chain = conversations.getAncestry(conversationId) // root-first, the conversation itself last
  for (let i = chain.length - 1; i >= 0; i--) {
    const owner = chain[i]?.userId
    if (owner && owner !== 'system') return owner
  }
  return null
}

/**
 * From a candidate set of conversation ids, the subset owned by `userId`.
 * The SINGLE implementation of "which of these conversations are mine" —
 * used both by GET /approvals below and by countApprovalsFor/
 * countStuckResumesFor, so a caller outside this module (e.g. home's pulse
 * tile) can never drift from what the approvals list itself considers
 * "mine".
 */
function ownedConversationIds(candidates: string[], conversations: ApprovalConversationLookup, userId: string): string[] {
  const ownerCache = new Map<string, string | null>()
  const ownerOf = (conversationId: string): string | null => {
    if (!ownerCache.has(conversationId)) {
      ownerCache.set(conversationId, resolveConversationOwner(conversations, conversationId))
    }
    return ownerCache.get(conversationId) ?? null
  }
  return candidates.filter((id) => ownerOf(id) === userId)
}

/**
 * Pending/stuck approval COUNTS for callers outside this module (home's
 * pulse tile). Scoped exactly like GET /approvals below: admin/owner get the
 * installation-wide count, everyone else only their own. Backed by
 * AutonomyPolicy.countApprovals — a real COUNT(*), never listApprovals()
 * .length, which is capped at DEFAULT_APPROVAL_PAGE and would silently
 * saturate a badge/tile at 100 once the real queue grows past it.
 */
export function countApprovalsFor(
  autonomyPolicy: AutonomyPolicy,
  conversations: ApprovalConversationLookup | undefined,
  args: { userId: string; privileged: boolean; status?: ApprovalRecord['status'] },
): number {
  if (args.privileged) return autonomyPolicy.countApprovals(args.status)
  if (!conversations) return 0
  const mine = ownedConversationIds(autonomyPolicy.approvalConversationIds(args.status), conversations, args.userId)
  return autonomyPolicy.countApprovals(args.status, { conversationIds: mine })
}

/** Like countApprovalsFor, for the stuck-resume filter. */
export function countStuckResumesFor(
  autonomyPolicy: AutonomyPolicy,
  conversations: ApprovalConversationLookup | undefined,
  args: { userId: string; privileged: boolean },
): number {
  if (args.privileged) return autonomyPolicy.countStuckResumes()
  if (!conversations) return 0
  const mine = ownedConversationIds(autonomyPolicy.stuckResumeConversationIds(), conversations, args.userId)
  return autonomyPolicy.countStuckResumes({ conversationIds: mine })
}

/** The graduated trust-ladder routes (categories, level changes, approvals). */
function registerLadderRoutes(
  autonomy: Hono,
  autonomyPolicy: AutonomyPolicy,
  emit?: (event: string, payload: Record<string, unknown>) => void,
  conversations?: ApprovalConversationLookup,
): void {
  autonomy.get('/', requirePermission('read', 'Autonomy'), (c) => {
    return c.json({ categories: autonomyPolicy.listCategories() })
  })

  autonomy.put('/:key', requirePermission('update', 'Autonomy'), async (c) => {
    const key = c.req.param('key')
    const body = (await c.req.json().catch(() => ({}))) as { level?: number }
    const actor = ((c as any).get('userId') as string | undefined) ?? 'system'
    try {
      const category = autonomyPolicy.setLevel(key, Number(body.level), actor)
      emit?.('autonomy:level-changed', { category: key, newLevel: category.level, actor })
      return c.json({ category })
    } catch (e) {
      if (e instanceof AutonomyError) {
        if (e.httpStatus === 403) emit?.('autonomy:floor-violation-blocked', { category: key, attemptedLevel: body.level, actor })
        return c.json({ error: e.message }, e.httpStatus as 400 | 403 | 404)
      }
      throw e
    }
  })

  // S1 — the route is role-gated (read Autonomy — the plain 'user' role has
  // it), so ANY authenticated caller with at least read access can reach this
  // handler. Owner/admin get the full unfiltered list (including tool args);
  // every other caller is scoped to approvals whose conversation resolves
  // (parent-chain walk) to a conversation THEY own, with input_json (raw tool
  // arguments — commands, paths, message bodies) stripped from the payload.
  // Rows with no conversation_id at all (system-initiated, no human owner)
  // are admin-only and never appear in the scoped list.
  autonomy.get('/approvals', requirePermission('read', 'Autonomy'), (c) => {
    // `?resumeFailed=1` — decided approvals whose parked run never restarted.
    // A server-side filter (rather than the client pulling ?status=approved and
    // sifting) keeps the dashboard's per-WS-event refetch off the full history.
    const stuckOnly = c.req.query('resumeFailed') === '1'
    const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked' | undefined
    const role = ((c as any).get('role') as string | undefined) ?? 'guest'

    if (role === 'owner' || role === 'admin') {
      return c.json({ approvals: stuckOnly ? autonomyPolicy.listStuckResumes() : autonomyPolicy.listApprovals(status || undefined) })
    }

    const userId = (c as any).get('userId') as string | undefined
    if (!userId || !conversations) {
      return c.json({ approvals: [] })
    }

    // Resolve ownership FIRST and push it into the query, so the page limit
    // bounds the caller's own rows (fix round 2). Scoping a limited page
    // instead handed a user whose approval sat behind 100 newer foreign ones
    // an empty queue — and no way to decide the run parked on it. The
    // candidate set is the DISTINCT conversations that have matching
    // approvals, not the approval history, so this stays bounded by
    // conversations-with-work rather than by everything ever decided.
    const candidates = stuckOnly
      ? autonomyPolicy.stuckResumeConversationIds()
      : autonomyPolicy.approvalConversationIds(status || undefined)
    const mine = { conversationIds: ownedConversationIds(candidates, conversations, userId) }

    // Rows with no conversation_id (system-initiated, no human owner) are
    // admin-only and can never enter this list — they are excluded by the
    // conversation filter itself.
    const scoped = (stuckOnly
      ? autonomyPolicy.listStuckResumes(undefined, mine)
      : autonomyPolicy.listApprovals(status || undefined, undefined, mine))
      .map(({ inputJson: _inputJson, ...rest }) => rest)
    return c.json({ approvals: scoped })
  })

  const decideHandler = (status: 'approved' | 'rejected') => (c: any) => {
    const id = Number(c.req.param('id'))
    const actor = (c.get('userId') as string | undefined) ?? 'system'
    const res = autonomyPolicy.decide(id, status, actor)
    if (res.ok) emit?.('autonomy:approval-resolved', { approvalId: id, status, decidedBy: actor })
    // 409 Conflict when the row was already decided (compare-and-set lost).
    return c.json(res, res.ok ? 200 : 409)
  }
  autonomy.post('/approvals/:id/approve', requirePermission('approve', 'Autonomy'), decideHandler('approved'))
  autonomy.post('/approvals/:id/reject', requirePermission('approve', 'Autonomy'), decideHandler('rejected'))
}

/**
 * Phase-3 loop enable/disable routes (Task 10). A SEPARATE, minimal on/off
 * store from the ladder above (see autonomy-features.ts header) — owner-
 * permission-gated the same way, so Task 11's Settings UI can list + toggle
 * the 5 loop flags without a restart.
 */
function registerFeatureRoutes(
  autonomy: Hono,
  features: AutonomyFeatures,
  emit?: (event: string, payload: Record<string, unknown>) => void,
): void {
  autonomy.get('/features', requirePermission('read', 'Autonomy'), (c) => {
    return c.json({ features: features.list() })
  })

  autonomy.patch('/features/:key', requirePermission('update', 'Autonomy'), async (c) => {
    const key = c.req.param('key')
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean }
    if (typeof body.enabled !== 'boolean') {
      return c.json({ error: 'enabled must be a boolean' }, 400)
    }
    const actor = ((c as any).get('userId') as string | undefined) ?? 'system'
    features.setEnabled(key, body.enabled, actor)
    emit?.('autonomy:feature-changed', { key, enabled: body.enabled, actor })
    return c.json({ feature: { key, enabled: body.enabled } })
  })
}
