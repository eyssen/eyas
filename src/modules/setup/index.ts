import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createSetupRoutes } from './routes.js'

export const setupModule: EyasModule = {
  id: 'setup',
  name: 'Setup',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'First-boot setup wizard with modular step registry',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS setup_steps (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        data TEXT,
        completed_at TEXT
      )
    `)
    ctx.logger.info('Setup module registered')
  },

  async onStart(ctx: ModuleContext) {
    createSetupRoutes(ctx.http, ctx.setup, ctx.db)

    // Env var auto-complete for headless deployments
    await autoCompleteFromEnv(ctx)

    if (ctx.setup.isComplete()) {
      ctx.logger.info('Setup already complete')
    } else {
      const steps = ctx.setup.getSteps()
      const pending = steps.filter(s => s.required && s.status === 'pending')
      ctx.logger.warn(`Setup incomplete — ${pending.length} required step(s) pending`)
    }
  },

  async onStop() {},
}

export async function autoCompleteFromEnv(ctx: ModuleContext): Promise<void> {
  const { setup, logger } = ctx

  const username = process.env.EYAS_SETUP_USERNAME
  const password = process.env.EYAS_SETUP_PASSWORD
  if (username && password) {
    const step = setup.getStep('root-owner')
    if (step && step.status === 'pending') {
      try {
        await setup.completeStep('root-owner', {
          username,
          password,
          displayName: process.env.EYAS_SETUP_DISPLAY_NAME || username,
        })
        logger.info('Setup: root-owner auto-completed from environment variables')
        delete process.env.EYAS_SETUP_PASSWORD
      } catch (err: any) {
        logger.error(`Setup: root-owner auto-complete failed: ${err.message}`)
      }
    }
  }

  const assistantName = process.env.EYAS_SETUP_AGENT_NAME
  const engineerName = process.env.EYAS_SETUP_ENGINEER_NAME ?? assistantName
  if (assistantName) {
    const step = setup.getStep('primary-agents')
    if (step && step.status === 'pending') {
      try {
        await setup.completeStep('primary-agents', { assistantName, engineerName })
        logger.info('Setup: primary-agents auto-completed from environment variables')
      } catch (err: any) {
        logger.error(`Setup: primary-agents auto-complete failed: ${err.message}`)
      }
    }
  }
}
