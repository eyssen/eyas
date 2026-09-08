// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createLMStudioProvider, isLMStudioAvailable } from './provider.js'

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('lmstudio')

  const config = ctx.providerConfig.getProvider('lmstudio')
  if (!config?.enabled) return

  const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234'
  const available = await isLMStudioAvailable(baseUrl)
  if (!available) {
    ctx.logger.debug('LM Studio not available at %s', baseUrl)
    return
  }

  const provider = createLMStudioProvider({ baseUrl })
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('lmstudio')
  if (existingModels.length === 0) {
    const models = await provider.listModels()
    ctx.providerConfig.upsertModels('lmstudio', models)
  }
}

export const lmstudioManifest: SubmoduleManifest = {
  id: 'model.lmstudio',
  name: 'LM Studio',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('lmstudio')
    ctx.providerReload.set('lmstudio', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('lmstudio')) {
      ctx.logger.info('LM Studio provider registered')
    } else {
      ctx.logger.debug('LM Studio provider skipped — not available')
    }
  },
}
