// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createCostopsService, createCostopsTables, defaultCostopsConfigPath } from './service.js'
import { createCostopsRoutes } from './routes.js'

export const costopsModule: EyasModule = {
  id: 'costops',
  name: 'CostOps',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Operator SaaS/subscription cost ledger and budgets',
  dependencies: [],
  optional: [],
  frontend: {
    widgets: [{ id: 'costops.summary', titleKey: 'home.widget.cost.title' }],
  },

  async onRegister(ctx: ModuleContext) {
    createCostopsTables(ctx.db)
    try {
      ;(ctx as any).permissions?.registerSubject?.('Costops', {
        actions: ['read', 'create', 'update'],
        defaults: { owner: ['update'], admin: ['update'], user: ['read'], agent: ['read'], guest: [] },
      })
    } catch { /* already registered */ }
    ctx.logger.info('CostOps module registered')
  },

  async onStart(ctx: ModuleContext) {
    const configPath = (ctx.config as any).costops?.configPath
      ?? defaultCostopsConfigPath('data')
    const costops = createCostopsService({ db: ctx.db, configPath })
    ;(ctx as any).costops = costops
    createCostopsRoutes(ctx.http, costops)
    ctx.logger.info({ configPath }, 'CostOps module started')
  },

  async onStop() {},
}
