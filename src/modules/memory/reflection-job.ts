// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 dream-engine — the `memory.reflection` scheduler job. Extracted from
// index.ts's onStart (Task 10 review fix) so the REAL registered handler is
// directly testable without booting the rest of the memory module (vault
// indexer/watcher, embeddings, consolidator) — the exact same code ships in
// production; only the wiring was externalized, no behavior change.

import { sql } from 'drizzle-orm'
import type { ModuleContext } from '@core/types'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import { createCompletedRunsPort } from '@modules/agent/completed-runs.js'
import { buildReflectionBuckets } from './reflection-engine.js'
import { bridgeImprovementsToForge } from './reflection-forge-bridge.js'
import { fetchExternalDigest } from './web-egress.js'

export interface ReflectionJobEpisodicPort {
  list(opts: { limit: number }): Array<{ content: unknown }>
}

interface JobScheduler {
  registerHandler(name: string, fn: () => Promise<unknown>): void
  list(): Array<{ handler?: string }>
  create(job: Record<string, unknown>): unknown
}

/**
 * Registers the `memory.reflection` handler and seeds its nightly cron job
 * (idempotent — safe to call again on restart).
 */
export function registerReflectionJob(
  scheduler: JobScheduler,
  ctx: ModuleContext,
  episodic: ReflectionJobEpisodicPort,
): void {
  scheduler.registerHandler('memory.reflection', async () => {
    // Task 10 fix: the `memory.reflection` feature flag is the PRIMARY
    // runtime switch — read FRESH on every fire (not cached at onStart like
    // a config value would be), so an operator flipping it via
    // `features.setEnabled` takes effect on the very next scheduled run with
    // no restart/config edit. Config stays a headless default: either one
    // being true runs the loop. Absent feature store fails safe to "config
    // decides".
    const enabled = (ctx as any).securityGate?.features?.isEnabled?.('memory.reflection') === true
      || (ctx.config as any)?.memory?.reflection?.enabled === true
    if (!enabled) return { recorded: false }
    const today = new Date().toISOString().slice(0, 10)

    // --- gather the day's signals (all best-effort) ---
    let overdueCount = 0
    try {
      const nowIso = new Date().toISOString()
      overdueCount = ((ctx.db as any).all(
        sql`SELECT COUNT(*) as c FROM conversations WHERE due_date IS NOT NULL AND due_date < ${nowIso}`,
      ) as Array<{ c: number }>)[0]?.c ?? 0
    } catch { /* signal unavailable */ }

    let completedRuns: Array<{ sessionId: string; toolNames: string[]; success: boolean }> = []
    try {
      // includeFailed=true — the "a run errored" improvement trigger needs
      // actual failures to reflect on; listCompletedSessions defaults to
      // completed-only for its other caller (the skill-candidate miner).
      completedRuns = createCompletedRunsPort(ctx.db)
        .listCompletedSessions(Date.now() - 24 * 3_600_000, true)
        .map((r) => ({ sessionId: r.sessionId, toolNames: r.toolNames, success: r.success }))
    } catch { /* agent module absent */ }

    let recentMemories: string[] = []
    try {
      recentMemories = episodic.list({ limit: 20 }).map((m: any) => String(m.content)).filter(Boolean)
    } catch { /* episodic unavailable */ }

    // Cheap-tier ('heartbeat') LLM summariser — fail-open (a missing model
    // or a model error leaves a valid deterministic digest).
    const summarize = async (prompt: string): Promise<string> => {
      if (!ctx.model) throw new Error('model gateway unavailable')
      const de = (ctx as any).decisionEngine as DecisionEngine | undefined
      const tier = (() => { try { return de?.resolveForTier?.('heartbeat') ?? null } catch { return null } })()
      const res = await ctx.model.complete({
        messages: [{ role: 'user', content: prompt }],
        system: 'Reply with ONLY the requested JSON object. No prose.',
        maxTokens: 800,
        temperature: 0.3,
        ...(tier ? { provider: tier.provider, model: tier.model } : {}),
      })
      return (res.content as any[]).map((b) => (b.type === 'text' ? b.text : '')).join('\n')
    }

    const { buckets, improvements } = await buildReflectionBuckets(
      { completedRuns, recentMemories, overdueCount },
      { summarize, logger: ctx.logger, modelPassEnabled: enabled },
    )
    if (improvements.length > 0) {
      // Bridge into forge's feedback store (fail-safe — never throws; see
      // reflection-forge-bridge.ts). `reflection:${today}` is the
      // conversationId marker forge's record requires.
      try {
        const bridged = bridgeImprovementsToForge((ctx as any).forge, improvements, `reflection:${today}`, ctx.logger)
        ctx.logger.debug({ count: improvements.length, bridged }, 'reflection improvement candidates bridged to forge')
      } catch (err) {
        ctx.logger.warn({ err: String(err) }, 'reflection→forge bridge failed (fail-open)')
      }
    }

    // 5th bucket — web-egress (OFF unless config enables it). Every fetch is
    // SSRF-guarded (safeFetch re-validates each redirect hop) and the
    // per-feed body is size-capped.
    const webEgress = (ctx.config as any)?.memory?.reflection?.webEgress
    if (webEgress?.enabled === true && Array.isArray(webEgress.urls) && webEgress.urls.length > 0) {
      try {
        const { safeFetch } = await import('@modules/research/ssrf-guard.js')
        const external = await fetchExternalDigest({ urls: webEgress.urls, safeFetch, maxItems: webEgress.maxItems ?? 5, logger: ctx.logger })
        const bucket = buckets.find((b) => b.key === 'external')
        if (bucket) bucket.items.push(...external)
      } catch (err) {
        ctx.logger.warn({ err: String(err) }, 'web-egress bucket skipped')
      }
    }

    ;(ctx as any).reflectionDigests.record({ date: today, buckets })
    ctx.bus.emit('eyas.memory.reflection', { date: today })
    return { recorded: true, date: today }
  })

  if (!scheduler.list().some((j) => j.handler === 'memory.reflection')) {
    scheduler.create({
      name: 'Nightly Reflection',
      description: 'Build the morning reflection digest (no-op unless enabled in config)',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '30 5 * * *' }),
      handler: 'memory.reflection',
    })
  }
}
