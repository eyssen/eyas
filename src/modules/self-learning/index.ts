// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createActivityAnalyzer } from './activity-analyzer.js'
import { createExecutionLearner, type ExecutionLearnerDeps } from './execution-learner.js'
import { createSkillGenerator } from './skill-generator.js'
import { createEfficiencyReporter } from './efficiency-reporter.js'
import { createSelfLearningRoutes } from './routes.js'

export const selfLearningModule: EyasModule = {
  id: 'self-learning',
  name: 'Self-Learning',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Analyzes activity, learns from agent executions, suggests skills, generates efficiency reports',
  dependencies: ['agent', 'tools'],
  optional: ['scheduler'],

  async onRegister(ctx: ModuleContext) {
    const analyzer = createActivityAnalyzer(ctx.db)
    // model/decisionEngine/agentRegistry are not threaded in yet — onRegister
    // runs before the model module's onStart populates ctx.decisionEngine (and
    // before the agent module's onStart populates ctx.agents). onStart below
    // fills these in on the same deps object once both are available (mirrors
    // forge/index.ts's proposalEngineDeps).
    const learnerDeps: ExecutionLearnerDeps = {}
    const learner = createExecutionLearner(ctx.db, learnerDeps)
    const skillGenerator = createSkillGenerator(ctx.db)
    const reporter = createEfficiencyReporter(ctx.db)

    ;(ctx as any).selfLearning = { analyzer, learner, learnerDeps, skillGenerator, reporter }
    ctx.logger.info('Self-learning module registered')
  },

  async onStart(ctx: ModuleContext) {
    const services = (ctx as any).selfLearning as {
      analyzer: ReturnType<typeof createActivityAnalyzer>
      learner: ReturnType<typeof createExecutionLearner>
      learnerDeps: ExecutionLearnerDeps
      skillGenerator: ReturnType<typeof createSkillGenerator>
      reporter: ReturnType<typeof createEfficiencyReporter>
    }

    // Thread the cheap-tier model + decision engine + agent registry into the
    // learner now — both are populated by this point (model's and agent's
    // onStart already ran; onRegister above ran too early for them to exist).
    services.learnerDeps.model = ctx.model
    services.learnerDeps.decisionEngine = (ctx as any).decisionEngine
    services.learnerDeps.agentRegistry = (ctx as any).agents?.registry
    services.learnerDeps.logger = ctx.logger

    // Mount routes — pass ctx so the passive GET routes can read the
    // `selfLearning.apply` flag fresh at fire time (see routes.ts). `as any`:
    // securityGate is bolted onto ModuleContext dynamically, same as the
    // scheduler handlers above.
    createSelfLearningRoutes(ctx.http, services, ctx as any)

    // Register scheduler jobs if scheduler module is available
    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler

      // Daily 22:00 — activity analysis
      scheduler.registerHandler('selfLearning.activityAnalysis', async () => {
        const patterns = services.analyzer.analyze(7)
        ctx.bus.emit('self-learning:patterns', { patterns, timestamp: new Date().toISOString() })
        ctx.logger.info({ patternCount: patterns.length }, 'Daily activity analysis complete')
        return { patterns: patterns.length }
      })

      // Weekly Monday 9:00 — execution learning + efficiency report
      scheduler.registerHandler('selfLearning.weeklyReport', async () => {
        // `selfLearning.apply` Phase-3 loop flag (Task 10) — read fresh at fire
        // time, never cached, so toggling it takes effect on the next run with
        // no restart. Absent feature store fails safe to disabled.
        const modelPassOn = (ctx as any).securityGate?.features?.isEnabled?.('selfLearning.apply') === true
        const insights = await services.learner.learn(7, modelPassOn)
        const report = services.reporter.generate('weekly')
        report.insights = insights
        ctx.bus.emit('self-learning:report', { report, timestamp: new Date().toISOString() })
        ctx.logger.info({ insights: insights.length, sessions: report.totalSessions }, 'Weekly learning report generated')
        return { insights: insights.length, report: { sessions: report.totalSessions, tokens: report.totalTokens } }
      })

      // Monthly 1st 9:00 — full report with skill suggestions
      scheduler.registerHandler('selfLearning.monthlyReport', async () => {
        // See selfLearning.weeklyReport above — same fire-time feature gate.
        const modelPassOn = (ctx as any).securityGate?.features?.isEnabled?.('selfLearning.apply') === true
        const insights = await services.learner.learn(30, modelPassOn)
        const suggestions = services.skillGenerator.suggest(30)
        const report = services.reporter.generate('monthly')
        report.insights = insights
        ctx.bus.emit('self-learning:monthly-report', { report, suggestions, timestamp: new Date().toISOString() })
        ctx.logger.info({ insights: insights.length, suggestions: suggestions.length }, 'Monthly learning report generated')
        return { insights: insights.length, suggestions: suggestions.length, report: { sessions: report.totalSessions } }
      })

      // Seed jobs if not already present
      const existing = scheduler.list()

      if (!existing.some((j: any) => j.handler === 'selfLearning.activityAnalysis')) {
        scheduler.create({
          name: 'Daily Activity Analysis',
          description: 'Analyze tool and agent activity patterns',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 22 * * *' }),
          handler: 'selfLearning.activityAnalysis',
        })
        ctx.logger.info('Seeded daily activity analysis job')
      }

      if (!existing.some((j: any) => j.handler === 'selfLearning.weeklyReport')) {
        scheduler.create({
          name: 'Weekly Learning Report',
          description: 'Generate weekly execution learning and efficiency report',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 9 * * 1' }),
          handler: 'selfLearning.weeklyReport',
        })
        ctx.logger.info('Seeded weekly learning report job')
      }

      if (!existing.some((j: any) => j.handler === 'selfLearning.monthlyReport')) {
        scheduler.create({
          name: 'Monthly Full Report',
          description: 'Generate monthly full learning report with skill suggestions',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 9 1 * *' }),
          handler: 'selfLearning.monthlyReport',
        })
        ctx.logger.info('Seeded monthly full report job')
      }
    }

    ctx.logger.info('Self-learning module started')
  },

  async onStop(_ctx: ModuleContext) {
    // No cleanup needed — scheduler handles stopping cron jobs
  },
}
