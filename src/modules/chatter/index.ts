// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createChatterService } from './chatter-service.js'

export const chatterModule: EyasModule = {
  id: 'chatter',
  name: 'Chatter',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Context-rail notes, business field tracking, and followers',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    const chatterService = createChatterService(ctx.db, ctx.bus)
    ;(ctx as any).chatter = chatterService
    ctx.logger.info('Chatter module registered')
  },

  async onStart(ctx: ModuleContext) {
    const chatterService = (ctx as any).chatter

    const { createChatterRoutes } = await import('./routes.js')
    createChatterRoutes(ctx.http, chatterService)
    ctx.logger.info('Chatter module started')
  },

  async onStop() {},
}
