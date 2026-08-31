// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createLocalBackupProvider } from './providers/local.js'
import { createBackupService } from './backup-service.js'
import {
  loadDestinationStore,
  saveDestinationStore,
  destinationSecretName,
  isEnvOrVaultRef,
} from './destinations/store.js'

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
    const setSecret = async (key: string, value: string): Promise<void> => {
      if (!ctx.secrets?.set) return
      const trusted = { userId: 'system', role: 'owner', trusted: true }
      await ctx.secrets.set(key, 'system', value, 'disaster-recovery', trusted)
    }
    try {
      await migrateInlineSecretsToVault(setSecret, ctx)
    } catch (err) {
      ctx.logger.warn({ err }, 'Could not migrate inline backup destination secrets')
    }
    const backupService = createBackupService(provider, {
      logger: ctx.logger,
      getSecret,
    })
    ;(ctx as any).backup = backupService

    const { createDisasterRecoveryRoutes } = await import('./routes.js')
    createDisasterRecoveryRoutes(ctx.http, backupService, getSecret, setSecret)
    ctx.logger.info('Disaster Recovery module started (local + remote destinations)')
  },

  async onStop() {},
}

async function migrateInlineSecretsToVault(
  setSecret: (key: string, value: string) => Promise<void>,
  ctx: ModuleContext,
): Promise<void> {
  if (!ctx.secrets?.set) return
  const store = loadDestinationStore()
  let moved = 0
  for (const dest of store.destinations) {
    const next: Record<string, string> = { ...dest.secretRefs }
    for (const [field, ref] of Object.entries(dest.secretRefs ?? {})) {
      if (!ref || isEnvOrVaultRef(ref)) continue
      const vaultName = destinationSecretName(dest.id, field)
      await setSecret(vaultName, ref)
      next[field] = vaultName
      moved++
    }
    dest.secretRefs = next
  }
  if (moved > 0) {
    saveDestinationStore(store)
    ctx.logger.info({ moved }, 'Moved inline backup destination secrets into the vault')
  }
}
