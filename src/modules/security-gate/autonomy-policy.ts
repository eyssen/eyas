// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'

/**
 * Graduated Autonomy trust-ladder.
 *
 * Each action CATEGORY carries an autonomy level:
 *   L1 = notice-only / ask first
 *   L2 = propose + one-click human approval
 *   L3 = autonomous + report-after
 *
 * A server-enforced safety FLOOR locks irreversible/outbound categories at L1
 * (they can never be raised). The floor is enforced in BOTH a DB CHECK
 * constraint (level <= max_level) and the setLevel() handler, so a buggy or
 * malicious caller cannot bypass it. Unknown categories fail SAFE to L1.
 */

export interface AutonomyCategory {
  key: string
  label: string
  level: 1 | 2 | 3
  locked: boolean
  maxLevel: 1 | 2 | 3
  updatedAt: string | null
  updatedBy: string | null
}

export interface ResolvedAutonomy {
  level: 1 | 2 | 3
  locked: boolean
  maxLevel: 1 | 2 | 3
}

/** Thrown by setLevel() on a floor/range violation; httpStatus maps to the route response. */
export class AutonomyError extends Error {
  constructor(public readonly httpStatus: number, message: string) {
    super(message)
    this.name = 'AutonomyError'
  }
}

interface SeedCategory { key: string; label: string; maxLevel: 1 | 2 | 3; locked: 0 | 1 }

/**
 * The category catalogue. All ship at level 1. Reversible categories cap at
 * L3; email is the single principled outbound exception (cap L2 = draft +
 * approve, never fully autonomous send); the rest are irreversible/outbound
 * and are LOCKED at L1 — a hard safety floor.
 */
export const CATEGORY_SEED: readonly SeedCategory[] = [
  { key: 'kanban_archive_done', label: 'Archive done cards', maxLevel: 3, locked: 0 },
  { key: 'kanban_stuck_nudge', label: 'Nudge stuck tasks', maxLevel: 3, locked: 0 },
  { key: 'memory_maintenance', label: 'Memory maintenance', maxLevel: 3, locked: 0 },
  { key: 'routine_trivial_fix', label: 'Routine trivial fixes', maxLevel: 3, locked: 0 },
  { key: 'deploy_retry', label: 'Retry a failed deploy', maxLevel: 3, locked: 0 },
  { key: 'kanban_restructure', label: 'Restructure the board', maxLevel: 3, locked: 0 },
  { key: 'skill_patch', label: 'Patch a skill', maxLevel: 3, locked: 0 },
  // skill.adopt covers skill-generation's adopter (adopter.ts): registering a
  // model-authored SKILL.md into the real skills registry. Capped at L2 (never
  // fully autonomous) — the adopter itself always gates through the approval
  // queue regardless of this category's level (see adopter.ts header); the
  // seed entry only makes the category visible/manageable in the autonomy UI.
  { key: 'skill.adopt', label: 'Adopt a generated skill', maxLevel: 2, locked: 0 },
  { key: 'email_send', label: 'Send email', maxLevel: 2, locked: 0 },
  // ops_apply covers the ops module's reconcile-loop apply() action (kubectl
  // exec + gitops-pr). maxLevel is pinned at 1 (ask-first) — a cluster
  // mutation must always pass through human review; the autonomy ladder
  // offers no path to auto-approve it.
  { key: 'ops_apply', label: 'Apply an ops remediation action', maxLevel: 1, locked: 0 },
  { key: 'publish_content', label: 'Publish content', maxLevel: 1, locked: 1 },
  { key: 'payment', label: 'Make a payment', maxLevel: 1, locked: 1 },
  { key: 'data_delete', label: 'Delete data', maxLevel: 1, locked: 1 },
  { key: 'permission_change', label: 'Change permissions', maxLevel: 1, locked: 1 },
  { key: 'external_message', label: 'Send an external message', maxLevel: 1, locked: 1 },
]

/** Strictest possible resolution — used for unknown categories (fail-safe). */
const STRICTEST: ResolvedAutonomy = { level: 1, locked: true, maxLevel: 1 }

/** Default page size for the approval listings (fix round 1 — see listApprovals). */
const DEFAULT_APPROVAL_PAGE = 100

/**
 * Restricts a listing to a set of conversations. Fix round 2: the page limit
 * has to apply to the CALLER'S visible rows, so a non-admin whose approval
 * sits behind a wall of newer foreign ones still sees it — limiting first and
 * scoping after handed such a caller an empty queue and no way to decide the
 * run parked on it.
 */
export interface ApprovalScope {
  conversationIds: string[]
}

/** Sentinel: a scope that can match nothing — short-circuited, never queried. */
const EMPTY_SCOPE = Symbol('empty-approval-scope')

function scopeClause(scope?: ApprovalScope): ReturnType<typeof sql> | typeof EMPTY_SCOPE {
  if (!scope) return sql`1 = 1`
  if (scope.conversationIds.length === 0) return EMPTY_SCOPE
  return sql`conversation_id IN (${sql.join(scope.conversationIds.map((id) => sql`${id}`), sql`, `)})`
}

/**
 * Explicit tool→category overrides for tools the name patterns get wrong.
 * A `null` value means "explicitly NOT an autonomy-gated action" and wins over
 * the heuristics below.
 *
 * Frozen at declaration: exporting it for the guard test also made it a live
 * mutable singleton, and a single stray write here would silently un-gate a
 * destructive tool process-wide. `Readonly<>` is compile-time only.
 */
export const EXPLICIT_TOOL_CATEGORY: Readonly<Record<string, string | null>> = Object.freeze({
  run_command: 'data_delete', // arbitrary shell can do anything destructive → strictest
  browser_navigate: 'external_message', // outbound network egress
  browser_click: 'external_message',
  browser_fill: 'external_message',
  browser_hover: 'external_message',
  browser_select: 'external_message',
  browser_dialog: 'external_message',
  browser_upload: 'external_message',
  browser_evaluate: 'external_message',
  browser_download: 'external_message',
  browser_tabs: 'external_message',
  browser_storage: 'external_message',
  browser_replay: 'external_message', // cached locator still clicks/fills
  browser_use_exec: 'external_message', // real Chrome CDP via Python CLI
  agent_browser_run: 'external_message', // Vercel agent-browser CLI sidecar
  save_memory: 'memory_maintenance',
  // Intra-run, in-process agent-to-agent messaging: it writes a row to
  // agent_messages scoped to the current session and never leaves the host.
  // The `^send_` pattern below exists for outbound channels (email, telegram,
  // …) and would otherwise lock team coordination behind an approval.
  send_agent_message: null,
})

/**
 * Map a tool name to its autonomy category, or null when the tool is not an
 * autonomy-gated action (benign reads etc., governed by the risk-tier gate).
 *
 * FAIL-SAFE: an unmapped RED-tier tool is treated as the strictest locked
 * category (data_delete), so a newly-added destructive tool can NEVER run
 * autonomously before someone maps it explicitly.
 */
export function categoryForTool(toolName: string, riskTier?: 'green' | 'yellow' | 'red'): string | null {
  if (toolName in EXPLICIT_TOOL_CATEGORY) return EXPLICIT_TOOL_CATEGORY[toolName]
  const n = toolName.toLowerCase()
  if (/(delete|remove|unlink|purge|\bdrop\b)/.test(n)) return 'data_delete'
  if (/(payment|\bpay\b|invoice|charge|refund|checkout)/.test(n)) return 'payment'
  if (/(publish|go[_-]?live)/.test(n)) return 'publish_content'
  if (/(permission|\bgrant\b|\brevoke\b|\brole\b|access[_-]?control)/.test(n)) return 'permission_change'
  if (/(email|mail)/.test(n) && /(send|reply|draft|compose)/.test(n)) return 'email_send'
  if (/(telegram|discord|slack|whatsapp|signal|sms|channel)/.test(n) && /(send|reply|post|message|notify)/.test(n)) return 'external_message'
  if (/^send_|_send$|broadcast/.test(n)) return 'external_message'
  if (/(deploy|rollout|restart|reconcile)/.test(n)) return 'deploy_retry'
  // Fail-safe: an unmapped destructive (red) tool can never run autonomously.
  if (riskTier === 'red') return 'data_delete'
  return null
}

/**
 * The approvals table in its CURRENT shape. Columns introduced by later tasks
 * appear BOTH here (so a fresh DB gets them from the CREATE) and in the
 * idempotent ALTER list below (so an existing DB picks them up) — the two must
 * stay in sync, because the legacy-CHECK rebuild copies between them.
 */
function createApprovalsTable(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS autonomy_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    tool_name TEXT,
    agent_id TEXT,
    conversation_id TEXT,
    input_json TEXT,
    preview TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')),
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    expires_at TEXT,
    arg_hash TEXT,
    run_id TEXT,
    kind TEXT DEFAULT 'tool_call',
    consumed_at TEXT,
    resume_error TEXT,
    resume_started_at TEXT,
    revoked_at TEXT
  )`)
}

/** Every column of the current shape — the rebuild's copy list. */
const APPROVAL_COLUMNS =
  'id, category, tool_name, agent_id, conversation_id, input_json, preview, reason, status, ' +
  'requested_at, decided_at, decided_by, expires_at, arg_hash, run_id, kind, consumed_at, ' +
  'resume_error, resume_started_at, revoked_at'

/**
 * F2 T6 fix 1 — 'revoked' is a NEW member of the status CHECK constraint, and
 * SQLite cannot ALTER a constraint: a database created before this change
 * would reject every revoke at the storage layer (leaving a cancelled run's
 * grant live — the exact hole revokeGrant exists to close). So the table is
 * rebuilt once, in place, the standard SQLite way.
 *
 * Detection reads the stored schema text, so this is a no-op on a fresh table
 * and on every subsequent boot. It must run AFTER the ALTERs (the legacy table
 * needs the full column set before it can be copied) and BEFORE the index
 * creation below (the legacy indexes are dropped with the legacy table, and
 * are recreated on the new one).
 */
function ensureRevocableStatus(db: any): void {
  const row = (db.all(sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'autonomy_approvals'`) as Array<{ sql: string | null }>)[0]
  if (!row?.sql || row.sql.includes("'revoked'")) return

  // ALL FOUR STATEMENTS OR NONE (fix round 2). Autocommitted individually,
  // a failure between them is unrecoverable rather than merely inconvenient:
  // stopping after the RENAME leaves the next boot creating a fresh EMPTY
  // table that already satisfies the 'revoked' check above, so the migration
  // never runs again — every real row stays stranded in the legacy table, and
  // the index names still belong to THAT table, so the CREATE INDEX IF NOT
  // EXISTS calls below silently no-op and the live table runs without the
  // grant CAS index forever. SQLite DDL is transactional, so one transaction
  // turns every such failure back into "nothing happened, try again later".
  // `began` gates the rollback: if BEGIN itself fails (e.g. a caller already
  // opened a transaction), rolling back would discard THEIR work, turning a
  // skipped migration into data loss somewhere else entirely.
  let began = false
  try {
    db.run(sql.raw('BEGIN IMMEDIATE'))
    began = true
    db.run(sql`ALTER TABLE autonomy_approvals RENAME TO autonomy_approvals_legacy`)
    createApprovalsTable(db)
    // Explicit column lists on both sides: ALTER appends, so the legacy table's
    // column ORDER does not match the fresh one's.
    db.run(sql.raw(`INSERT INTO autonomy_approvals (${APPROVAL_COLUMNS}) SELECT ${APPROVAL_COLUMNS} FROM autonomy_approvals_legacy`))
    db.run(sql`DROP TABLE autonomy_approvals_legacy`)
    db.run(sql.raw('COMMIT'))
  } catch (err) {
    if (began) {
      try { db.run(sql.raw('ROLLBACK')) } catch { /* the transaction is already gone */ }
    }
    // Propagated, not swallowed: the surrounding convention is that only
    // "column already exists" is silently tolerated, and a DB that cannot be
    // migrated must not boot into a state where revokeGrant fails at the
    // storage layer with nothing but a per-cancel warning to show for it.
    throw err
  }
}

export function createAutonomyTables(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS autonomy_categories (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1, 2, 3)),
    locked INTEGER NOT NULL DEFAULT 0,
    max_level INTEGER NOT NULL DEFAULT 3 CHECK (max_level IN (1, 2, 3)),
    updated_at TEXT,
    updated_by TEXT,
    CHECK (level <= max_level)
  )`)

  createApprovalsTable(db)
  // F2 T3 — approval subsystem upgrade: grant ledger + TTL + resume plumbing.
  // Idempotent ALTERs (same style as run-supervisor.ts's ensureRunSupervisionSchema)
  // so an existing DB picks up the new columns without a migration step.
  const approvalCols = [
    // Scopes a grant to the EXACT call it was requested for (conversation +
    // tool + canonicalized args) — see consumeGrant().
    `ALTER TABLE autonomy_approvals ADD COLUMN arg_hash TEXT`,
    // The supervised run (agent_sessions.id) this escalation happened on, when
    // one is in scope — lets the expiry sweep and Task 6's resume tell the
    // runner which run to unpark/fail.
    `ALTER TABLE autonomy_approvals ADD COLUMN run_id TEXT`,
    // D12 — distinguishes a tool-call escalation from other future approval
    // kinds (e.g. plan review). Every row created before this task is an
    // ordinary tool-call approval, hence the DEFAULT.
    `ALTER TABLE autonomy_approvals ADD COLUMN kind TEXT DEFAULT 'tool_call'`,
    // Set by consumeGrant()'s CAS UPDATE — once non-null, the approval can
    // never be granted again (exactly-once).
    `ALTER TABLE autonomy_approvals ADD COLUMN consumed_at TEXT`,
    // Task 6 plumbing: set when a resume driven by this approval fails, so an
    // operator can see why an approved action never actually completed.
    `ALTER TABLE autonomy_approvals ADD COLUMN resume_error TEXT`,
    // F2 T6 — the resume COORDINATION POINT. Two independent triggers can drive
    // the same resume (the bus subscriber on the operator's decision, and the
    // hourly sweep that covers a missed/failed one); claimResume()'s CAS on
    // this column is what makes exactly one of them proceed.
    `ALTER TABLE autonomy_approvals ADD COLUMN resume_started_at TEXT`,
    // F2 T6 fix 1 — when revokeGrant() killed an un-consumed grant.
    `ALTER TABLE autonomy_approvals ADD COLUMN revoked_at TEXT`,
  ]
  for (const ddl of approvalCols) {
    try { db.run(sql.raw(ddl)) } catch { /* already exists */ }
  }
  ensureRevocableStatus(db)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_autonomy_approvals_status ON autonomy_approvals(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_autonomy_approvals_conversation ON autonomy_approvals(conversation_id)`)
  // Backs consumeGrant()'s CAS lookup (conversation + tool + args + status).
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_autonomy_approvals_grant ON autonomy_approvals(conversation_id, tool_name, arg_hash, status)`)
}

interface CategoryRow {
  key: string
  label: string
  level: number
  locked: number
  max_level: number
  updated_at: string | null
  updated_by: string | null
}

function rowToCategory(r: CategoryRow): AutonomyCategory {
  return {
    key: r.key,
    label: r.label,
    level: r.level as 1 | 2 | 3,
    locked: !!r.locked,
    maxLevel: r.max_level as 1 | 2 | 3,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }
}

export interface ApprovalRecord {
  id: number
  category: string
  toolName: string | null
  agentId: string | null
  conversationId: string | null
  /** The apply payload set at createApproval time (e.g. `{"proposalId":"p-1"}`) — read by the category's ApplyHandler on approval. */
  inputJson: string | null
  preview: string | null
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked'
  requestedAt: string
  decidedAt: string | null
  decidedBy: string | null
  expiresAt: string | null
  /** Canonicalized-args hash (shared/arg-hash.ts) — scopes a grant to the exact call. */
  argHash: string | null
  /** The supervised run (agent_sessions.id) this escalation happened on, if any. */
  runId: string | null
  /** D12 — 'tool_call' (default) today; room for future approval kinds. */
  kind: string
  /** Set by consumeGrant()'s CAS — non-null once this approval has authorized a call. */
  consumedAt: string | null
  /** Task 6 plumbing — set when a resume driven by this approval fails. */
  resumeError: string | null
  /** F2 T6 — claimed by the winner of the resume CAS; null means resumable. */
  resumeStartedAt: string | null
  /** F2 T6 fix 1 — when an un-consumed grant was revoked (see revokeGrant). */
  revokedAt: string | null
}

interface ApprovalRow {
  id: number
  category: string
  tool_name: string | null
  agent_id: string | null
  conversation_id: string | null
  input_json: string | null
  preview: string | null
  reason: string | null
  status: string
  requested_at: string
  decided_at: string | null
  decided_by: string | null
  expires_at: string | null
  arg_hash: string | null
  run_id: string | null
  kind: string | null
  consumed_at: string | null
  resume_error: string | null
  resume_started_at: string | null
  revoked_at: string | null
}

function rowToApproval(r: ApprovalRow): ApprovalRecord {
  return {
    id: r.id,
    category: r.category,
    toolName: r.tool_name,
    agentId: r.agent_id,
    conversationId: r.conversation_id,
    inputJson: r.input_json,
    preview: r.preview,
    reason: r.reason,
    status: r.status as ApprovalRecord['status'],
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    expiresAt: r.expires_at,
    argHash: r.arg_hash ?? null,
    runId: r.run_id ?? null,
    kind: r.kind ?? 'tool_call',
    consumedAt: r.consumed_at ?? null,
    resumeError: r.resume_error ?? null,
    resumeStartedAt: r.resume_started_at ?? null,
    revokedAt: r.revoked_at ?? null,
  }
}

/**
 * Apply-on-approval handler for a category (Task 9 — gated apply). Registered
 * by the owning module (forge, skill-generation, …) once its apply mechanics
 * are wired; decide() invokes it when a pending row for that category
 * transitions to 'approved'. May be sync or async — decide() itself stays
 * sync (see decide() below) and only logs handler failures, never throws.
 */
export type ApplyHandler = (approval: ApprovalRecord) => void | Promise<void>

/**
 * Side-effect hooks the owning module wires at construction.
 *
 * `onApprovalCreated` is the single observation point for the approval queue:
 * EVERY enqueue path (tool executor, agent runner, hand bridge, forge,
 * skill-generation, ops) goes through createApproval, so one hook here is what
 * turns a silent DB insert into a bus event + a live badge in the UI.
 */
export interface AutonomyPolicyHooks {
  onApprovalCreated?(approval: {
    id: number
    category: string
    toolName: string | null
    reason: string | null
    conversationId: string | null
  }): void
}

export interface AutonomyPolicyOptions {
  /** D5 — default TTL (hours) applied by defaultExpiresAt() when a caller doesn't set its own. Default 72. */
  defaultTtlHours?: number
}

export function createAutonomyPolicy(
  db: any,
  logger?: Pick<Logger, 'error' | 'warn'>,
  hooks?: AutonomyPolicyHooks,
  options?: AutonomyPolicyOptions,
) {
  const applyHandlers = new Map<string, ApplyHandler>()
  const defaultTtlHours = options?.defaultTtlHours ?? 72

  /** Shared by defaultExpiresAt() and decide()'s I5(a) re-stamp — same TTL source. */
  function computeExpiresAt(fromIso: string): string {
    return new Date(new Date(fromIso).getTime() + defaultTtlHours * 3_600_000).toISOString()
  }

  return {
    /**
     * Register the apply-on-approval handler for a category — the ONLY place
     * a self-improvement apply may be triggered from. Last registration per
     * category wins (mirrors seedDefaults' append-only intent: modules
     * register once at startup).
     */
    registerApplyHandler(category: string, handler: ApplyHandler): void {
      applyHandlers.set(category, handler)
    },

    /** Insert any not-yet-present category. Append-only: existing operator-set rows are never reset. */
    seedDefaults(): void {
      for (const c of CATEGORY_SEED) {
        db.run(sql`INSERT OR IGNORE INTO autonomy_categories (key, label, level, locked, max_level)
          VALUES (${c.key}, ${c.label}, 1, ${c.locked}, ${c.maxLevel})`)
      }
    },

    listCategories(): AutonomyCategory[] {
      const rows = db.all(sql`SELECT * FROM autonomy_categories ORDER BY locked, key`) as CategoryRow[]
      return rows.map(rowToCategory)
    },

    /** Passthrough to the tool→category classifier (kept on the policy so consumers need one dependency). */
    categoryForTool(toolName: string, riskTier?: 'green' | 'yellow' | 'red'): string | null {
      return categoryForTool(toolName, riskTier)
    },

    /** Resolve the effective autonomy for a category. Unknown → strictest (fail-safe L1). */
    resolve(category: string): ResolvedAutonomy {
      const rows = db.all(sql`SELECT * FROM autonomy_categories WHERE key = ${category}`) as CategoryRow[]
      const r = rows[0]
      if (!r) return STRICTEST
      return { level: r.level as 1 | 2 | 3, locked: !!r.locked, maxLevel: r.max_level as 1 | 2 | 3 }
    },

    /** Set a category's level. Throws AutonomyError (403/400/404) on a floor/range/unknown violation. */
    setLevel(key: string, level: number, actor: string): AutonomyCategory {
      if (!Number.isInteger(level) || level < 1 || level > 3) {
        throw new AutonomyError(400, 'level must be 1, 2, or 3')
      }
      const r = (db.all(sql`SELECT * FROM autonomy_categories WHERE key = ${key}`) as CategoryRow[])[0]
      if (!r) throw new AutonomyError(404, `unknown autonomy category: ${key}`)
      if (r.locked && level > 1) {
        throw new AutonomyError(403, `category "${key}" is locked at level 1 (safety constraint)`)
      }
      if (level > r.max_level) {
        throw new AutonomyError(400, `level ${level} exceeds maxLevel ${r.max_level} for "${key}"`)
      }
      const now = new Date().toISOString()
      db.run(sql`UPDATE autonomy_categories SET level = ${level}, updated_at = ${now}, updated_by = ${actor} WHERE key = ${key}`)
      return rowToCategory({ ...r, level, updated_at: now, updated_by: actor })
    },

    // ─── Approval queue (the single persistent HIL queue) ───────────────────

    /**
     * D5 — the default expiry a caller should stamp on a fresh escalation when
     * it doesn't compute its own (now + security.approvalTtlHours, default
     * 72h). Exposed as a method (rather than a createApproval-wide default) so
     * existing callers that never set expiresAt (forge, ops, skill-generation)
     * keep their current no-expiry behaviour unless they opt in.
     */
    defaultExpiresAt(now?: string): string {
      return computeExpiresAt(now ?? new Date().toISOString())
    },

    /** Enqueue a pending approval for an autonomous action. Returns its id. */
    createApproval(input: {
      category: string
      toolName?: string
      agentId?: string
      conversationId?: string
      inputJson?: string
      preview?: string
      reason?: string
      expiresAt?: string
      /** Canonicalized-args hash (shared/arg-hash.ts) — required for consumeGrant() to ever match this row. */
      argHash?: string
      /** The supervised run (agent_sessions.id) this escalation happened on, when known. */
      runId?: string
      /** D12 — defaults to 'tool_call' via the column DEFAULT when omitted. */
      kind?: string
    }): number {
      const kind = input.kind ?? 'tool_call'
      // I4 — dedup on enqueue: a retried/replayed identical tool call (same
      // conversation + tool + canonicalized args) must not grow the queue
      // with a second pending row for the SAME still-unactioned escalation —
      // return the existing pending row's id instead of inserting. Only
      // applies to ordinary tool-call escalations that carry both an argHash
      // and a conversation scope (forge/ops/skill-generation callers, which
      // pass neither, are unaffected and keep inserting every time).
      if (input.argHash && input.conversationId && input.toolName && kind === 'tool_call') {
        const existing = db.all(sql`SELECT id FROM autonomy_approvals
          WHERE conversation_id = ${input.conversationId}
            AND tool_name = ${input.toolName}
            AND arg_hash = ${input.argHash}
            AND kind = ${kind}
            AND status = 'pending'`) as Array<{ id: number }>
        if (existing[0]) return Number(existing[0].id)
      }
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO autonomy_approvals
        (category, tool_name, agent_id, conversation_id, input_json, preview, reason, status, requested_at, expires_at, arg_hash, run_id, kind)
        VALUES (${input.category}, ${input.toolName ?? null}, ${input.agentId ?? null}, ${input.conversationId ?? null},
                ${input.inputJson ?? null}, ${input.preview ?? null}, ${input.reason ?? null}, 'pending', ${now}, ${input.expiresAt ?? null},
                ${input.argHash ?? null}, ${input.runId ?? null}, ${kind})`)
      const row = (db.all(sql`SELECT last_insert_rowid() AS id`) as Array<{ id: number }>)[0]
      const id = Number(row.id)
      // Notification is best-effort: a broken listener must never turn an
      // enqueued approval into a thrown tool call (that would fail OPEN in the
      // caller's error path instead of waiting for a human).
      try {
        hooks?.onApprovalCreated?.({
          id,
          category: input.category,
          toolName: input.toolName ?? null,
          reason: input.reason ?? null,
          conversationId: input.conversationId ?? null,
        })
      } catch (err) {
        logger?.warn?.({ err, approvalId: id }, 'Autonomy: onApprovalCreated hook threw')
      }
      return id
    },

    /**
     * Newest-first page of the queue. BOUNDED (fix round 1): the dashboard
     * refetches this on every autonomy WS event, and the decided statuses are
     * append-only history that grows without limit — an unbounded read would
     * ship the whole archive (with raw tool args, for an admin caller) on
     * every approval anyone anywhere decides.
     */
    listApprovals(status?: ApprovalRecord['status'], limit: number = DEFAULT_APPROVAL_PAGE, scope?: ApprovalScope): ApprovalRecord[] {
      const restriction = scopeClause(scope)
      if (restriction === EMPTY_SCOPE) return []
      const rows = db.all(sql`SELECT * FROM autonomy_approvals
        WHERE ${status ? sql`status = ${status}` : sql`1 = 1`} AND ${restriction}
        ORDER BY requested_at DESC LIMIT ${limit}`) as ApprovalRow[]
      return rows.map(rowToApproval)
    },

    /**
     * Same predicate as listApprovals, but COUNT(*): unbounded by
     * DEFAULT_APPROVAL_PAGE and never fetches the row payload (no
     * input_json). A caller that only needs "how many" must not have
     * listApprovals's UI page-size limit silently become the answer — that
     * previously made a badge/tile saturate at 100 once the real queue grew
     * past it.
     */
    countApprovals(status?: ApprovalRecord['status'], scope?: ApprovalScope): number {
      const restriction = scopeClause(scope)
      if (restriction === EMPTY_SCOPE) return 0
      const rows = db.all(sql`SELECT COUNT(*) AS n FROM autonomy_approvals
        WHERE ${status ? sql`status = ${status}` : sql`1 = 1`} AND ${restriction}`) as Array<{ n: number }>
      return Number(rows[0]?.n ?? 0)
    },

    /**
     * The conversations that currently have approvals — the candidate set a
     * caller's ownership has to be resolved against BEFORE any page limit is
     * applied. Bounded by distinct conversations rather than by approval
     * history, and narrowed by `status` so the common case (the pending work
     * queue) stays small.
     */
    approvalConversationIds(status?: ApprovalRecord['status']): string[] {
      const rows = db.all(sql`SELECT DISTINCT conversation_id FROM autonomy_approvals
        WHERE conversation_id IS NOT NULL AND ${status ? sql`status = ${status}` : sql`1 = 1`}`) as Array<{ conversation_id: string }>
      return rows.map((r) => r.conversation_id)
    },

    /** Like approvalConversationIds, for the stuck-resume filter. */
    stuckResumeConversationIds(): string[] {
      const rows = db.all(sql`SELECT DISTINCT conversation_id FROM autonomy_approvals
        WHERE conversation_id IS NOT NULL AND resume_error IS NOT NULL AND consumed_at IS NULL`) as Array<{ conversation_id: string }>
      return rows.map((r) => r.conversation_id)
    },

    /**
     * Approvals an operator decided but whose resume never took: the run is
     * still parked and nothing else in the UI would ever surface it (the row
     * left the pending queue the moment it was decided). Serving this as its
     * own server-side filter is what lets the dashboard stop pulling the whole
     * approved history to find these few rows.
     */
    listStuckResumes(limit: number = DEFAULT_APPROVAL_PAGE, scope?: ApprovalScope): ApprovalRecord[] {
      const restriction = scopeClause(scope)
      if (restriction === EMPTY_SCOPE) return []
      const rows = db.all(sql`SELECT * FROM autonomy_approvals
        WHERE resume_error IS NOT NULL AND consumed_at IS NULL AND ${restriction}
        ORDER BY requested_at DESC LIMIT ${limit}`) as ApprovalRow[]
      return rows.map(rowToApproval)
    },

    /** Same predicate as listStuckResumes, but COUNT(*) — see countApprovals. */
    countStuckResumes(scope?: ApprovalScope): number {
      const restriction = scopeClause(scope)
      if (restriction === EMPTY_SCOPE) return 0
      const rows = db.all(sql`SELECT COUNT(*) AS n FROM autonomy_approvals
        WHERE resume_error IS NOT NULL AND consumed_at IS NULL AND ${restriction}`) as Array<{ n: number }>
      return Number(rows[0]?.n ?? 0)
    },

    /** Fetch a single approval by id, or null if it doesn't exist. */
    getApproval(id: number): ApprovalRecord | null {
      const rows = db.all(sql`SELECT * FROM autonomy_approvals WHERE id = ${id}`) as ApprovalRow[]
      return rows[0] ? rowToApproval(rows[0]) : null
    },

    /**
     * Compare-and-set decision: transition a row from 'pending' to
     * approved/rejected exactly once. Because EYAS runs single-process with
     * synchronous SQLite, the pre-read + `WHERE status='pending'` guard are
     * atomic — a second decide on an already-decided row is a no-op (ok:false),
     * so an action can never be double-run by a double-approve.
     *
     * I5(a) — on 'approved', expires_at is re-stamped to now + the same TTL
     * (security.approvalTtlHours) the row was created with. A grant needs its
     * OWN fresh window: the original expiry only bounded how long the
     * escalation could sit un-decided, not how long the resulting grant stays
     * usable — without this re-stamp, an approval decided close to (or past)
     * its original expiry would be dead on arrival, or the sweep in
     * expireStale() would immediately reclaim it as an unconsumed grant.
     */
    decide(id: number, status: 'approved' | 'rejected', actor: string): { ok: boolean; status?: string } {
      const before = (db.all(sql`SELECT * FROM autonomy_approvals WHERE id = ${id}`) as ApprovalRow[])[0]
      if (!before || before.status !== 'pending') return { ok: false, status: before?.status }
      const now = new Date().toISOString()
      if (status === 'approved') {
        const expiresAt = computeExpiresAt(now)
        db.run(sql`UPDATE autonomy_approvals SET status = ${status}, decided_at = ${now}, decided_by = ${actor}, expires_at = ${expiresAt}
          WHERE id = ${id} AND status = 'pending'`)
      } else {
        db.run(sql`UPDATE autonomy_approvals SET status = ${status}, decided_at = ${now}, decided_by = ${actor}
          WHERE id = ${id} AND status = 'pending'`)
      }

      // Apply-on-approval: the ONLY place a gated self-improvement change
      // actually fires. Never bypassed, never fired on 'rejected'. A missing
      // handler for the category is not an error — some categories (e.g. a
      // rejection, or a category with no wired apply mechanics yet) have
      // nothing to run.
      if (status === 'approved') {
        const handler = applyHandlers.get(before.category)
        if (handler) {
          const approval = rowToApproval({ ...before, status, decided_at: now, decided_by: actor })
          try {
            const result = handler(approval)
            if (result && typeof (result as Promise<void>).then === 'function') {
              (result as Promise<void>).catch((err) =>
                logger?.error?.({ err, approvalId: id, category: before.category }, 'Autonomy: apply-on-approval handler rejected'))
            }
          } catch (err) {
            logger?.error?.({ err, approvalId: id, category: before.category }, 'Autonomy: apply-on-approval handler threw')
          }
        }
      }

      return { ok: true, status }
    },

    /**
     * D4 — the grant ledger IS the approval row itself. A single CAS UPDATE:
     * only a row that is 'approved', not yet consumed, and (if it carries an
     * expiry) not yet expired can ever be granted — and the WHERE clause
     * guarantees exactly one caller ever observes granted:true for a given
     * row, even under concurrent callers, because the UPDATE only touches (and
     * RETURNs) the row it actually flipped.
     *
     * SECURITY INVARIANT: this is the ONLY path that can turn a prior human
     * approval into a live "proceed" signal. It must never be consulted for a
     * deterministic gate 'deny' (sensitive-path denylist) — callers gate this
     * check behind their own escalate/ladder-deny branch, never the gate-deny
     * branch, so a grant can never override a hard deny.
     */
    consumeGrant(input: { conversationId: string; toolName: string; argHash: string; now?: string }): { granted: boolean; approvalId?: number } {
      const now = input.now ?? new Date().toISOString()
      const rows = db.all(sql`UPDATE autonomy_approvals
        SET consumed_at = ${now}
        WHERE conversation_id = ${input.conversationId}
          AND tool_name = ${input.toolName}
          AND arg_hash = ${input.argHash}
          AND kind = 'tool_call'
          AND status = 'approved'
          AND consumed_at IS NULL
          AND (expires_at IS NULL OR expires_at > ${now})
        RETURNING id`) as Array<{ id: number }>
      const row = rows[0]
      if (!row) return { granted: false }
      return { granted: true, approvalId: Number(row.id) }
    },

    /**
     * Record why a resume driven by this approval failed — or clear it with
     * `null` once a later attempt succeeds. resume_error is what puts a row on
     * the dashboard's stuck list, so leaving a stale one behind would keep an
     * already-resumed approval flagged as broken forever.
     */
    setResumeError(approvalId: number, error: string | null): void {
      db.run(sql`UPDATE autonomy_approvals SET resume_error = ${error} WHERE id = ${approvalId}`)
    },

    /**
     * F2 T6 (R1) — claim the right to drive this approval's resume. A single
     * CAS UPDATE: only the caller that flips `resume_started_at` from NULL sees
     * true, so the bus subscriber (operator decision) and the hourly sweep can
     * both fire for the same row without ever starting two resumed runs.
     *
     * The claim lives on the APPROVAL rather than the run row because the run
     * row's own status is what a resume immediately transitions — it cannot
     * also serve as the "someone is already on this" flag.
     */
    claimResume(approvalId: number, now?: string): boolean {
      const rows = db.all(sql`UPDATE autonomy_approvals
        SET resume_started_at = ${now ?? new Date().toISOString()}
        WHERE id = ${approvalId} AND resume_started_at IS NULL
        RETURNING id`) as Array<{ id: number }>
      return rows.length > 0
    },

    /**
     * Release a claim: the resume refused (so a later sweep should retry it),
     * or the claim went stale because the claiming process died mid-resume.
     */
    releaseResume(approvalId: number): void {
      db.run(sql`UPDATE autonomy_approvals SET resume_started_at = NULL WHERE id = ${approvalId}`)
    },

    /**
     * F2 T6 fix 1 — kill an APPROVED but never-consumed grant.
     *
     * A grant is scoped to (conversation, tool, argHash), NOT to the run that
     * escalated for it: cancelling that run therefore does nothing to the
     * grant, and consumeGrant would still hand it to a later run in the same
     * conversation — firing the exact action the operator just cancelled, with
     * no escalation and nothing in the queue to see. This is the revoke.
     *
     * A DEDICATED terminal status, never a faked consumed_at: "consumed" means
     * the action ran, and recording a revoke that way would misreport history
     * (and hide it from the resume sweep's unconsumed-grant arm). consumeGrant
     * requires status='approved', so a revoked row can never be granted again.
     * CAS-guarded: an already-consumed grant cannot be revoked (too late — it
     * really did run), and a revoke lands at most once.
     */
    revokeGrant(approvalId: number, now?: string): boolean {
      const rows = db.all(sql`UPDATE autonomy_approvals
        SET status = 'revoked', revoked_at = ${now ?? new Date().toISOString()}
        WHERE id = ${approvalId} AND status = 'approved' AND consumed_at IS NULL
        RETURNING id`) as Array<{ id: number }>
      return rows.length > 0
    },

    /**
     * Expire stale approvals (scheduler sweep). Two CAS UPDATEs, each a
     * single atomic statement (I1 — a SELECT-then-UPDATE pair would race an
     * operator deciding the row between the two steps, e.g. approving it
     * right after it was read as stale but before the UPDATE lands, which
     * would then wrongly emit an expiry for a row that just became usable):
     *
     *  1. 'pending' rows nobody ever decided — the ordinary TTL case.
     *  2. I5(b) — 'approved' rows nobody ever consumed. An approval grants a
     *     fresh TTL window on decide() (I5(a)), so if THAT window also lapses
     *     unused the grant must stop being a live "proceed" signal too,
     *     exactly like an undecided row nobody acted on.
     *
     * Returns the rows that were just expired (id/runId/conversationId) so
     * the caller can emit a per-row bus event/WS frame — Task 6 subscribes to
     * unpark/fail whatever run was waiting on that approval.
     */
    expireStale(nowIso: string): Array<{ id: number; runId: string | null; conversationId: string | null }> {
      const expiredPending = db.all(sql`UPDATE autonomy_approvals
        SET status = 'expired', decided_at = ${nowIso}
        WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ${nowIso}
        RETURNING id, run_id, conversation_id`) as Array<{ id: number; run_id: string | null; conversation_id: string | null }>

      const expiredApproved = db.all(sql`UPDATE autonomy_approvals
        SET status = 'expired', decided_at = ${nowIso}
        WHERE status = 'approved' AND consumed_at IS NULL AND expires_at IS NOT NULL AND expires_at < ${nowIso}
        RETURNING id, run_id, conversation_id`) as Array<{ id: number; run_id: string | null; conversation_id: string | null }>

      return [...expiredPending, ...expiredApproved].map((r) => ({ id: r.id, runId: r.run_id ?? null, conversationId: r.conversation_id ?? null }))
    },
  }
}

export type AutonomyPolicy = ReturnType<typeof createAutonomyPolicy>
