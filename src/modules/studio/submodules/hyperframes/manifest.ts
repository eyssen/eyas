// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModuleContext, SubmoduleManifest } from '@core/types'
import { createProcessRunner } from '../../cli-runner.js'
import { load as loadStudioSettings } from '../../settings-store.js'
import { createHyperframesAdapter } from './adapter.js'

export const hyperframesManifest: SubmoduleManifest = {
  id: 'studio.hyperframes',
  name: 'Hyperframes',
  parentModule: 'studio',
  enabled: true,
  async onStart(ctx: ModuleContext) {
    const studio = (ctx as any).studio
    if (!studio?.registerEngine) {
      ctx.logger.warn('Hyperframes adapter skipped — studio gateway not available')
      return
    }

    const adapter = createHyperframesAdapter({
      runner: createProcessRunner(),
      logger: ctx.logger,
      getSettings: () => loadStudioSettings(ctx.db),
    })
    studio.registerEngine(adapter)
  },
}
