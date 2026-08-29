// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createDeterministicGate } from './deterministic-gate.js'
import { createLlmJudge } from './llm-judge.js'
import { createRuntimeMonitor } from './runtime-monitor.js'
import { createLazyGateway } from '@modules/model/lazy-gateway'
import { DEFAULT_CONFIG } from './types.js'
import type { SecurityCheckResult, SecurityEvent, SecurityGateConfig } from './types.js'
import { createApprovalTierPolicy, DEFAULT_APPROVAL_CONFIG } from './approval-tiers.js'
import { createAutonomyTables, createAutonomyPolicy } from './autonomy-policy.js'
import { createAutonomyFeatures } from './autonomy-features.js'
import { WS_TOPICS } from '@shared/ws-topics.js'

/**
 * Thin autonomy push: what changed, never who or to what. WS topic
 * subscription is authenticated but NOT permission-scoped, while the ladder
 * and the approval queue are admin-visible data — so the frame carries only
 * the ids a client needs to refetch over the CASL-guarded REST routes.
 */
function thinAutonomyPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const thin: Record<string, unknown> = {}
  // 'runId' backs Task 6's expired-approval → run unpark/fail subscription
  // (autonomy:approval-expired) — still just an id, never args or prose.
  for (const key of ['category', 'approvalId', 'key', 'runId'] as const) {
    if (payload[key] !== undefined) thin[key] = payload[key]
  }
  return thin
}

/** Lazy — ctx.wsRegistry is set during bootstrap, after every onRegister has run. */
function createAutonomyBroadcast(ctx: ModuleContext): (event: string, payload: Record<string, unknown>) => void {
  return (event, payload) => {
    ;(ctx as any).wsRegistry?.broadcast(WS_TOPICS.autonomy, { event, data: thinAutonomyPayload(payload) })
  }
}

export const securityGateModule: EyasModule = {
  id: 'security-gate',
  name: 'Security Gate',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: '3-checkpoint security validation for tool calls: deterministic, LLM judge, runtime monitor',
  dependencies: ['model', 'tools'],
  optional: ['tools'],
  frontend: {
    widgets: [{ id: 'security-gate.attention', titleKey: 'home.widget.attention.title' }],
  },

  async onRegister(ctx: ModuleContext) {
    // Create security_events table
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      input TEXT,
      decision TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      reason TEXT,
      risk_tier TEXT NOT NULL,
      conversation_id TEXT,
      agent_id TEXT,
      session_risk_score REAL DEFAULT 0,
      created_at TEXT NOT NULL
    )`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_security_events_decision ON security_events(decision)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_security_events_tool ON security_events(tool_name)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at)`)

    // Graduated autonomy trust-ladder (tables + seed + CASL subject).
    createAutonomyTables(ctx.db)
    const broadcastAutonomy = createAutonomyBroadcast(ctx)
    // An enqueued approval blocks the requesting agent until a human acts on
    // it, so the queue has to announce itself: bus event for in-process
    // listeners, WS ping for the dashboard badge.
    const autonomyPolicy = createAutonomyPolicy(ctx.db, ctx.logger, {
      onApprovalCreated: (approval) => {
        ctx.bus.emit('autonomy:approval-requested', {
          approvalId: approval.id,
          category: approval.category,
          toolName: approval.toolName,
          reason: approval.reason,
        })
        broadcastAutonomy('autonomy:approval-requested', { approvalId: approval.id, category: approval.category })
      },
    }, { defaultTtlHours: ctx.config?.security?.approvalTtlHours })
    autonomyPolicy.seedDefaults()

    // Phase-3 loop enable/disable flags — a separate, minimal on/off store
    // from the ladder above (see autonomy-features.ts header for why).
    const autonomyFeatures = createAutonomyFeatures(ctx.db)
    try {
      ctx.permissions.registerSubject('Autonomy', {
        actions: ['read', 'update', 'approve', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read'],
          agent: [],
          guest: [],
        },
      })
    } catch {
      // Already registered — safe to ignore.
    }

    const config: SecurityGateConfig = DEFAULT_CONFIG

    // Initialize checkpoints
    // Tier lookup consults the tools module registry lazily via the shared
    // ModuleContext: the tools module attaches its registry in its own
    // onRegister and validateToolCall only runs post-start, so ordering and
    // import cycles are non-issues.
    const deterministicGate = createDeterministicGate(config, {
      getRegistryTier: (name) => (ctx as any).tools?.registry?.get?.(name)?.riskTier,
      sensitivePathLiterals: [ctx.config?.database?.path].filter((p): p is string => Boolean(p)),
    })
    // Lazy gateway: privacy wraps ctx.model during its onStart, which runs
    // after this onRegister — resolving per call keeps the judge (itself a
    // model-egress path) on the fully-wrapped gateway.
    // Tier resolver is created in the model module's onStart — resolve lazily
    // at check time (same pattern as forge/self-learning).
    const llmJudge = createLlmJudge(createLazyGateway(() => ctx.model), {
      getTierResolver: () => (ctx as any).decisionEngine,
      logger: ctx.logger,
    })
    const runtimeMonitor = createRuntimeMonitor(config)

    function logEvent(result: SecurityCheckResult, toolName: string, input: Record<string, unknown>, extra?: { conversationId?: string; agentId?: string; sessionRiskScore?: number }): void {
      ctx.db.run(sql`INSERT INTO security_events (tool_name, input, decision, checkpoint, reason, risk_tier, conversation_id, agent_id, session_risk_score, created_at)
        VALUES (${toolName}, ${JSON.stringify(input)}, ${result.decision}, ${result.checkpoint}, ${result.reason}, ${result.riskTier},
                ${extra?.conversationId ?? null}, ${extra?.agentId ?? null}, ${extra?.sessionRiskScore ?? 0}, ${result.timestamp})`)
    }

    // Approval tier policy (Phase 3F). Default: autopilot — no approval prompts
    // unless an operator explicitly opts in. Exposed on the gate object so
    // callers (agent-runner, tools) can consult it without pulling in a
    // separate dependency.
    const approvalPolicy = createApprovalTierPolicy(DEFAULT_APPROVAL_CONFIG)

    const gate = {
      async validateToolCall(
        toolName: string,
        input: Record<string, unknown>,
        callCtx?: { conversationId?: string; agentId?: string; parentGoal?: string },
      ): Promise<SecurityCheckResult> {
        if (!config.enabled) {
          return { decision: 'allow', checkpoint: 'deterministic', reason: 'Security gate disabled', riskTier: 'green', timestamp: new Date().toISOString() }
        }

        // Checkpoint 1: Deterministic gate
        const det = deterministicGate.check(toolName, input)
        if (det.decision === 'allow') {
          logEvent(det, toolName, input, callCtx)
          return det
        }
        if (det.decision === 'deny') {
          logEvent(det, toolName, input, callCtx)
          return det
        }

        // Checkpoint 2: LLM judge (for yellow/red tier)
        const judge = await llmJudge.check(toolName, input, det.riskTier, callCtx?.parentGoal)
        logEvent(judge, toolName, input, callCtx)
        if (judge.decision === 'deny') deterministicGate.recordDenial()
        else deterministicGate.resetStreak()

        return judge
      },

      deterministicGate,
      runtimeMonitor,
      approvalPolicy,
      autonomyPolicy,
      features: autonomyFeatures,
      config,
    }

    ;(ctx as any).securityGate = gate
    ctx.logger.info('Security gate module registered — 3 checkpoints active')
  },

  async onStart(ctx: ModuleContext) {
    const gate = (ctx as any).securityGate
    const broadcastAutonomy = createAutonomyBroadcast(ctx)
    const { createSecurityGateRoutes, countApprovalsFor, countStuckResumesFor } = await import('./routes.js')
    createSecurityGateRoutes(
      ctx.http,
      ctx.db,
      gate.config,
      gate.autonomyPolicy,
      // Every ladder/queue change the routes announce also goes out on the
      // autonomy topic — one operator's decision has to reach every other open
      // dashboard, not just the tab that made it.
      (event, payload) => {
        ctx.bus.emit(event, payload)
        if (event.startsWith('autonomy:')) broadcastAutonomy(event, payload)
      },
      gate.features,
      // S1 REST scoping — resolves a conversation_id to its human owner
      // (walking the parent chain for 'system'-owned orchestrator children) so
      // a non-admin caller only ever sees their own approvals.
      (ctx as any).conversations,
    )

    // Approval COUNTS on the service handle, for callers outside this module
    // (home's pulse tile) that need "how many", not the rows themselves.
    // Same ownership scoping as GET /autonomy/approvals above — see
    // countApprovalsFor/countStuckResumesFor in routes.ts.
    gate.countApprovalsFor = (args: { userId: string; privileged: boolean; status?: 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked' }) =>
      countApprovalsFor(gate.autonomyPolicy, (ctx as any).conversations, args)
    gate.countStuckResumesFor = (args: { userId: string; privileged: boolean }) =>
      countStuckResumesFor(gate.autonomyPolicy, (ctx as any).conversations, args)

    // D5 — hourly TTL sweep: a pending approval nobody acted on for
    // security.approvalTtlHours (default 72h) auto-expires so it can't sit
    // forever as a silent block on whatever run is waiting on it. Guarded
    // (rather than a hard dependency) because the scheduler module is
    // optional and unit tests construct a bare ModuleContext without it.
    if (typeof (ctx as any).hasModule === 'function' && ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler
      const sweep = () => {
        const expired = gate.autonomyPolicy.expireStale(new Date().toISOString())
        for (const row of expired) {
          const payload = { approvalId: row.id, runId: row.runId }
          ctx.bus.emit('autonomy:approval-expired', payload)
          broadcastAutonomy('autonomy:approval-expired', payload)
        }
      }
      scheduler.registerHandler('security.approvals.sweep', sweep)
      if (!scheduler.list().some((j: any) => j.handler === 'security.approvals.sweep')) {
        scheduler.create({
          name: 'Approval TTL Sweep',
          description: 'Expire pending approvals whose TTL has passed',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
          handler: 'security.approvals.sweep',
        })
      }
    }

    ctx.logger.info('Security gate module started')
  },

  async onStop() {},
}
