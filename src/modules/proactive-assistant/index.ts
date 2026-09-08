// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { createTaskSourceAdapter } from './source-adapters.js'
import { createLessonLearner } from './lesson-learner.js'
import { createBotExecutor } from './bot-executor.js'
import { createHeartbeat, type HeartbeatSignals } from './heartbeat.js'
import { composeHeartbeat } from './heartbeat-composer.js'
import { createProactiveRoutes } from './routes.js'
import type { ProactiveServices } from './routes.js'
import type { ProactiveAlert, LessonLearned } from './types.js'

export const proactiveAssistantModule: EyasModule = {
  id: 'proactive-assistant',
  name: 'Proactive Assistant',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Source adapters, lesson learner, bot executor — monitors tasks and processes autonomous work',
  dependencies: ['conversations'],
  optional: ['scheduler', 'agent', 'tools'],

  async onRegister(ctx: ModuleContext) {
    const adapters = [createTaskSourceAdapter(ctx.db)]
    const lessonLearner = createLessonLearner(ctx.db)

    // Bot executor requires agent module — create lazily
    let botExecutor: ReturnType<typeof createBotExecutor> | null = null
    if (ctx.hasModule('agent') && ctx.hasModule('tools')) {
      // The agent module exposes its services on ctx.agents (plural); reading
      // ctx.agent (singular) left botExecutor permanently null — a latent bug
      // that kept autonomous bot-execution dormant. Safe by default: it only
      // acts on conversations the operator placed in a bot_listen stage.
      const agentMod = (ctx as any).agents
      const toolsMod = (ctx as any).tools
      if (agentMod?.runner && agentMod?.registry && toolsMod?.registry) {
        botExecutor = createBotExecutor({
          db: ctx.db,
          agentRunner: agentMod.runner,
          agentRegistry: agentMod.registry,
          toolRegistry: toolsMod.registry,
          logger: ctx.logger,
          supervisor: agentMod.supervisor,
          promptAssembler: (ctx as any).promptAssembler,
          // F2 T7 — autonomous board runs are the critic's main population, so
          // they carry the same verification deps the retry/refresh routes do.
          critic: agentMod.critic,
          verify: agentMod.verify,
          get eventStore() { return (ctx as any).eventStore?.events },
          getCheckpoint: agentMod.getCheckpoint,
          // F2 T8 — threshold-band alert emission on token tracking.
          budgetEngine: agentMod.budgetEngine,
          // F2 T9 — config `model.pricing` override for the cost rollup.
          get pricingOverrides() { return (ctx.config as any)?.model?.pricing },
          // Task 11 — records what actually reached the model on each run.
          // Lazy: observability may register after proactive-assistant.
          get contextRecorder() { return (ctx as any).contextRecorder },
        })
      }
    }

    const services: ProactiveServices = {
      adapters,
      lessonLearner,
      botExecutor: botExecutor as any,
      alerts: [] as ProactiveAlert[],
      lessons: [] as LessonLearned[],
    }

    ;(ctx as any).proactiveAssistant = services
    ctx.logger.info('Proactive assistant module registered')
  },

  async onStart(ctx: ModuleContext) {
    const services = (ctx as any).proactiveAssistant as ProactiveServices

    // Heartbeat autonomy (Cap 5) — a deterministic, leader-gated check that
    // spends 0 LLM tokens when the system is quiet. OFF by default (privacy);
    // the operator opts in via config.proactive.heartbeat.enabled and sets a
    // model tier. News surfaces as a proactive alert (existing /proactive UI).
    const hbConfig = ((ctx.config as any)?.proactive?.heartbeat ?? {}) as {
      enabled?: boolean
      quietHours?: { startHour: number; endHour: number }
    }
    const heartbeat = createHeartbeat({
      enabled: hbConfig.enabled === true,
      // Task 10 fix: the `proactive.heartbeat` feature flag is the PRIMARY
      // runtime switch for the outer tick gate too — read FRESH on every
      // tick (unlike `enabled` above, captured once at onStart), so an
      // operator flipping it via `features.setEnabled` fires the loop on the
      // very next tick with no restart/config edit, regardless of the cached
      // config value. Either one being true runs the tick.
      isEnabled: () => hbConfig.enabled === true
        || (ctx as any).securityGate?.features?.isEnabled?.('proactive.heartbeat') === true,
      quietHours: hbConfig.quietHours,
      collect: async (): Promise<HeartbeatSignals> => {
        const signals: HeartbeatSignals = {}
        try {
          const nowIso = new Date().toISOString()
          const row = ((ctx.db as any).all(
            sql`SELECT COUNT(*) as c FROM conversations WHERE due_date IS NOT NULL AND due_date < ${nowIso}`,
          ) as Array<{ c: number }>)[0]
          if (row?.c) signals.boardStuck = Number(row.c)
        } catch { /* board signal unavailable */ }
        // Wave 2 — SLA evaluation (overdue + stale) for escalation-quality heartbeats
        try {
          const { evaluateSla } = await import('./sla.js')
          const rows = (ctx.db as any).all(
            sql`SELECT id, title, project_id, agent_id, stage, due_date, updated_at, status FROM conversations WHERE status IS NULL OR status NOT IN ('archived', 'done', 'completed') LIMIT 500`,
          ) as any[]
          const sla = evaluateSla(rows)
          if (sla.count) signals.slaBreaches = sla.count
          ;(ctx as any)._lastSlaSignal = sla
        } catch { /* sla unavailable */ }
        try {
          const health = (ctx as any).communication?.channelHealth?.list?.() ?? {}
          const fatal = Object.values(health).filter((s: any) => s?.status === 'fatal').length
          if (fatal) signals.systemAlerts = fatal
        } catch { /* channel-health unavailable */ }
        return signals
      },
      notify: async (signals, reasons) => {
        // Composer feature flag (Phase-3 loop enable, OFF by default) — an
        // additional guard around the MODEL call itself, on top of the
        // existing hbConfig.enabled gate above (Task 10 makes this flag the
        // primary switch). Read fresh at fire time, never cached.
        const composerEnabled = (ctx as any).securityGate?.features?.isEnabled?.('proactive.heartbeat') === true
        const composed = await composeHeartbeat(ctx, signals, reasons, composerEnabled)
        const alert: ProactiveAlert = {
          id: generateId(),
          type: 'insight',
          title: composed.title,
          body: composed.body,
          source: 'audit',
          priority: 'normal',
          actionable: false,
          createdAt: new Date().toISOString(),
        }
        services.alerts.push(alert)
        ctx.bus.emit('eyas.proactive.heartbeat', { reasons, alertId: alert.id })
      },
    })
    ;(services as any).heartbeat = heartbeat

    // Mount routes
    createProactiveRoutes(ctx.http, services)

    // The one place a bot-executor pass is triggered from, shared by the two
    // callers below: the immediate bus kicks and the cron sweep. The executor's
    // single-flight guard coalesces overlapping calls.
    const runBotExecutor = async (): Promise<{ processed: number }> => {
      const processed = await services.botExecutor.processWaiting()
      if (processed > 0) {
        ctx.bus.emit('proactive:bot-executor', { processed })
        ctx.logger.info({ processed }, 'Bot executor processed conversations')
      }
      return { processed }
    }

    // Immediate pickup: a card armed by the board's stage automation, or a task
    // handed over by `assign_task`, runs the executor right away instead of
    // waiting up to 10 minutes for the cron. The cron job below stays as a
    // crash-recovery sweep for anything an in-process kick missed.
    if (services.botExecutor) {
      const kick = async () => {
        // A bus handler is fire-and-forget — swallow here so a failed pass
        // cannot surface as an unhandled rejection. The cron path lets the
        // scheduler record the failure instead.
        try {
          await runBotExecutor()
        } catch (err) {
          ctx.logger.error({ err }, 'Bot executor kick failed')
        }
      }
      ctx.bus.on('eyas.board.card_armed', kick)
      ctx.bus.on('eyas.board.task_assigned', kick)
      ctx.logger.info('Bot executor wired to immediate board pickup signals')
    }

    // Register scheduler jobs if available
    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler

      // Every 5 minutes — check source adapters for alerts
      scheduler.registerHandler('proactive.checkAlerts', async () => {
        const newAlerts: ProactiveAlert[] = []
        for (const adapter of services.adapters) {
          const found = await adapter.check()
          newAlerts.push(...found)
        }
        const existingIds = new Set(services.alerts.map((a: ProactiveAlert) => a.id))
        let added = 0
        for (const alert of newAlerts) {
          if (!existingIds.has(alert.id)) {
            services.alerts.push(alert)
            added++
          }
        }
        ctx.bus.emit('proactive:alerts', { newAlerts: added, total: services.alerts.length })
        ctx.logger.info({ newAlerts: added, total: services.alerts.length }, 'Proactive alert check complete')
        return { newAlerts: added, total: services.alerts.length }
      })

      // Weekly Friday 18:00 — lesson learner analysis
      scheduler.registerHandler('proactive.lessonAnalysis', async () => {
        const lessons = services.lessonLearner.analyze(7)
        services.lessons.push(...lessons)
        ctx.bus.emit('proactive:lessons', { lessons: lessons.length })
        ctx.logger.info({ lessons: lessons.length }, 'Weekly lesson analysis complete')
        return { lessons: lessons.length }
      })

      // Every 30 minutes — heartbeat (no-op unless enabled; 0 tokens when quiet)
      scheduler.registerHandler('proactive.heartbeat', async () => {
        return heartbeat.tick()
      })

      // Every 10 minutes — bot executor sweep (crash recovery; the bus kicks
      // above are the normal path)
      if (services.botExecutor) {
        scheduler.registerHandler('proactive.botExecutor', runBotExecutor)
      }

      // Seed jobs if not already present
      const existing = scheduler.list()

      if (!existing.some((j: any) => j.handler === 'proactive.checkAlerts')) {
        scheduler.create({
          name: 'Proactive Alert Check',
          description: 'Check source adapters for new alerts',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '*/5 * * * *' }),
          handler: 'proactive.checkAlerts',
        })
        ctx.logger.info('Seeded proactive alert check job (every 5 min)')
      }

      if (!existing.some((j: any) => j.handler === 'proactive.lessonAnalysis')) {
        scheduler.create({
          name: 'Weekly Lesson Analysis',
          description: 'Analyze closed conversations for reusable patterns',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 18 * * 5' }),
          handler: 'proactive.lessonAnalysis',
        })
        ctx.logger.info('Seeded weekly lesson analysis job (Friday 18:00)')
      }

      if (!existing.some((j: any) => j.handler === 'proactive.heartbeat')) {
        scheduler.create({
          name: 'Heartbeat',
          description: 'Deterministic check for newsworthy signals (no-op unless enabled in config)',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '*/30 * * * *' }),
          handler: 'proactive.heartbeat',
        })
        ctx.logger.info('Seeded heartbeat job (every 30 min; disabled by default)')
      }

      if (services.botExecutor && !existing.some((j: any) => j.handler === 'proactive.botExecutor')) {
        scheduler.create({
          name: 'Bot Executor Check',
          description: 'Process conversations in bot_listen stages',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '*/10 * * * *' }),
          handler: 'proactive.botExecutor',
        })
        ctx.logger.info('Seeded bot executor check job (every 10 min)')
      }
    }

    ctx.logger.info('Proactive assistant module started')
  },

  async onStop(_ctx: ModuleContext) {
    // No cleanup needed — scheduler handles stopping cron jobs
  },
}
