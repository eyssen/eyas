// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createLocalBackupProvider } from './providers/local.js'
import { createBackupService } from './backup-service.js'

export const disasterRecoveryModule: EyasModule = {
  id: 'disaster-recovery',
  name: 'Disaster Recovery',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description:
    'Backup and restore — local tar.gz plus optional offsite destinations (S3/B2, FTP, Dropbox, SSH)',
  dependencies: [],
  optional: ['secrets'],

  async onRegister(ctx: ModuleContext) {
    ctx.logger.info('Disaster Recovery module registered')
  },

  async onStart(ctx: ModuleContext) {
    const provider = createLocalBackupProvider()
    const getSecret = async (key: string): Promise<string | null> => {
      try {
        if (ctx.secrets?.get) {
          const trusted = { userId: 'system', role: 'owner', trusted: true }
          const v = await ctx.secrets.get(key, 'system', trusted)
          if (v) return v
          return await ctx.secrets.get(key, 'user', trusted)
        }
      } catch {
        /* secrets not ready */
      }
      return null
    }
    const backupService = createBackupService(provider, {
      logger: ctx.logger,
      getSecret,
    })
    ;(ctx as any).backup = backupService

    const { createDisasterRecoveryRoutes } = await import('./routes.js')
    createDisasterRecoveryRoutes(ctx.http, backupService, getSecret)
    ctx.logger.info('Disaster Recovery module started (local + remote destinations)')
  },

  async onStop() {},
}
