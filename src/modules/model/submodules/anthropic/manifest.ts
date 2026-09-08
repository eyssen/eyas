import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createAnthropicProvider } from './provider.js'

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('anthropic')

  const config = ctx.providerConfig.getProvider('anthropic')
  if (!config?.enabled) return

  const apiKey = await ctx.secrets.get('anthropic-api-key', 'system')
  if (!apiKey) return

  const provider = createAnthropicProvider(apiKey)
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('anthropic')
  if (existingModels.length === 0) {
    const models = await provider.listModels()
    ctx.providerConfig.upsertModels('anthropic', models)
  }
}

export const anthropicManifest: SubmoduleManifest = {
  id: 'model.anthropic',
  name: 'Anthropic Claude API',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('anthropic')
    ctx.providerReload.set('anthropic', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('anthropic')) {
      ctx.logger.info('Anthropic provider registered')
    } else {
      ctx.logger.warn('Anthropic provider skipped — no API key in secrets')
    }
  },
}
