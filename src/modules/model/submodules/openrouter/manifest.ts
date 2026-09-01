import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createOpenRouterProvider } from './provider.js'

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('openrouter')

  const config = ctx.providerConfig.getProvider('openrouter')
  if (!config?.enabled) return

  const apiKey = await ctx.secrets.get('openrouter-api-key', 'system')
  if (!apiKey) return

  const provider = createOpenRouterProvider(apiKey)
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('openrouter')
  if (existingModels.length === 0) {
    const models = await provider.listModels()
    ctx.providerConfig.upsertModels('openrouter', models)
  }
}

export const openrouterManifest: SubmoduleManifest = {
  id: 'model.openrouter',
  name: 'OpenRouter',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('openrouter')
    ctx.providerReload.set('openrouter', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('openrouter')) {
      ctx.logger.info('OpenRouter provider registered')
    } else {
      ctx.logger.warn('OpenRouter provider skipped — no API key in secrets')
    }
  },
}
