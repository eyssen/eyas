// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createUpdateService } from './update-service.js'
import { createSystemUpdateRoutes } from './routes.js'

export const systemUpdateModule: EyasModule = {
  id: 'system-update',
  name: 'System Update',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Check GitHub for new EYAS versions and self-update (git + mandatory backup)',
  dependencies: [],
  optional: ['disaster-recovery'],

  async onRegister(ctx: ModuleContext) {
    ctx.logger.info('System Update module registered')
  },

  async onStart(ctx: ModuleContext) {
    const backup = (ctx as any).backup ?? null
    const update = createUpdateService({
      logger: ctx.logger,
      backup,
      repo: process.env.EYAS_GITHUB_REPO,
    })
    ;(ctx as any).systemUpdate = update
    createSystemUpdateRoutes(ctx.http, update)
    ctx.logger.info(
      {
        repo: process.env.EYAS_GITHUB_REPO ?? 'eyssen/eyas',
        backup: !!backup,
      },
      'System Update module started',
    )
  },

  async onStop() {},
}
