// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createIntelTables } from './schema.js'
import { createIntelService } from './service.js'
import { createIntelRoutes } from './routes.js'

export const intelModule: EyasModule = {
  id: 'intel',
  name: 'Intel Registry',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Proactive intelligence fact registry with daily brief',
  dependencies: [],
  optional: ['scheduler', 'notifications'],

  async onRegister(ctx: ModuleContext) {
    createIntelTables(ctx.db)
    try {
      ;(ctx as any).permissions?.registerSubject?.('Intel', {
        actions: ['read', 'create', 'update', 'delete'],
        defaults: { owner: ['delete'], admin: ['delete'], user: ['create'], agent: ['create'], guest: [] },
      })
    } catch { /* already registered */ }
    ctx.logger.info('Intel module registered')
  },

  async onStart(ctx: ModuleContext) {
    const intel = createIntelService(ctx.db)
    ;(ctx as any).intel = intel
    createIntelRoutes(ctx.http, intel)

    // Seed scheduled jobs when scheduler is present (collector + daily brief).
    const scheduler = (ctx as any).scheduler
    if (scheduler?.registerHandler) {
      scheduler.registerHandler('intel.collector', async () => {
        // Collector is intentionally thin here: agents / proactive jobs write
        // facts via the service/API. This tick only closes facts past expires_at.
        try {
          const { sql: s } = await import('drizzle-orm')
          ctx.db.run(s`
            UPDATE intel_facts SET status = 'closed', updated_at = datetime('now')
            WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND status != 'closed'
          `)
        } catch { /* best-effort */ }
        ctx.bus.emit('eyas.intel.collector.tick', { at: new Date().toISOString() })
        return { ok: true }
      })

      scheduler.registerHandler('intel.daily_brief', async () => {
        const brief = intel.buildDailyBrief(14)
        ctx.bus.emit('eyas.intel.brief.ready', {
          topCount: brief.topSignals.length,
          domains: Object.keys(brief.byDomain),
          generatedAt: brief.generatedAt,
        })
        // Optional telegram notify via notifications module if present
        try {
          const notif = (ctx as any).notifications
          if (notif?.router && brief.topSignals.length > 0) {
            const lines = brief.topSignals.map((s: any, i: number) => `${i + 1}. ${s.title}`).join('\n')
            await notif.router.send?.({
              channel: 'telegram',
              title: 'Daily intel brief',
              body: lines,
            })
          }
        } catch { /* notifications optional */ }
        return brief
      })

      // Seed jobs once if none exist. Use the scheduler CreateJobInput shape
      // (triggerType + JSON triggerConfig) — not the legacy { cron, enabled } form.
      try {
        const list = (scheduler.list ?? scheduler.listJobs)?.bind(scheduler)
        const jobs: Array<{ handler?: string }> = list ? list() : []
        const create = (scheduler.create ?? scheduler.createJob)?.bind(scheduler)
        if (!create) throw new Error('scheduler has no create/createJob')

        if (!jobs.some((j) => j.handler === 'intel.collector')) {
          create({
            name: 'Intel collector',
            description: 'Hourly tick: close expired intel facts and emit collector event',
            triggerType: 'cron',
            triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
            handler: 'intel.collector',
            source: 'system',
            kind: 'handler',
            category: 'intel',
            status: 'disabled',
          })
        }
        if (!jobs.some((j) => j.handler === 'intel.daily_brief')) {
          create({
            name: 'Intel daily brief',
            description: 'Daily top-signal brief (07:00 UTC when enabled)',
            triggerType: 'cron',
            triggerConfig: JSON.stringify({ cron: '0 7 * * *' }),
            handler: 'intel.daily_brief',
            source: 'system',
            kind: 'handler',
            category: 'intel',
            status: 'disabled',
          })
        }
      } catch (err) {
        ctx.logger.warn({ err }, 'Intel: could not seed scheduler jobs')
      }
    }

    ctx.logger.info('Intel module started')
  },

  async onStop() {},
}
