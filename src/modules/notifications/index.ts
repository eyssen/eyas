// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasModule, ModuleContext } from '@core/types'
import { createNotificationTables } from './schema.js'
import { createNotificationRouter } from './router.js'
import { createWebChannel } from './channels/web.js'
import { createTelegramChannel } from './channels/telegram.js'
import { createEmailChannel } from './channels/email.js'
import { createWebhookChannel, type WebhookConfig } from './channels/webhook.js'
import { createBatchEngine } from './batch.js'
import { createRetryEngine } from './retry.js'
import { createTemplateEngine } from './templates.js'
import { createNotificationRoutes } from './routes.js'

const PROCESS_INTERVAL_MS = 30_000 // scan due batches + retries every 30s

export const notificationsModule: EyasModule = {
  id: 'notifications',
  name: 'Notifications',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Unified notification system — routing, preferences, multi-channel delivery',
  dependencies: [],
  optional: ['communication', 'secrets'],

  frontend: {
    pages: [
      { id: 'notification-settings', path: '/settings/notifications', title: 'Notification Settings', icon: 'bell', order: 80 },
    ],
  },

  async onRegister(ctx: ModuleContext) {
    createNotificationTables(ctx.db)
    const router = createNotificationRouter({ db: ctx.db, logger: ctx.logger, bus: ctx.bus })
    const templates = createTemplateEngine()
    const batchEngine = createBatchEngine({ db: ctx.db, logger: ctx.logger })
    const retryEngine = createRetryEngine({ db: ctx.db, logger: ctx.logger })

    ;(ctx as any).notifications = router
    ;(ctx as any).notificationsTemplates = templates
    ;(ctx as any).notificationsBatch = batchEngine
    ;(ctx as any).notificationsRetry = retryEngine
    ctx.logger.info('Notifications module registered')
  },

  async onStart(ctx: ModuleContext) {
    const router = (ctx as any).notifications as ReturnType<typeof createNotificationRouter>
    const batchEngine = (ctx as any).notificationsBatch as ReturnType<typeof createBatchEngine>
    const retryEngine = (ctx as any).notificationsRetry as ReturnType<typeof createRetryEngine>
    const templates = (ctx as any).notificationsTemplates as ReturnType<typeof createTemplateEngine>

    // Register web channel (WebSocket push)
    const wsRegistry = (ctx as any).wsRegistry
    if (wsRegistry) {
      router.registerChannel(createWebChannel(wsRegistry))
    }

    // Register Telegram channel if communication module is available
    if (ctx.hasModule('communication')) {
      const comm = (ctx as any).communication
      router.registerChannel(createTelegramChannel({
        getTelegramBot: () => comm?.telegram?.bot ?? null,
        resolveChatId: (_userId: string) => {
          // In a full implementation, this would look up the user's paired Telegram chat ID
          return null
        },
        logger: ctx.logger,
      }))
    }

    // Register email channel if secrets are available
    if (ctx.hasModule('secrets')) {
      router.registerChannel(createEmailChannel({
        getSmtpConfig: () => {
          // SMTP config loaded from secrets — returns null if not configured
          return null
        },
        resolveEmail: (_userId: string) => {
          // Look up user email from DB — for now returns null (skips silently)
          return null
        },
        templates,
        logger: ctx.logger,
      }))
    }

    // Register webhook channel — DB-backed per-user config
    router.registerChannel(createWebhookChannel({
      resolveWebhook: (userId: string): WebhookConfig | null => {
        const rows = (ctx.db as any).all(
          sql`SELECT url, secret, headers, enabled FROM notification_webhooks WHERE user_id = ${userId}`
        ) as any[]
        const row = rows[0]
        if (!row || !row.enabled) return null
        return {
          url: row.url,
          secret: row.secret ?? undefined,
          headers: row.headers ? JSON.parse(row.headers) : undefined,
        }
      },
      logger: ctx.logger,
    }))

    // Wire batch + retry engines into the router so notify() can route through them
    router.setBatchEngine(batchEngine)
    router.setRetryEngine(retryEngine)

    // Shared channel map for the processor ticks
    const channelMap = router.getChannels()

    // Start periodic processor for batch + retry queues
    const timer = setInterval(async () => {
      try {
        await batchEngine.processDue(channelMap, templates)
      } catch (err) {
        ctx.logger.error({ err }, 'Batch processor tick failed')
      }
      try {
        await retryEngine.processDue(channelMap)
      } catch (err) {
        ctx.logger.error({ err }, 'Retry processor tick failed')
      }
    }, PROCESS_INTERVAL_MS)
    ;(ctx as any).notificationsTimer = timer

    // Start bus listener for eyas.notify events
    router.startBusListener(ctx.bus)

    // Mount HTTP routes
    createNotificationRoutes(ctx.http, {
      router,
      retryEngine,
      db: ctx.db,
    })

    ctx.logger.info('Notifications module started (batch + retry + webhook wired)')
  },

  async onStop(ctx: ModuleContext) {
    const timer = (ctx as any).notificationsTimer
    if (timer) clearInterval(timer)

    const batchEngine = (ctx as any).notificationsBatch as ReturnType<typeof createBatchEngine> | undefined
    const retryEngine = (ctx as any).notificationsRetry as ReturnType<typeof createRetryEngine> | undefined
    batchEngine?.stop()
    retryEngine?.stop()
  },
}
