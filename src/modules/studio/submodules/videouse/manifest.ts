// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModuleContext, SubmoduleManifest } from '@core/types'
import { createProcessRunner } from '../../cli-runner.js'
import { load as loadStudioSettings } from '../../settings-store.js'
import { createVideoUseAdapter } from './adapter.js'

const SECRET_NAME = 'videouse-elevenlabs-api-key'
const TRUSTED = { userId: 'system', role: 'owner', trusted: true as const }

export const videouseManifest: SubmoduleManifest = {
  id: 'studio.videouse',
  name: 'Video Use',
  parentModule: 'studio',
  enabled: true,
  async onStart(ctx: ModuleContext) {
    const studio = (ctx as any).studio
    if (!studio?.registerEngine) {
      ctx.logger.warn('Video Use adapter skipped — studio gateway not available')
      return
    }

    const adapter = createVideoUseAdapter({
      runner: createProcessRunner(),
      logger: ctx.logger,
      getSettings: () => loadStudioSettings(ctx.db),
      getApiKey: async () => {
        const envKey = process.env.ELEVENLABS_API_KEY?.trim()
        if (envKey) return envKey
        try {
          const stored = await ctx.secrets?.get?.(SECRET_NAME, 'system', TRUSTED)
          return typeof stored === 'string' && stored.trim() ? stored.trim() : null
        } catch {
          return null
        }
      },
    })
    studio.registerEngine(adapter)
  },
}
