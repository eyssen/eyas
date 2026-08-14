// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createKimiProvider } from './provider.js'

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('kimi')

  const config = ctx.providerConfig.getProvider('kimi')
  if (!config?.enabled) return

  const apiKey = await ctx.secrets.get('kimi-api-key', 'system')
  if (!apiKey) return

  const baseURL = (config.settings?.baseURL as string | undefined) || undefined
  const provider = createKimiProvider(apiKey, baseURL)
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('kimi')
  if (existingModels.length === 0) {
    const models = await provider.listModels()
    ctx.providerConfig.upsertModels('kimi', models)
  }
}

export const kimiManifest: SubmoduleManifest = {
  id: 'model.kimi',
  name: 'Kimi (Moonshot API)',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('kimi')
    ctx.providerReload.set('kimi', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('kimi')) {
      ctx.logger.info('Kimi API provider registered')
    } else {
      ctx.logger.warn('Kimi API provider skipped — no API key in secrets')
    }
  },
}
