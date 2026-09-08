// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { createActivityAnalyzer } from './activity-analyzer.js'
import type { createExecutionLearner } from './execution-learner.js'
import type { createSkillGenerator } from './skill-generator.js'
import type { createEfficiencyReporter } from './efficiency-reporter.js'

/**
 * Parse the `days` query param into a bounded integer. Returns null when the
 * param is present but not a finite number so the route can reply 400 instead
 * of letting NaN flow into `new Date(... NaN ...)` and throw a RangeError (500).
 */
function parseDays(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(Math.floor(n), 365)
}

export interface SelfLearningServices {
  analyzer: ReturnType<typeof createActivityAnalyzer>
  learner: ReturnType<typeof createExecutionLearner>
  skillGenerator: ReturnType<typeof createSkillGenerator>
  reporter: ReturnType<typeof createEfficiencyReporter>
}

/**
 * Narrow structural subset of ModuleContext this module needs — just enough
 * to read the `selfLearning.apply` Phase-3 loop flag fresh at fire time.
 * Optional: routes work without it (existing tests), which reads as the flag
 * being OFF, matching the "disabled by default" behavior of the flag itself.
 */
export interface SelfLearningFeatureGate {
  securityGate?: { features?: { isEnabled?: (key: string) => boolean } }
}

export function createSelfLearningRoutes(app: Hono, services: SelfLearningServices, moduleCtx?: SelfLearningFeatureGate) {
  const api = new Hono()

  // Passive GET routes must never run the paid model-authoring pass while the
  // `selfLearning.apply` loop is OFF — mirrors the fire-time read in
  // self-learning/index.ts's scheduler handlers, so a dashboard poll can't
  // silently spend on a "disabled" loop.
  const modelPassEnabled = () => moduleCtx?.securityGate?.features?.isEnabled?.('selfLearning.apply') === true

  // Current activity patterns
  api.get('/self-learning/patterns', requirePermission('read', 'SelfLearning'), (c) => {
    const daysBack = parseDays(c.req.query('days'), 7)
    if (daysBack === null) return c.json({ error: 'days must be a positive number' }, 400)
    const patterns = services.analyzer.analyze(daysBack)
    return c.json({ patterns })
  })

  // Execution insights
  api.get('/self-learning/insights', requirePermission('read', 'SelfLearning'), async (c) => {
    const daysBack = parseDays(c.req.query('days'), 30)
    if (daysBack === null) return c.json({ error: 'days must be a positive number' }, 400)
    const insights = await services.learner.learn(daysBack, modelPassEnabled())
    return c.json({ insights })
  })

  // Skill suggestions
  api.get('/self-learning/skills/suggestions', requirePermission('read', 'SelfLearning'), (c) => {
    const daysBack = parseDays(c.req.query('days'), 30)
    if (daysBack === null) return c.json({ error: 'days must be a positive number' }, 400)
    const suggestions = services.skillGenerator.suggest(daysBack)
    return c.json({ suggestions })
  })

  // Efficiency report
  api.get('/self-learning/report', requirePermission('read', 'SelfLearning'), async (c) => {
    const period = (c.req.query('period') || 'weekly') as 'daily' | 'weekly' | 'monthly'
    const report = services.reporter.generate(period)
    // Enrich report with execution insights
    report.insights = await services.learner.learn(
      period === 'daily' ? 1 : period === 'weekly' ? 7 : 30,
      modelPassEnabled(),
    )
    return c.json({ report })
  })

  // Trigger manual analysis
  api.post('/self-learning/analyze', requirePermission('read', 'SelfLearning'), async (c) => {
    const patterns = services.analyzer.analyze(7)
    const insights = await services.learner.learn(30)
    const suggestions = services.skillGenerator.suggest(30)
    const report = services.reporter.generate('weekly')
    report.insights = insights
    return c.json({ patterns, insights, suggestions, report })
  })

  app.route('/api/v1', api)
}
