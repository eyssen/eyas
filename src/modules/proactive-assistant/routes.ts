// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { SourceAdapter } from './source-adapters.js'
import type { ProactiveAlert, LessonLearned } from './types.js'
import type { createLessonLearner } from './lesson-learner.js'
import type { createBotExecutor } from './bot-executor.js'

export interface ProactiveServices {
  adapters: SourceAdapter[]
  lessonLearner: ReturnType<typeof createLessonLearner>
  botExecutor: ReturnType<typeof createBotExecutor>
  alerts: ProactiveAlert[]
  lessons: LessonLearned[]
}

export function createProactiveRoutes(app: Hono, services: ProactiveServices) {
  const api = new Hono()

  // Current alerts
  api.get('/proactive/alerts', requirePermission('read', 'ProactiveAssistant'), (c) => {
    return c.json({ alerts: services.alerts })
  })

  // Lesson history
  api.get('/proactive/lessons', requirePermission('read', 'ProactiveAssistant'), (c) => {
    return c.json({ lessons: services.lessons })
  })

  // Manual trigger — check all adapters
  api.post('/proactive/check', requirePermission('update', 'ProactiveAssistant'), async (c) => {
    const newAlerts: ProactiveAlert[] = []
    for (const adapter of services.adapters) {
      const found = await adapter.check()
      newAlerts.push(...found)
    }
    // Merge into current alerts (deduplicate by id)
    const existingIds = new Set(services.alerts.map(a => a.id))
    for (const alert of newAlerts) {
      if (!existingIds.has(alert.id)) {
        services.alerts.push(alert)
      }
    }
    return c.json({ newAlerts: newAlerts.length, totalAlerts: services.alerts.length })
  })

  app.route('/api/v1', api)
}
