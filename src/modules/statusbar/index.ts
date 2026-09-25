// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createStatusbarRoutes } from './routes.js'

export const statusbarModule: EyasModule = {
  id: 'statusbar',
  name: 'Status Bar',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Bottom status bar segments (task/agent/sync/version)',
  dependencies: [],

  async onRegister() {},

  async onStart(ctx: ModuleContext) {
    createStatusbarRoutes(ctx.http, ctx.db, ctx.config)
    ctx.logger.info('Status bar module registered')
  },

  async onStop() {},
}
